use tauri::http::HeaderMap;
use tauri::ipc::{Channel, InvokeBody, Request, Response};
use tauri::{AppHandle, State};

use crate::commands::logging::log_operation;
use crate::core::app_logger::AppLogger;
use crate::core::credential_store::CredentialStore;
use crate::core::settings_store::SettingsStore;
use crate::models::terminal::{
    OpenTerminalRequest, TerminalResizeRequest, TerminalSessionResponse,
};
use crate::ssh::session_manager::{OpenTerminalSessionRequest, SessionManager};

const TERMINAL_SESSION_ID_HEADER: &str = "x-devhub-terminal-session-id";

#[derive(Debug)]
struct TerminalRawInput {
    session_id: String,
    data: String,
}

#[tauri::command]
pub async fn open_terminal(
    app: AppHandle,
    sessions: State<'_, SessionManager>,
    settings_store: State<'_, SettingsStore>,
    credential_store: State<'_, CredentialStore>,
    logger: State<'_, AppLogger>,
    request: OpenTerminalRequest,
    on_output: Channel<Response>,
) -> Result<TerminalSessionResponse, String> {
    let started_at = std::time::Instant::now();
    let connection_id = request.connection_id.clone();
    let result = sessions
        .open_terminal(
            app,
            settings_store.inner(),
            credential_store.inner(),
            OpenTerminalSessionRequest {
                connection_id: request.connection_id,
                cols: request.cols,
                rows: request.rows,
                on_output,
            },
        )
        .await
        .map(|session_id| TerminalSessionResponse { session_id })
        .map_err(|error| error.to_string());
    match &result {
        Ok(_) => log_operation(
            settings_store.inner(),
            logger.inner(),
            "info",
            "terminal",
            "open_terminal",
            Some(connection_id),
            "success",
            Some(started_at),
            None,
            None,
        ),
        Err(error) => log_operation(
            settings_store.inner(),
            logger.inner(),
            "error",
            "terminal",
            "open_terminal",
            Some(connection_id),
            "failed",
            Some(started_at),
            Some(error.clone()),
            None,
        ),
    }
    result
}

#[tauri::command]
pub async fn write_terminal(
    sessions: State<'_, SessionManager>,
    request: Request<'_>,
) -> Result<(), String> {
    let request = terminal_input_from_raw_parts(request.headers(), request.body())?;
    sessions
        .write_terminal(&request.session_id, request.data)
        .await
        .map_err(|error| error.to_string())
}

fn terminal_input_from_raw_parts(
    headers: &HeaderMap,
    body: &InvokeBody,
) -> Result<TerminalRawInput, String> {
    match body {
        InvokeBody::Raw(bytes) => {
            let session_id = headers
                .get(TERMINAL_SESSION_ID_HEADER)
                .and_then(|value| value.to_str().ok())
                .filter(|value| !value.trim().is_empty())
                .ok_or_else(|| "missing terminal session id".to_string())?
                .to_string();
            let data = String::from_utf8(bytes.clone())
                .map_err(|_| "terminal input must be utf-8".to_string())?;
            Ok(TerminalRawInput { session_id, data })
        }
        InvokeBody::Json(_) => Err("terminal input must use raw body".to_string()),
    }
}

#[tauri::command]
pub async fn resize_terminal(
    sessions: State<'_, SessionManager>,
    request: TerminalResizeRequest,
) -> Result<(), String> {
    sessions
        .resize_terminal(&request.session_id, request.cols, request.rows)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn close_terminal(
    sessions: State<'_, SessionManager>,
    settings_store: State<'_, SettingsStore>,
    logger: State<'_, AppLogger>,
    session_id: String,
) -> Result<(), String> {
    let started_at = std::time::Instant::now();
    let target = session_id.clone();
    sessions.close(&session_id).await;
    log_operation(
        settings_store.inner(),
        logger.inner(),
        "info",
        "terminal",
        "close_terminal",
        Some(target),
        "success",
        Some(started_at),
        None,
        None,
    );
    Ok(())
}

#[cfg(test)]
mod tests {
    use tauri::http::{HeaderMap, HeaderValue};
    use tauri::ipc::InvokeBody;

    use super::terminal_input_from_raw_parts;

    #[test]
    fn parses_raw_terminal_input_from_body_and_session_header() {
        let mut headers = HeaderMap::new();
        headers.insert(
            "x-devhub-terminal-session-id",
            HeaderValue::from_static("session-1"),
        );
        let body = InvokeBody::Raw("dev 用户\r".as_bytes().to_vec());

        let input = terminal_input_from_raw_parts(&headers, &body).unwrap();

        assert_eq!(input.session_id, "session-1");
        assert_eq!(input.data, "dev 用户\r");
    }

    #[test]
    fn rejects_json_terminal_input_request() {
        let headers = HeaderMap::new();
        let body = InvokeBody::Json(serde_json::json!({
            "request": {
                "session_id": "session-1",
                "data": "pwd\r"
            }
        }));

        let error = terminal_input_from_raw_parts(&headers, &body).unwrap_err();

        assert_eq!(error, "terminal input must use raw body");
    }
}
