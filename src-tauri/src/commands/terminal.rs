use tauri::{AppHandle, State};

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
    request: OpenTerminalRequest,
) -> Result<TerminalSessionResponse, String> {
    let session_id = sessions
        .open_terminal(
            app,
            settings_store.inner(),
            credential_store.inner(),
            request.connection_id,
            request.cols,
            request.rows,
        )
        .await
        .map_err(|error| error.to_string())?;
    Ok(TerminalSessionResponse { session_id })
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
    session_id: String,
) -> Result<(), String> {
    sessions.close(&session_id).await;
    Ok(())
}
