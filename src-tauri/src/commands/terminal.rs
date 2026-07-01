use tauri::ipc::{Channel, Response};
use tauri::{AppHandle, State};

use crate::commands::logging::log_operation;
use crate::core::app_logger::AppLogger;
use crate::core::credential_store::CredentialStore;
use crate::core::settings_store::SettingsStore;
use crate::models::terminal::{
    OpenTerminalRequest, TerminalInputRequest, TerminalResizeRequest, TerminalSessionResponse,
};
use crate::ssh::session_manager::SessionManager;

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
            request.connection_id,
            request.cols,
            request.rows,
            on_output,
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
    request: TerminalInputRequest,
) -> Result<(), String> {
    sessions
        .write_terminal(&request.session_id, request.data)
        .await
        .map_err(|error| error.to_string())
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
