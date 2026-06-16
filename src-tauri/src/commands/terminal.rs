use tauri::State;

use crate::models::terminal::{
    OpenTerminalRequest, TerminalInputRequest, TerminalResizeRequest, TerminalSessionResponse,
};
use crate::ssh::session_manager::SessionManager;

#[tauri::command]
pub async fn open_terminal(
    sessions: State<'_, SessionManager>,
    request: OpenTerminalRequest,
) -> Result<TerminalSessionResponse, String> {
    let session_id = sessions.create_placeholder(request.connection_id).await;
    Ok(TerminalSessionResponse { session_id })
}

#[tauri::command]
pub async fn write_terminal(
    _sessions: State<'_, SessionManager>,
    _request: TerminalInputRequest,
) -> Result<(), String> {
    Ok(())
}

#[tauri::command]
pub async fn resize_terminal(
    _sessions: State<'_, SessionManager>,
    _request: TerminalResizeRequest,
) -> Result<(), String> {
    Ok(())
}

#[tauri::command]
pub async fn close_terminal(
    sessions: State<'_, SessionManager>,
    session_id: String,
) -> Result<(), String> {
    sessions.close(&session_id).await;
    Ok(())
}
