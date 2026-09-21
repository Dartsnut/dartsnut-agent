use std::sync::atomic::Ordering;
use std::time::Duration;
use tauri::{Manager, RunEvent, WindowEvent};
use tauri_plugin_window_state::StateFlags;

pub mod agent;
pub mod api_format;
pub mod commands;
pub mod deploy;
pub mod desktop_commands;
pub mod emulator;
pub mod file_patch;
pub mod oauth;
pub mod pending_inputs;
pub mod projects;
pub mod provider;
pub mod proxy;
pub mod rig_runtime;
pub mod runtime;
pub mod updates;
pub mod workspace;

/// Ensure Reqwest's `rustls-no-provider` build has a process-wide TLS
/// provider before constructing any HTTP client. Safe to call repeatedly.
pub fn ensure_rustls_crypto_provider() {
    if rustls::crypto::CryptoProvider::get_default().is_none() {
        let _ = rustls::crypto::ring::default_provider().install_default();
    }
}

async fn shutdown_resources(app: &tauri::AppHandle) {
    let state = app.state::<commands::AppState>();
    if let Ok(mut slot) = state.sideload.lock() {
        if let Some(client) = slot.take() {
            client.close();
        }
    }
    let connection = state.deploy.lock().ok().and_then(|mut slot| slot.take());
    if let Some(connection) = connection {
        connection.clear_disconnect_callback();
        // A dropped/unreachable device must not keep the app alive forever
        // while the quit path waits for graceful SSH disconnect.
        match tokio::time::timeout(Duration::from_secs(3), connection.close()).await {
            Ok(Ok(())) => {}
            Ok(Err(error)) => eprintln!("[shutdown] SSH disconnect failed: {error}"),
            Err(_) => eprintln!("[shutdown] SSH disconnect timed out; continuing cleanup"),
        }
    }
    state.emulator.stop().await;
}

/// Default `RUST_LOG` when the environment does not set one.
///
/// Rig logs request/response JSON at TRACE on `rig::streaming` (streamed
/// completions, the production path) and `rig::completions` (non-streamed).
/// `rig_agent=info` keeps agent-loop lifecycle lines without dumping every
/// internal TRACE event. Override with `RUST_LOG`.
const DEFAULT_RUST_LOG: &str =
    "warn,rig::streaming=trace,rig::completions=trace,rig_agent=info";

fn init_tracing() {
    tracing_subscriber::fmt()
        .with_writer(std::io::stderr)
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new(DEFAULT_RUST_LOG)),
        )
        .init();
}

