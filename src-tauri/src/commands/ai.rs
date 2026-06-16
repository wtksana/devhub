use crate::core::ai_client;
use crate::models::ai::{AiChatRequest, AiChatResponse};

#[tauri::command]
pub async fn ai_chat(request: AiChatRequest) -> Result<AiChatResponse, String> {
    ai_client::chat(request).await
}
