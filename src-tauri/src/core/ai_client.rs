use serde::{Deserialize, Serialize};

use crate::core::credential_store::CredentialStore;
use crate::core::settings_store::SettingsStore;
use crate::models::ai::{AiChatRequest, AiChatResponse};
use crate::models::settings::AiSettings;

const SYSTEM_PROMPT: &str =
    "You are DevHub AI. Generate explanations and commands, but never execute anything.";

#[derive(Debug, Serialize)]
struct ChatCompletionRequest {
    model: String,
    messages: Vec<ChatMessage>,
    stream: bool,
}

#[derive(Debug, Serialize)]
struct ChatMessage {
    role: String,
    content: String,
}

#[derive(Debug, Deserialize)]
struct ChatCompletionResponse {
    choices: Vec<ChatChoice>,
}

#[derive(Debug, Deserialize)]
struct ChatChoice {
    message: ChatResponseMessage,
}

#[derive(Debug, Deserialize)]
struct ChatResponseMessage {
    content: String,
}

pub async fn chat(
    settings_store: &SettingsStore,
    credential_store: &CredentialStore,
    request: AiChatRequest,
) -> Result<AiChatResponse, String> {
    let settings = settings_store
        .load_or_create()
        .map_err(|error| error.to_string())?;
    let api_key = credential_store
        .get_secret(&settings.ai.api_key_ref)
        .map_err(|error| format!("missing AI credential: {error}"))?;

    chat_with_provider(request, settings.ai, api_key).await
}

pub async fn chat_with_provider(
    request: AiChatRequest,
    settings: AiSettings,
    api_key: String,
) -> Result<AiChatResponse, String> {
    if request.prompt.trim().is_empty() {
        return Err("prompt is required".to_string());
    }

    let endpoint = format!(
        "{}/chat/completions",
        settings.base_url.trim_end_matches('/')
    );
    let response = reqwest::Client::new()
        .post(endpoint)
        .bearer_auth(&api_key)
        .json(&ChatCompletionRequest {
            model: settings.model,
            messages: vec![
                ChatMessage {
                    role: "system".to_string(),
                    content: SYSTEM_PROMPT.to_string(),
                },
                ChatMessage {
                    role: "user".to_string(),
                    content: user_content(&request),
                },
            ],
            stream: false,
        })
        .send()
        .await
        .map_err(|error| redact_secret(&error.to_string(), &api_key))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(redact_secret(
            &format!("AI provider request failed with status {status}: {body}"),
            &api_key,
        ));
    }

    let body = response
        .json::<ChatCompletionResponse>()
        .await
        .map_err(|error| redact_secret(&error.to_string(), &api_key))?;
    let text = body
        .choices
        .into_iter()
        .next()
        .map(|choice| choice.message.content)
        .filter(|content| !content.trim().is_empty())
        .ok_or_else(|| "AI provider returned an empty response".to_string())?;

    Ok(AiChatResponse { text })
}

pub fn redact_secret(message: &str, secret: &str) -> String {
    if secret.is_empty() {
        return message.to_string();
    }

    message.replace(secret, "[redacted]")
}

fn user_content(request: &AiChatRequest) -> String {
    match request
        .context
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        Some(context) => format!("Context:\n{context}\n\nUser request:\n{}", request.prompt),
        None => request.prompt.clone(),
    }
}
