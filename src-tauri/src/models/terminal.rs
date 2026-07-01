use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OpenTerminalRequest {
    pub connection_id: String,
    pub cols: u16,
    pub rows: u16,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TerminalResizeRequest {
    pub session_id: String,
    pub cols: u16,
    pub rows: u16,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TerminalSessionResponse {
    pub session_id: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct TerminalOutputEvent {
    pub session_id: String,
    pub data: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status: Option<String>,
}
