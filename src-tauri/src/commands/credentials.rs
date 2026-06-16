use serde::Deserialize;
use tauri::State;

use crate::core::credential_store::CredentialStore;

#[derive(Debug, Deserialize)]
pub struct SaveCredentialRequest {
    pub id: String,
    pub secret: String,
}

#[tauri::command]
pub async fn save_credential(
    credential_store: State<'_, CredentialStore>,
    request: SaveCredentialRequest,
) -> Result<(), String> {
    credential_store
        .set_secret(&request.id, &request.secret)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn delete_credential(
    credential_store: State<'_, CredentialStore>,
    id: String,
) -> Result<(), String> {
    credential_store
        .delete_secret(&id)
        .map_err(|error| error.to_string())
}
