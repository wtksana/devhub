use crate::core::ai_client::{chat_with_provider, redact_secret};
use crate::models::ai::AiChatRequest;
use crate::models::settings::AiSettings;

#[tokio::test]
async fn rejects_empty_ai_prompt() {
    let request = AiChatRequest {
        prompt: "   ".to_string(),
        context: None,
    };
    let settings = AiSettings {
        provider: "openai_compatible".to_string(),
        base_url: "https://api.example.test/v1".to_string(),
        model: "test-model".to_string(),
        api_key_ref: "ai:default".to_string(),
    };

    let error = chat_with_provider(request, settings, "secret-key".to_string())
        .await
        .unwrap_err();

    assert_eq!(error, "prompt is required");
}

#[test]
fn redacts_api_key_from_errors() {
    let error = redact_secret(
        "request failed with bearer sk-test-secret",
        "sk-test-secret",
    );

    assert_eq!(error, "request failed with bearer [redacted]");
}
