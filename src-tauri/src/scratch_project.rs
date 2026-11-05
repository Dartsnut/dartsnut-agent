//! Guarded access to the `.sb3` a Scratch workspace runs.
//!
//! The editor is a vendored React 16 application in a same-origin iframe. It
//! holds no filesystem capability of its own: every byte it sees arrives through
//! these commands, resolved through `WorkspaceRoot` so a path can never escape
//! the workspace. That boundary is the reason the iframe can be treated as
//! trusted-but-unprivileged.

use std::path::Path;

use base64::Engine;
use serde_json::{json, Value};
use tauri::Manager;

use crate::scratch::ScratchWorkspace;
use crate::workspace::WorkspaceRoot;

/// The single `.sb3` at `root`, resolved through the workspace guard.
///
/// Returns the workspace-relative file name alongside the absolute path, because
/// the renderer carries the relative name in the bridge's project identity and
/// must never learn or invent an absolute path of its own.
fn resolve_project(root: &Path) -> Result<(String, std::path::PathBuf), (String, String)> {
    let (relative, _app_id) = match crate::scratch::scan_workspace(root) {
        ScratchWorkspace::Project { path, app_id } => {
            let name = path
                .file_name()
                .map(|value| value.to_string_lossy().into_owned())
                .unwrap_or_else(|| "project.sb3".to_owned());
            (name, app_id)
        }
        ScratchWorkspace::Absent => {
            return Err((
                "project_missing".to_owned(),
                "the workspace holds no .sb3 project".to_owned(),
            ))
        }
        ScratchWorkspace::Refused { problems, .. } => {
            return Err((
                "project_missing".to_owned(),
                format!(
                    "the workspace no longer holds exactly one usable .sb3: {}",
                    problems.join(", ")
                ),
            ))
        }
    };
    // The guard is what makes this command safe: a `.sb3` that is a symlink
    // pointing outside the workspace is rejected rather than read.
    let guard = WorkspaceRoot::open(root)
        .map_err(|error| ("outside_workspace".to_owned(), error.to_string()))?;
    let absolute = guard
        .resolve(&relative)
        .map_err(|error| ("outside_workspace".to_owned(), error.to_string()))?;
    Ok((relative, absolute))
}

fn workspace_root(app: &tauri::AppHandle) -> Option<std::path::PathBuf> {
    let state = app.state::<crate::commands::AppState>();
    state
        .workspace_root
        .lock()
        .ok()
        .and_then(|value| value.clone())
}

/// Read the workspace's `.sb3` for the editor.
///
/// Bytes cross the IPC boundary base64-encoded, matching how emulator frames
/// already travel. The renderer decodes them into the `Uint8Array` the bridge
/// transfers to the iframe.
#[tauri::command]
pub fn read_scratch_project(app: tauri::AppHandle) -> Value {
    let Some(root) = workspace_root(&app) else {
        return json!({"ok": false, "reason": "no_workspace", "message": "no workspace is selected"});
    };
    let (relative, absolute) = match resolve_project(&root) {
        Ok(found) => found,
        Err((reason, message)) => return json!({"ok": false, "reason": reason, "message": message}),
    };
    let bytes = match std::fs::read(&absolute) {
        Ok(bytes) => bytes,
        Err(error) => {
            return json!({"ok": false, "reason": "read_failed", "message": error.to_string()})
        }
    };
    let project_id = app
        .state::<crate::commands::AppState>()
        .active_project_id
        .lock()
        .ok()
        .and_then(|value| value.clone())
        .unwrap_or_default();
    json!({
        "ok": true,
        "identity": {"projectId": project_id, "fileName": relative},
        "bytesBase64": base64::engine::general_purpose::STANDARD.encode(bytes)
    })
}

