use tauri::State;

use crate::core::credential_store::CredentialStore;
use crate::core::settings_store::SettingsStore;
use crate::models::sftp::{
    CreateDirectoryRequest, DeletePathRequest, ListDirectoryRequest, RenamePathRequest, SftpEntry,
};
use crate::ssh::sftp_manager;

#[tauri::command]
pub async fn list_directory(
    settings_store: State<'_, SettingsStore>,
    credential_store: State<'_, CredentialStore>,
    request: ListDirectoryRequest,
) -> Result<Vec<SftpEntry>, String> {
    sftp_manager::list_directory(
        settings_store.inner().clone(),
        credential_store.inner().clone(),
        request.connection_id,
        request.path,
    )
    .await
}

#[tauri::command]
pub async fn delete_path(
    settings_store: State<'_, SettingsStore>,
    credential_store: State<'_, CredentialStore>,
    request: DeletePathRequest,
) -> Result<(), String> {
    sftp_manager::delete_path(
        settings_store.inner().clone(),
        credential_store.inner().clone(),
        request.connection_id,
        request.path,
    )
    .await
}

#[tauri::command]
pub async fn rename_path(
    settings_store: State<'_, SettingsStore>,
    credential_store: State<'_, CredentialStore>,
    request: RenamePathRequest,
) -> Result<(), String> {
    sftp_manager::rename_path(
        settings_store.inner().clone(),
        credential_store.inner().clone(),
        request.connection_id,
        request.from,
        request.to,
    )
    .await
}

#[tauri::command]
pub async fn create_directory(
    settings_store: State<'_, SettingsStore>,
    credential_store: State<'_, CredentialStore>,
    request: CreateDirectoryRequest,
) -> Result<(), String> {
    sftp_manager::create_directory(
        settings_store.inner().clone(),
        credential_store.inner().clone(),
        request.connection_id,
        request.path,
    )
    .await
}
