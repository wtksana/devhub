use tauri::State;

use crate::core::ai_client;
use crate::core::credential_store::CredentialStore;
use crate::core::settings_store::SettingsStore;
use crate::models::ai::{AiChatRequest, AiChatResponse};

#[tauri::command]
pub async fn ai_chat(
    settings_store: State<'_, SettingsStore>,
    credential_store: State<'_, CredentialStore>,
    request: AiChatRequest,
) -> Result<AiChatResponse, String> {
    ai_client::chat(settings_store.inner(), credential_store.inner(), request).await
}
