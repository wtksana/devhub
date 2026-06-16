use crate::models::ai::{AiChatRequest, AiChatResponse};

pub async fn chat(request: AiChatRequest) -> Result<AiChatResponse, String> {
    if request.prompt.trim().is_empty() {
        return Err("prompt is required".to_string());
    }

    Ok(AiChatResponse {
        text:
            "AI Provider wiring will use BYOK settings and never auto-execute generated commands."
                .to_string(),
    })
}