pub fn run() {
    init_tracing();

    // Load repository-root configuration before any command reads
    // community/Supabase settings. Development prefers .env and falls back to
    // the local release env so `pnpm dev` works without duplicated settings.
    #[cfg(debug_assertions)]
    {
        let repo_root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("..");
        let dev_env = repo_root.join(".env");
        let env_path = if dev_env.is_file() {
            dev_env
        } else {
            repo_root.join(".env.release.local")
        };
        let _ = dotenvy::from_path(env_path);
    }

    // reqwest is built with `rustls-no-provider`; install the ring provider
    // before any command, plugin, or background task can create a client.
    // Installing twice is harmless, so feature-specific construction paths
    // may keep their defensive initialization as well.
    ensure_rustls_crypto_provider();

    let mut updater = tauri_plugin_updater::Builder::new();
    if let Ok(pubkey) = std::env::var("TAURI_SIGNING_PUBLIC_KEY") {
        if !pubkey.trim().is_empty() {
            updater = updater.pubkey(pubkey);
        }
    }
    tauri::Builder::default()
        .plugin(updater.build())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(
                    StateFlags::SIZE
                        | StateFlags::POSITION
                        | StateFlags::MAXIMIZED
                        | StateFlags::VISIBLE
                        | StateFlags::FULLSCREEN,
                )
                .build(),
        )
        .plugin(tauri_plugin_process::init())
        .manage(commands::AppState::default())
        .on_window_event(|window, event| {
            let WindowEvent::CloseRequested { api, .. } = event else {
                return;
            };
            let app = window.app_handle().clone();
            let state = app.state::<commands::AppState>();
            // CloseRequested is allowed to destroy the last window immediately.
            // Hold it until Rust has stopped widget descendants and shared memory.
            if state.quit_cleanup_started.swap(true, Ordering::SeqCst) {
                return;
            }
            api.prevent_close();
            let window = window.clone();
            tauri::async_runtime::spawn(async move {
                shutdown_resources(&app).await;
                let _ = window.close();
            });
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_bootstrap_state,
            commands::renderer_ready,
            commands::list_projects,
            commands::create_project,
            commands::remove_project,
            commands::create_chat,
            commands::archive_chat,
            commands::select_project,
            commands::select_chat,
            commands::get_provider_settings,
            commands::save_provider_settings,
            commands::get_python_runtime_status,
            commands::get_python_runtime_progress,
            commands::retry_python_runtime_setup,
            commands::deploy_get_eligibility,
            commands::get_widget_config,
            commands::community_get_session,
            commands::get_app_update_status,
            commands::get_app_update_auto_download,
            commands::set_app_update_auto_download,
            desktop_commands::report_renderer_error,
            desktop_commands::open_startup_logs,
            desktop_commands::open_workspace_folder,
            desktop_commands::copy_startup_diagnostics,
            desktop_commands::reset_renderer_state,
            desktop_commands::restart_app,
            desktop_commands::generate_chat_title,
            desktop_commands::get_window_chrome_insets,
            desktop_commands::install_app_update_now,
            desktop_commands::download_app_update,
            desktop_commands::check_app_update,
            desktop_commands::set_shell_ui_theme,
            desktop_commands::pick_workspace,
            desktop_commands::machine_mcp_submit_question_answer,
            desktop_commands::agent_question_submit_answer,
            desktop_commands::emulator_command,
            desktop_commands::emulator_pick_path,
            desktop_commands::emulator_get_last_path,
            desktop_commands::emulator_get_background,
            desktop_commands::emulator_open_capture_folder,
            desktop_commands::deploy_connect,
            desktop_commands::deploy_get_state,
            desktop_commands::deploy_disconnect,
            desktop_commands::deploy_run,
            desktop_commands::deploy_reload,
            desktop_commands::deploy_apply_widget_params,
            desktop_commands::deploy_stop,
            desktop_commands::deploy_open_local_network_settings,
            desktop_commands::community_login,
            desktop_commands::community_set_password,
            desktop_commands::community_cancel_google_login,
            desktop_commands::community_logout,
            desktop_commands::community_get_llm_quota,
            desktop_commands::community_list_deploy_devices,
            desktop_commands::community_list_my_games,
            desktop_commands::community_get_publish_options,
            desktop_commands::community_list_app_versions,
            desktop_commands::community_create_app,
            desktop_commands::community_upload_native_image,
            desktop_commands::community_submit_app_version,
            desktop_commands::community_update_workspace_version,
            desktop_commands::community_withdraw_app_version,
            agent::send_prompt,
            agent::cancel_agent,
            agent::get_workspace_session_summary,
            agent::reset_workspace_session
        ])
        .setup(|app| {
            if let Some(window) = app.get_webview_window("main") {
                window.set_decorations(false)?;
            }
            let handle = app.handle().clone();
            commands::start_workspace_monitor(handle.clone());
            let runtime = handle.state::<commands::AppState>().runtime.clone();
            runtime.start(handle);
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building Dartsnut Agent")
        .run(|app, event| {
            let RunEvent::ExitRequested { api, code, .. } = event else {
                return;
            };
            let state = app.state::<commands::AppState>();
            // Menu/app exits do not necessarily produce WindowEvent::CloseRequested.
            // Prevent exit, perform identical cleanup, then request exit again; the
            // second event observes the guard and is allowed through.
            if state.quit_cleanup_started.swap(true, Ordering::SeqCst) {
                return;
            }
            api.prevent_exit();
            let app = app.clone();
            tauri::async_runtime::spawn(async move {
                shutdown_resources(&app).await;
                app.exit(code.unwrap_or(0));
            });
        });
}

#[cfg(test)]
mod tests {
    use super::DEFAULT_RUST_LOG;
    use std::io::{self, Write};
    use std::sync::{Arc, Mutex};
    use tracing_subscriber::fmt::MakeWriter;
    use tracing_subscriber::EnvFilter;

    #[derive(Clone)]
    struct Capture(Arc<Mutex<Vec<u8>>>);

    impl Write for Capture {
        fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
            self.0.lock().expect("capture lock").extend_from_slice(buf);
            Ok(buf.len())
        }
        fn flush(&mut self) -> io::Result<()> {
            Ok(())
        }
    }

    impl<'a> MakeWriter<'a> for Capture {
        type Writer = Self;
        fn make_writer(&'a self) -> Self::Writer {
            self.clone()
        }
    }

    #[test]
    fn default_log_filter_prints_rig_streaming_payloads() {
        let buf = Arc::new(Mutex::new(Vec::new()));
        let subscriber = tracing_subscriber::fmt()
            .with_writer(Capture(buf.clone()))
            .with_env_filter(EnvFilter::new(DEFAULT_RUST_LOG))
            .with_ansi(false)
            .finish();

        tracing::subscriber::with_default(subscriber, || {
            tracing::trace!(
                target: "rig::streaming",
                "Gemini streaming completion request: {{\"model\":\"gemini\"}}"
            );
            tracing::trace!(
                target: "rig::completions",
                "Gemini completion response: {{\"candidates\":[]}}"
            );
            tracing::debug!(target: "reqwest", "should stay filtered");
        });

        let output = String::from_utf8(buf.lock().expect("capture lock").clone()).unwrap();
        assert!(
            output.contains("Gemini streaming completion request"),
            "expected streamed request body in console logs, got: {output}"
        );
        assert!(
            output.contains("Gemini completion response"),
            "expected completion response body in console logs, got: {output}"
        );
        assert!(
            !output.contains("should stay filtered"),
            "unrelated crates must remain at warn: {output}"
        );
    }

}