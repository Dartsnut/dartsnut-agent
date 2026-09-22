use crate::commands::AppState;
use reqwest::header::{HeaderMap, HeaderValue};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::fs;
use std::path::PathBuf;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::time::{sleep, Duration};

pub const AGENT_EVENT: &str = "agent:events";
const MAX_TURNS: usize = 128;
const MAX_ATTEMPTS: usize = 3;
const WORKSPACE_FIX_ROUNDS: usize = 2;

fn requests_removed_hosted_tool(prompt: &str) -> bool {
    let prompt = prompt.to_ascii_lowercase();
    [
        "web search",
        "search the web",
        "browse the internet",
        "code interpreter",
        "python sandbox",
        "run python",
    ]
    .iter()
    .any(|term| prompt.contains(term))
}

#[derive(Default)]
pub struct AgentState {
    pub(crate) active: Mutex<Option<Arc<AtomicBool>>>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PromptRequest {
    pub prompt: String,
    pub chat_media_attachments: Option<Vec<ChatMediaAttachment>>,
    pub chat_id: Option<String>,
    pub agent_session: Option<SessionIntent>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatMediaAttachment {
    pub id: String,
    pub path: String,
    pub workspace_path: Option<String>,
    pub name: String,
    pub mime_type: String,
    pub kind: String,
    pub size: Option<u64>,
}

fn prepare_chat_attachments(
    workspace_root: &std::path::Path,
    attachments: &[ChatMediaAttachment],
) -> Result<Vec<(String, String)>, String> {
    let root = std::fs::canonicalize(workspace_root).map_err(|e| e.to_string())?;
    let mut paths = Vec::with_capacity(attachments.len());
    for attachment in attachments {
        if let Some(relative) = attachment
            .workspace_path
            .as_deref()
            .filter(|value| !value.trim().is_empty())
        {
            let path = crate::workspace::WorkspaceRoot::open(&root)
                .map_err(|error| error.to_string())?
                .resolve(relative)
                .map_err(|error| error.to_string())?;
            if !path.is_file() {
                return Err(format!(
                    "attachment workspace path is not a file: {relative}"
                ));
            }
            paths.push((attachment.id.clone(), relative.replace('\\', "/")));
            continue;
        }
        let source = std::fs::canonicalize(&attachment.path)
            .map_err(|_| format!("attachment source not found: {}", attachment.name))?;
        if !source.is_file() {
            return Err(format!(
                "attachment source is not a file: {}",
                attachment.name
            ));
        }
        let safe_name: String = attachment
            .name
            .chars()
            .map(|ch| {
                if ch.is_ascii_alphanumeric() || matches!(ch, '.' | '-' | '_') {
                    ch
                } else {
                    '_'
                }
            })
            .take(120)
            .collect();
        let safe_id: String = attachment
            .id
            .chars()
            .map(|ch| {
                if ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_') {
                    ch
                } else {
                    '_'
                }
            })
            .take(80)
            .collect();
        let relative = format!(
            "assets/chat-attachments/{}-{}",
            if safe_id.is_empty() {
                "attachment"
            } else {
                &safe_id
            },
            if safe_name.is_empty() {
                "file"
            } else {
                &safe_name
            }
        );
        let destination = root.join(&relative);
        if !destination.starts_with(&root) {
            return Err("attachment destination escapes workspace root".to_owned());
        }
        if source != destination {
            if let Some(parent) = destination.parent() {
                std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
            }
            std::fs::copy(&source, &destination).map_err(|e| e.to_string())?;
        }
        paths.push((attachment.id.clone(), relative));
    }
    Ok(paths)
}
#[derive(Clone, Debug, Deserialize)]
pub struct SessionIntent {
    pub intent: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TranscriptLine {
    pub kind: String,
    pub at: i64,
    pub text: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_call: Option<Value>,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SessionFile {
    chat_id: Option<String>,
    session_id: Option<String>,
    updated_at: Option<String>,
    turn_count: usize,
    previous_response_id: Option<String>,
    transcript: Vec<TranscriptLine>,
}

fn now_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

fn compact_tool_text(name: &str, status: &str, result: &Value, error: Option<&str>) -> String {
    if let Some(error) = error.filter(|value| !value.is_empty()) {
        return format!("{name} {status}: {error}");
    }
    let preview = match result {
        Value::Null => String::new(),
        other => other.to_string(),
    };
    if preview.is_empty() {
        format!("{name} {status}")
    } else {
        format!("{name} {status}: {preview}")
    }
}

fn tools_ran_since(transcript: &[TranscriptLine], start: usize) -> bool {
    transcript
        .get(start..)
        .into_iter()
        .flatten()
        .any(|line| line.kind == "tool")
}

fn should_retry_agent_attempt(attempt: usize, tools_this_attempt: bool) -> bool {
    attempt < MAX_ATTEMPTS && !tools_this_attempt
}

fn should_retry_empty_assistant(attempt: usize, mutated: bool) -> bool {
    attempt < MAX_ATTEMPTS && !mutated
}

fn app_mutated_since(transcript: &[TranscriptLine], start: usize) -> bool {
    transcript.get(start..).into_iter().flatten().any(|line| {
        let Some(name) = line.tool_name.as_deref() else {
            return false;
        };
        if !matches!(
            name,
            "apply_patch" | "copy_asset_file" | "copy_chat_attachment"
        ) {
            return false;
        }
        if let Some(tool_call) = &line.tool_call {
            return tool_call.get("phase").and_then(Value::as_str) == Some("finished")
                && tool_call.get("status").and_then(Value::as_str) == Some("succeeded");
        }
        line.text.contains("succeeded")
    })
}


fn is_resume_prompt(prompt: &str) -> bool {
    let trimmed = prompt
        .trim()
        .trim_end_matches(['.', '!', '?'])
        .trim()
        .to_ascii_lowercase();
    matches!(
        trimmed.as_str(),
        "resume" | "continue" | "keep going" | "try again" | "go on"
    )
}

fn last_actionable_user_prompt(transcript: &[TranscriptLine]) -> Option<&str> {
    transcript.iter().rev().find_map(|line| {
        if line.kind != "user" {
            return None;
        }
        let text = line.text.trim();
        if text.is_empty() || is_resume_prompt(text) {
            None
        } else {
            Some(text)
        }
    })
}

fn resume_model_prompt(prompt: &str, transcript: &[TranscriptLine]) -> String {
    if !is_resume_prompt(prompt) {
        return prompt.to_owned();
    }
    let Some(original) = last_actionable_user_prompt(transcript) else {
        return prompt.to_owned();
    };
    format!(
        "Resume the interrupted work on this user request:\n{original}\n\nContinue from the current workspace and emulator state. Do not re-survey the project as if this were a new request. Finish the original request."
    )
}

fn repair_prompt(user_prompt: &str, reason: &str) -> String {
    format!(
        "Continue this user request:\n{user_prompt}\n\nThe workspace is not runnable: {reason}. Make the minimum changes needed to leave the requested game or widget runnable, then finish. The user's requested behavior remains the priority; choose any tools and checks needed, and preserve unrelated files."
    )
}

fn record_stream_event(app: &AppHandle, session: &mut SessionFile, event: crate::rig_runtime::StreamEvent) {
    match event {
        crate::rig_runtime::StreamEvent::TextDelta(delta) => emit(
            app,
            json!({"type":"text_delta","source":"rig","delta":delta}),
        ),
        crate::rig_runtime::StreamEvent::ToolCallStarted {
            run_id,
            call_id,
            name,
            arguments,
        } => {
            let at = now_ms();
            let event = json!({"type":"tool_call","phase":"started","at":at,"runId":run_id,"callId":call_id,"toolName":name,"inputPreview":arguments});
            session.transcript.push(TranscriptLine {
                kind: "tool".into(),
                at,
                text: String::new(),
                tool_name: event.get("toolName").and_then(Value::as_str).map(str::to_owned),
                tool_call: Some(event.clone()),
            });
            let _ = persist_session(app, session);
            emit(app, event);
        }
        crate::rig_runtime::StreamEvent::ToolCallFinished {
            run_id,
            call_id,
            name,
            status,
            duration_ms,
            result,
            error,
        } => {
            let at = now_ms();
            let text = compact_tool_text(&name, &status, &result, error.as_deref());
            let event = json!({"type":"tool_call","phase":"finished","at":at,"runId":run_id,"callId":call_id,"toolName":name,"status":status,"durationMs":duration_ms,"resultPreview":result,"error":error});
            session.transcript.push(TranscriptLine {
                kind: "tool".into(),
                at,
                text,
                tool_name: event.get("toolName").and_then(Value::as_str).map(str::to_owned),
                tool_call: Some(event.clone()),
            });
            let _ = persist_session(app, session);
            emit(app, event);
        }
    }
}

fn session_path(app: &AppHandle, chat_id: Option<&str>) -> Result<PathBuf, String> {
    let root = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("agent-sessions");
    fs::create_dir_all(&root).map_err(|e| e.to_string())?;
    let raw = chat_id.unwrap_or("workspace");
    let safe = raw
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_') {
                ch
            } else {
                '_'
            }
        })
        .take(120)
        .collect::<String>();
    Ok(root.join(format!(
        "{}.json",
        if safe.is_empty() { "workspace" } else { &safe }
    )))
}
fn load_session(app: &AppHandle, chat_id: Option<&str>) -> SessionFile {
    session_path(app, chat_id)
        .ok()
        .and_then(|p| fs::read_to_string(p).ok())
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_else(|| SessionFile {
            chat_id: chat_id.map(str::to_owned),
            ..Default::default()
        })
}
fn persist_session(app: &AppHandle, session: &SessionFile) -> Result<(), String> {
    let path = session_path(app, session.chat_id.as_deref())?;
    let tmp = path.with_extension("json.tmp");
    fs::write(
        &tmp,
        serde_json::to_vec_pretty(session).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    fs::rename(tmp, path).map_err(|e| e.to_string())
}
fn emit(app: &AppHandle, value: Value) {
    let _ = app.emit(AGENT_EVENT, value);
}
#[tauri::command]
pub async fn send_prompt(
    app: AppHandle,
    state: State<'_, AppState>,
    payload: Value,
) -> Result<Value, String> {
    let payload_value = payload.get("payload").cloned().unwrap_or(payload);
    let payload: PromptRequest =
        serde_json::from_value(payload_value).map_err(|e| e.to_string())?;
    if payload.prompt.trim().is_empty() {
        return Ok(json!({"ok":false,"message":"prompt is required"}));
    }
    if requests_removed_hosted_tool(&payload.prompt) {
        emit(
            &app,
            json!({"type":"error","code":"unsupported_hosted_tool","message":"Hosted web search and code interpreter are unavailable in this build","at":now_ms()}),
        );
        return Ok(
            json!({"ok":false,"failureReason":"unsupported_hosted_tool","message":"Hosted web search and code interpreter are unavailable in this build"}),
        );
    }
    let cancel = Arc::new(AtomicBool::new(false));
    {
        let mut active = state
            .agent
            .active
            .lock()
            .map_err(|_| "agent state unavailable")?;
        if active.is_some() {
            return Ok(json!({"ok":false,"failureReason":"run_already_active"}));
        }
        *active = Some(cancel.clone());
    }
    let result = run_prompt(&app, &cancel, payload).await;
    if let Ok(mut active) = state.agent.active.lock() {
        *active = None;
    }
    if let Ok(mut attachments) = state.chat_attachments.lock() {
        attachments.clear();
    }
    result
}

async fn run_prompt(
    app: &AppHandle,
    cancel: &Arc<AtomicBool>,
    payload: PromptRequest,
) -> Result<Value, String> {
    let workspace_root = app
        .state::<AppState>()
        .workspace_root
        .lock()
        .ok()
        .and_then(|value| value.clone());
    let attachment_entries = match (
        workspace_root.as_deref(),
        payload.chat_media_attachments.as_deref(),
    ) {
        (Some(root), Some(attachments)) => prepare_chat_attachments(root, attachments)?,
        (None, Some(attachments)) if !attachments.is_empty() => {
            return Ok(json!({
                "ok": false,
                "failureReason": "workspace_not_selected",
                "message": "Select a workspace before using chat attachments"
            }));
        }
        _ => Vec::new(),
    };
    if let Ok(mut registry) = app.state::<AppState>().chat_attachments.lock() {
        registry.clear();
        for (id, relative) in &attachment_entries {
            registry.insert(id.clone(), relative.clone());
        }
    }
    let attachment_paths = attachment_entries
        .iter()
        .map(|(_, relative)| relative.clone())
        .collect::<Vec<_>>();
    let effective_prompt = if attachment_paths.is_empty() {
        payload.prompt.clone()
    } else {
        format!(
            "{}\n\nAttached media files (already copied into workspace):\n{}\n\nUse only these workspace-relative paths in code/config.",
            payload.prompt.trim(),
            attachment_paths.iter().map(|path| format!("- {path}")).collect::<Vec<_>>().join("\n")
        )
    };
    let mut session = load_session(app, payload.chat_id.as_deref());
    if payload
        .agent_session
        .as_ref()
        .is_some_and(|x| x.intent == "fresh")
    {
        session = SessionFile {
            chat_id: payload.chat_id.clone(),
            ..Default::default()
        };
    }
    if session.turn_count >= MAX_TURNS {
        return Ok(
            json!({"ok":false,"failureReason":"run_expired","message":"Maximum 128 turns reached"}),
        );
    }
    let model_prompt = resume_model_prompt(&effective_prompt, &session.transcript);
    session.turn_count += 1;
    session.transcript.push(TranscriptLine {
        kind: "user".into(),
        at: now_ms(),
        text: effective_prompt.clone(),
        tool_name: None,
        tool_call: None,
    });
    emit(
        app,
        json!({"type":"status","message":"Agent running","at":now_ms()}),
    );
    let settings = crate::commands::read_provider_settings(app);
    let (base_url, api_key, model, bridge_run_id, bridge_headers, api_format): (
        String,
        String,
        String,
        Option<String>,
        Option<HeaderMap>,
        Option<String>,
    ) = if settings.active_provider == "dartsnut-llm" {
        let run_id = uuid::Uuid::new_v4().to_string();
        if let Err(error) = crate::desktop_commands::community_llm_start_run(app, &run_id).await {
            let failure_reason = if error.contains("Sign in") {
                "auth_required"
            } else {
                "service_unavailable"
            };
            return Ok(
                json!({"ok":false,"failureReason":failure_reason,"message":format!("Dartsnut LLM unavailable: {error}")}),
            );
        }
        let info = crate::desktop_commands::community_llm_info(app).await
            .map_err(|error| format!("LLM endpoint discovery failed: {error}"))?;
        let parsed_format = info.api_format.parse::<crate::api_format::ApiFormat>()
            .map_err(|_| format!("Unsupported API format: {}", info.api_format))?;
        if parsed_format == crate::api_format::ApiFormat::Auto {
            return Ok(json!({"ok":false,"message":"Server returned unresolved format: auto"}));
        }
        let token = crate::desktop_commands::community_token(app)
            .ok_or_else(|| "Sign in to your Dartsnut account to use Dartsnut LLM.".to_owned())?;
        let mut headers = HeaderMap::new();
        headers.insert(
            "token",
            HeaderValue::from_str(&token)
                .map_err(|_| "Invalid Dartsnut session token".to_owned())?,
        );
        headers.insert("source", HeaderValue::from_static("agent"));
        headers.insert(
            "x-dartsnut-source",
            HeaderValue::from_static("desktop-tauri"),
        );
        headers.insert(
            "x-dartsnut-agent-run-id",
            HeaderValue::from_str(&run_id).map_err(|_| "Invalid Dartsnut run ID".to_owned())?,
        );
        let base_url = format!("{}/agent/llm", crate::desktop_commands::community_base_url()?);
        let model_name = if parsed_format == crate::api_format::ApiFormat::Gemini {
            // Gemini: use discovered model name, rig-agent constructs paths
            info.model.clone()
        } else {
            // Other formats: use full path as model (path already includes /v1/...)
            info.path.clone()
        };
        (
            base_url,
            "dartsnut-api-bridge".to_owned(),
            model_name,
            Some(run_id),
            Some(headers),
            Some(info.api_format.clone()),
        )
    } else {
        let base = settings.custom.base_url.as_str();
        let key = settings.custom.api_key.as_str();
        let mdl = settings.custom.model.as_str();
        let api_format = settings.custom.api_format.as_deref();
        crate::rig_runtime::validate_agent_configuration(base, key, mdl, api_format)
            .map_err(|error| format!("Rig agent configuration failed: {error}"))?;
        (base.to_owned(), key.to_owned(), mdl.to_owned(), None, None, settings.custom.api_format.clone())
    };
    let mut last_error = String::new();
    for attempt in 1..=MAX_ATTEMPTS {
        if cancel.load(Ordering::Relaxed) {
            return Ok(json!({"ok":false,"message":"cancelled"}));
        }
        // Retry with the original user prompt only. Dumping empty `tool:`
        // transcript lines made Gemini replay the same tool loop from scratch.
        let transcript_len_before_attempt = session.transcript.len();
        let result = crate::rig_runtime::stream_prompt_with_app_headers(
            &base_url,
            &api_key,
            &model,
            &model_prompt,
            session.previous_response_id.clone(),
            workspace_root.clone(),
            cancel.clone(),
            Some(app.clone()),
            bridge_headers.clone(),
            api_format.clone(),
            |event| record_stream_event(app, &mut session, event),
        )
        .await;
        if cancel.load(Ordering::Relaxed) {
            if let Some(run_id) = bridge_run_id.as_deref() {
                crate::desktop_commands::community_llm_finish_run(app, run_id).await;
            }
            return Ok(json!({"ok":false,"message":"cancelled"}));
        }
        match result {
            Ok(mut outcome) => {
                session.previous_response_id = outcome.response_id.clone();
                let mutated =
                    app_mutated_since(&session.transcript, transcript_len_before_attempt);
                if mutated {
                    for _ in 0..WORKSPACE_FIX_ROUNDS {
                        let status =
                            crate::commands::workspace_runnable(workspace_root.as_deref());
                        if status.get("ok").and_then(Value::as_bool) == Some(true) {
                            break;
                        }
                        let reason = status
                            .get("reason")
                            .and_then(Value::as_str)
                            .unwrap_or("invalid_workspace")
                            .to_owned();
                        emit(
                            app,
                            json!({"type":"status","message":format!("Workspace is not runnable: {reason}"),"at":now_ms()}),
                        );
                        let repair_result = crate::rig_runtime::stream_prompt_with_app_headers(
                            &base_url,
                            &api_key,
                            &model,
                            &repair_prompt(&model_prompt, &reason),
                            session.previous_response_id.clone(),
                            workspace_root.clone(),
                            cancel.clone(),
                            Some(app.clone()),
                            bridge_headers.clone(),
                            api_format.clone(),
                            |event| record_stream_event(app, &mut session, event),
                        )
                        .await;
                        if cancel.load(Ordering::Relaxed) {
                            if let Some(run_id) = bridge_run_id.as_deref() {
                                crate::desktop_commands::community_llm_finish_run(app, run_id)
                                    .await;
                            }
                            return Ok(json!({"ok":false,"message":"cancelled"}));
                        }
                        match repair_result {
                            Ok(repair_outcome) => {
                                outcome = repair_outcome;
                                session.previous_response_id = outcome.response_id.clone();
                            }
                            Err(_) => break,
                        }
                    }
                }
                if outcome.output.trim().is_empty()
                    && should_retry_empty_assistant(attempt, mutated)
                {
                    last_error = "empty assistant response".to_owned();
                    emit(
                        app,
                        json!({"type":"status","message":format!("Retrying agent request ({attempt}/{MAX_ATTEMPTS}): empty assistant response"),"at":now_ms()}),
                    );
                    sleep(Duration::from_millis(100 * attempt as u64)).await;
                    continue;
                }
                if outcome.output.trim().is_empty() && !mutated {
                    last_error = "empty assistant response".to_owned();
                    if let Some(run_id) = bridge_run_id.as_deref() {
                        crate::desktop_commands::community_llm_finish_run(app, run_id).await;
                    }
                    emit(
                        app,
                        json!({"type":"error","message":last_error,"at":now_ms()}),
                    );
                    return Ok(json!({"ok":false,"failureReason":"empty_assistant_response","message":"The model finished without a reply. Try sending the request again."}));
                }
                session.updated_at = Some(chrono::Utc::now().to_rfc3339());
                session.transcript.push(TranscriptLine {
                    kind: "assistant".into(),
                    at: now_ms(),
                    text: outcome.output.clone(),
                    tool_name: None,
                    tool_call: None,
                });
                persist_session(app, &session)?;
                emit(
                    app,
                    json!({"type":"final","content":outcome.output,"at":now_ms()}),
                );
                if let Some(run_id) = bridge_run_id.as_deref() {
                    crate::desktop_commands::community_llm_finish_run(app, run_id).await;
                }
                if mutated {
                    let status = crate::commands::workspace_runnable(workspace_root.as_deref());
                    if status.get("ok").and_then(Value::as_bool) != Some(true) {
                        let reason = status
                            .get("reason")
                            .and_then(Value::as_str)
                            .unwrap_or("invalid_workspace");
                        return Ok(json!({
                            "ok": false,
                            "failureReason": "workspace_not_runnable",
                            "message": format!("Workspace is not runnable: {reason}")
                        }));
                    }
                }
                return Ok(json!({"ok":true}));
            }
            Err(e) => {
                last_error = e.to_string();
                eprintln!("Agent request attempt {} failed: {}", attempt, last_error);
            }
        }
        let tools_this_attempt = tools_ran_since(&session.transcript, transcript_len_before_attempt);
        if !should_retry_agent_attempt(attempt, tools_this_attempt) {
            break;
        }
        emit(
            app,
            json!({"type":"status","message":format!("Retrying agent request ({attempt}/{MAX_ATTEMPTS}): {}", last_error),"at":now_ms()}),
        );
        sleep(Duration::from_millis(100 * attempt as u64)).await;
    }
    if last_error.contains("UNSUPPORTED_API_FORMAT") || last_error.contains("unsupported_api_format") {
        return Ok(json!({
            "ok": false,
            "failureReason": "service_unavailable",
            "message": "The server's LLM configuration changed. Please try again."
        }));
    }
    if let Some(run_id) = bridge_run_id.as_deref() {
        crate::desktop_commands::community_llm_finish_run(app, run_id).await;
    }
    emit(
        app,
        json!({"type":"error","message":last_error,"at":now_ms()}),
    );
    Ok(json!({"ok":false,"message":last_error}))
}

#[tauri::command]
pub fn cancel_agent(app: AppHandle, state: State<'_, AppState>) -> Result<Value, String> {
    crate::pending_inputs::cancel_pending(&app, &state);
    if let Some(flag) = state
        .agent
        .active
        .lock()
        .map_err(|_| "agent state unavailable")?
        .as_ref()
    {
        flag.store(true, Ordering::Relaxed);
    }
    Ok(json!({"ok":true}))
}

#[tauri::command]
pub fn get_workspace_session_summary(app: AppHandle, payload: Option<String>) -> Value {
    let s = load_session(&app, payload.as_deref());
    let tail = s
        .transcript
        .iter()
        .rev()
        .take(1000)
        .cloned()
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect::<Vec<_>>();
    json!({"chatId":s.chat_id,"hasPersistedSession":s.updated_at.is_some(),"sessionId":s.session_id,"updatedAt":s.updated_at,"templateMode":null,"transcriptTail":tail,"tokenUsage":null,"agentProfileId":null})
}

#[tauri::command]
pub fn reset_workspace_session(app: AppHandle, payload: Option<String>) -> Result<Value, String> {
    match fs::remove_file(session_path(&app, payload.as_deref())?) {
        Ok(()) => Ok(json!({"ok":true})),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(json!({"ok":true})),
        Err(e) => Err(e.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn limits() {
        assert_eq!(MAX_TURNS, 128);
        assert_eq!(MAX_ATTEMPTS, 3);
    }
    #[test]
    fn cancel() {
        let x = Arc::new(AtomicBool::new(false));
        x.store(true, Ordering::Relaxed);
        assert!(x.load(Ordering::Relaxed));
    }

    #[test]
    fn hosted_tools_are_explicitly_unsupported() {
        assert!(requests_removed_hosted_tool("please search the web"));
        assert!(requests_removed_hosted_tool("run python in the sandbox"));
        assert!(!requests_removed_hosted_tool("build a darts game"));
    }

    #[test]
    fn retries_stop_after_tools_already_ran() {
        assert!(should_retry_agent_attempt(1, false));
        assert!(!should_retry_agent_attempt(1, true));
        assert!(!should_retry_agent_attempt(3, false));
        assert!(should_retry_empty_assistant(1, false));
        assert!(!should_retry_empty_assistant(1, true));
        assert!(!should_retry_empty_assistant(3, false));
        let transcript = vec![
            TranscriptLine {
                kind: "user".into(),
                at: 1,
                text: "the strands are too overpowering".into(),
                tool_name: None,
                tool_call: None,
            },
            TranscriptLine {
                kind: "tool".into(),
                at: 2,
                text: "apply_patch succeeded: {\"ok\":true}".into(),
                tool_name: Some("apply_patch".into()),
                tool_call: None,
            },
        ];
        assert!(!tools_ran_since(&transcript, 2));
        assert!(tools_ran_since(&transcript, 1));
        assert_eq!(
            compact_tool_text("observe_emulator", "succeeded", &Value::Null, None),
            "observe_emulator succeeded"
        );
    }

    fn tool_event(
        name: &str,
        text: &str,
        tool_call: Option<Value>,
    ) -> TranscriptLine {
        TranscriptLine {
            kind: "tool".into(),
            at: 1,
            text: text.into(),
            tool_name: Some(name.into()),
            tool_call,
        }
    }

    #[test]
    fn app_mutation_tracks_finished_successful_content_events() {
        let apply = tool_event(
            "apply_patch",
            "apply_patch succeeded: {\"ok\":true}",
            Some(json!({"type":"tool_call","phase":"finished","status":"succeeded","toolName":"apply_patch"})),
        );
        let copy_asset = tool_event(
            "copy_asset_file",
            "copy_asset_file succeeded",
            Some(json!({"type":"tool_call","phase":"finished","status":"succeeded","toolName":"copy_asset_file"})),
        );
        let compact_copy = tool_event(
            "copy_chat_attachment",
            "copy_chat_attachment succeeded: {\"ok\":true}",
            None,
        );
        assert!(app_mutated_since(&[apply.clone()], 0));
        assert!(app_mutated_since(&[copy_asset.clone()], 0));
        assert!(app_mutated_since(&[compact_copy.clone()], 0));
        assert!(!app_mutated_since(&[apply.clone()], 1));

        let started = tool_event(
            "apply_patch",
            "",
            Some(json!({"type":"tool_call","phase":"started","toolName":"apply_patch"})),
        );
        let failed = tool_event(
            "apply_patch",
            "apply_patch failed: boom",
            Some(json!({"type":"tool_call","phase":"finished","status":"failed","toolName":"apply_patch"})),
        );
        let read = tool_event(
            "read_file",
            "read_file succeeded",
            Some(json!({"type":"tool_call","phase":"finished","status":"succeeded","toolName":"read_file"})),
        );
        let skill = tool_event(
            "get_dartsnut_skill",
            "get_dartsnut_skill succeeded",
            Some(json!({"type":"tool_call","phase":"finished","status":"succeeded","toolName":"get_dartsnut_skill"})),
        );
        let check = tool_event(
            "check_python",
            "check_python succeeded",
            Some(json!({"type":"tool_call","phase":"finished","status":"succeeded","toolName":"check_python"})),
        );
        assert!(!app_mutated_since(&[started], 0));
        assert!(!app_mutated_since(&[failed], 0));
        assert!(!app_mutated_since(&[read], 0));
        assert!(!app_mutated_since(&[skill], 0));
        assert!(!app_mutated_since(&[check], 0));
    }

    #[test]
    fn repair_prompt_keeps_user_request_and_reason() {
        let prompt = repair_prompt("make pong", "missing_main_py");
        assert!(prompt.contains("make pong"));
        assert!(prompt.contains("missing_main_py"));
        assert!(prompt.contains("requested behavior remains the priority"));
    }

    #[test]
    fn chat_attachment_copy_is_workspace_bound_and_deterministic() {
        let root =
            std::env::temp_dir().join(format!("dartsnut-attachments-{}", uuid::Uuid::new_v4()));
        let source = root
            .parent()
            .unwrap()
            .join(format!("outside-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        std::fs::write(&source, b"png").unwrap();
        let attachments = vec![ChatMediaAttachment {
            id: "id/with spaces".into(),
            path: source.to_string_lossy().into_owned(),
            workspace_path: None,
            name: "hero image!.png".into(),
            mime_type: "image/png".into(),
            kind: "image".into(),
            size: Some(3),
        }];
        let copied = prepare_chat_attachments(&root, &attachments).unwrap();
        assert_eq!(copied.len(), 1);
        let relative = &copied[0].1;
        assert!(relative.starts_with("assets/chat-attachments/id_with_spaces-hero_image_.png"));
        assert_eq!(std::fs::read(root.join(relative)).unwrap(), b"png");
        let _ = std::fs::remove_file(source);
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn chat_attachment_workspace_path_rejects_missing_file() {
        let root =
            std::env::temp_dir().join(format!("dartsnut-attachments-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        let attachment = ChatMediaAttachment {
            id: "id".into(),
            path: "unused".into(),
            workspace_path: Some("missing.png".into()),
            name: "missing.png".into(),
            mime_type: "image/png".into(),
            kind: "image".into(),
            size: None,
        };
        assert!(prepare_chat_attachments(&root, &[attachment]).is_err());
        let _ = std::fs::remove_dir_all(root);
    }

    fn user_line(text: &str) -> TranscriptLine {
        TranscriptLine {
            kind: "user".into(),
            at: 1,
            text: text.into(),
            tool_name: None,
            tool_call: None,
        }
    }

    #[test]
    fn resume_prompt_restates_last_real_user_request() {
        let transcript = vec![
            user_line("create a super mario bros game"),
            user_line("btn_a won’t start the game. and mario won’t stop jumping"),
            TranscriptLine {
                kind: "tool".into(),
                at: 2,
                text: "grep_files succeeded".into(),
                tool_name: Some("grep_files".into()),
                tool_call: None,
            },
        ];
        let prompt = resume_model_prompt("Resume", &transcript);
        assert!(prompt.contains("btn_a won’t start the game"));
        assert!(prompt.contains("won’t stop jumping"));
        assert!(!prompt.contains("create a super mario bros game"));
        assert_eq!(resume_model_prompt("keep going", &transcript), prompt);
    }

    #[test]
    fn resume_prompt_skips_prior_resume_messages() {
        let transcript = vec![user_line("fix the jump input"), user_line("resume")];
        let prompt = resume_model_prompt("Resume", &transcript);
        assert!(prompt.contains("fix the jump input"));
    }

    #[test]
    fn ordinary_prompts_are_unchanged() {
        let transcript = vec![user_line("create a super mario bros game")];
        assert_eq!(
            resume_model_prompt("mario jumps are too low", &transcript),
            "mario jumps are too low"
        );
        assert_eq!(resume_model_prompt("Resume", &[]), "Resume");
    }
}
