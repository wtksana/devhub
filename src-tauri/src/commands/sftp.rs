use tauri::{AppHandle, Emitter, State};

use crate::core::credential_store::CredentialStore;
use crate::core::settings_store::SettingsStore;
use crate::models::sftp::{
    CreateDirectoryRequest, DeletePathRequest, ListDirectoryRequest, OpenSftpSessionRequest,
    RenamePathRequest, SftpEntry, SftpSessionPathRequest, SftpSessionRenameRequest,
    SftpDownloadFileRequest, SftpSessionRequest, SftpSessionResponse, SftpTransferProgress,
    SftpUploadFileRequest,
};
use crate::ssh::sftp_manager::{self, SftpSessionManager};

#[tauri::command]
pub async fn open_sftp_session(
    sessions: State<'_, SftpSessionManager>,
    settings_store: State<'_, SettingsStore>,
    credential_store: State<'_, CredentialStore>,
    request: OpenSftpSessionRequest,
) -> Result<SftpSessionResponse, String> {
    let session_id = sessions
        .open_session(
            settings_store.inner().clone(),
            credential_store.inner().clone(),
            request.connection_id,
        )
        .await
        .map_err(|error| error.to_string())?;
    Ok(SftpSessionResponse { session_id })
}

#[tauri::command]
pub async fn close_sftp_session(
    sessions: State<'_, SftpSessionManager>,
    request: SftpSessionRequest,
) -> Result<(), String> {
    sessions.close(&request.session_id).await;
    Ok(())
}

#[tauri::command]
pub async fn list_sftp_directory(
    sessions: State<'_, SftpSessionManager>,
    request: SftpSessionPathRequest,
) -> Result<Vec<SftpEntry>, String> {
    sessions
        .list_directory(&request.session_id, &request.path)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn delete_sftp_path(
    sessions: State<'_, SftpSessionManager>,
    request: SftpSessionPathRequest,
) -> Result<(), String> {
    sessions
        .delete_path(&request.session_id, &request.path)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn rename_sftp_path(
    sessions: State<'_, SftpSessionManager>,
    request: SftpSessionRenameRequest,
) -> Result<(), String> {
    sessions
        .rename_path(&request.session_id, &request.from, &request.to)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn create_sftp_directory(
    sessions: State<'_, SftpSessionManager>,
    request: SftpSessionPathRequest,
) -> Result<(), String> {
    sessions
        .create_directory(&request.session_id, &request.path)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn create_sftp_file(
    sessions: State<'_, SftpSessionManager>,
    request: SftpSessionPathRequest,
) -> Result<(), String> {
    sessions
        .create_file(&request.session_id, &request.path)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn upload_sftp_file(
    app: AppHandle,
    sessions: State<'_, SftpSessionManager>,
    request: SftpUploadFileRequest,
) -> Result<(), String> {
    let transfer_id = request.transfer_id.clone();
    sessions
        .upload_file(
            &request.session_id,
            &request.local_path,
            &request.remote_path,
            request.overwrite,
            move |progress| {
                let _ = app.emit(
                    "sftp-transfer-progress",
                    SftpTransferProgress {
                        transfer_id: transfer_id.clone(),
                        progress,
                    },
                );
            },
        )
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn download_sftp_file(
    app: AppHandle,
    sessions: State<'_, SftpSessionManager>,
    request: SftpDownloadFileRequest,
) -> Result<(), String> {
    let transfer_id = request.transfer_id.clone();
    sessions
        .download_file(
            &request.session_id,
            &request.remote_path,
            &request.local_path,
            move |progress| {
                let _ = app.emit(
                    "sftp-transfer-progress",
                    SftpTransferProgress {
                        transfer_id: transfer_id.clone(),
                        progress,
                    },
                );
            },
        )
        .await
        .map_err(|error| error.to_string())
}

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