/// Write editor bytes back to the workspace's `.sb3`, atomically.
///
/// The write lands in a temporary file inside the same directory and is renamed
/// into place, so an interrupted save leaves the previous project intact rather
/// than a truncated archive. Autosave consumes this in #19; the command exists
/// here because the guarded write is the same boundary as the guarded read.
#[tauri::command]
pub fn save_scratch_project(app: tauri::AppHandle, payload: Value) -> Value {
    let Some(root) = workspace_root(&app) else {
        return json!({"ok": false, "reason": "no_workspace", "message": "no workspace is selected"});
    };
    let Some(encoded) = payload
        .get("bytesBase64")
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
    else {
        return json!({"ok": false, "reason": "read_failed", "message": "bytesBase64 is required"});
    };
    let bytes = match base64::engine::general_purpose::STANDARD.decode(encoded) {
        Ok(bytes) => bytes,
        Err(error) => {
            return json!({"ok": false, "reason": "read_failed", "message": error.to_string()})
        }
    };
    let (relative, absolute) = match resolve_project(&root) {
        Ok(found) => found,
        Err((reason, message)) => return json!({"ok": false, "reason": reason, "message": message}),
    };
    let staging = absolute.with_extension("sb3.saving");
    if let Err(error) = std::fs::write(&staging, &bytes) {
        let _ = std::fs::remove_file(&staging);
        return json!({"ok": false, "reason": "write_failed", "message": error.to_string()});
    }
    if let Err(error) = std::fs::rename(&staging, &absolute) {
        let _ = std::fs::remove_file(&staging);
        return json!({"ok": false, "reason": "write_failed", "message": error.to_string()});
    }
    json!({"ok": true, "fileName": relative})
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::io::Write;

    const USABLE_SB3: &str = r#"{"targets":[{"isStage":true,"name":"Stage"}]}"#;

    fn write_sb3(path: &Path, manifest: &str) {
        let file = fs::File::create(path).unwrap();
        let mut writer = zip::ZipWriter::new(file);
        let options = zip::write::SimpleFileOptions::default();
        writer.start_file("project.json", options).unwrap();
        writer.write_all(manifest.as_bytes()).unwrap();
        writer.finish().unwrap();
    }

    fn temp_workspace(label: &str) -> std::path::PathBuf {
        let root = std::env::temp_dir().join(format!(
            "dartsnut-scratch-read-{label}-{}",
            uuid::Uuid::new_v4()
        ));
        fs::create_dir_all(&root).unwrap();
        root
    }

    #[test]
    fn resolves_the_single_sb3_and_reports_its_relative_name() {
        let root = temp_workspace("single");
        write_sb3(&root.join("game.sb3"), USABLE_SB3);
        let (relative, absolute) = resolve_project(&root).unwrap();
        assert_eq!(relative, "game.sb3");
        // Compare against the canonical root: /var is a symlink to /private/var
        // on macOS, so the guard returns a canonicalized path.
        let canonical = fs::canonicalize(&root).unwrap();
        assert!(absolute.starts_with(&canonical));
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn refuses_a_workspace_with_no_project() {
        let root = temp_workspace("empty");
        let (reason, _) = resolve_project(&root).unwrap_err();
        assert_eq!(reason, "project_missing");
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn refuses_a_workspace_the_classifier_would_refuse() {
        let root = temp_workspace("ambiguous");
        write_sb3(&root.join("a.sb3"), USABLE_SB3);
        write_sb3(&root.join("b.sb3"), USABLE_SB3);
        let (reason, message) = resolve_project(&root).unwrap_err();
        assert_eq!(reason, "project_missing");
        assert!(message.contains("scratch_multiple_projects") || message.contains("more than one"));
        let _ = fs::remove_dir_all(root);
    }

    /// A `.sb3` that is a symlink out of the workspace must never be read. The
    /// classifier's candidate scan uses `is_file()`, which follows the link and
    /// reports it, and `WorkspaceRoot::resolve` then canonicalizes and finds it
    /// outside the root. Either refusal is acceptable; reading it is not, so the
    /// assertion is on the outcome the caller depends on.
    #[test]
    fn a_symlinked_project_pointing_outside_the_workspace_is_never_read() {
        let root = temp_workspace("escape");
        let outside = temp_workspace("outside");
        let outside_project = outside.join("evil.sb3");
        write_sb3(&outside_project, USABLE_SB3);
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(&outside_project, root.join("game.sb3")).unwrap();
            let resolved = resolve_project(&root);
            assert!(
                resolved.is_err(),
                "a .sb3 escaping the workspace must be refused, not read"
            );
            if let Ok((_, absolute)) = resolved {
                let canonical = fs::canonicalize(&root).unwrap();
                assert!(
                    absolute.starts_with(&canonical),
                    "a resolved project must stay inside the workspace"
                );
            }
        }
        let _ = fs::remove_dir_all(root);
        let _ = fs::remove_dir_all(outside);
    }
}
