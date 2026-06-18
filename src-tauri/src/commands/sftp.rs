use tauri::{AppHandle, Emitter, State};

use crate::core::credential_store::CredentialStore;
use crate::core::settings_store::SettingsStore;
use crate::models::sftp::{
    CreateDirectoryRequest, DeletePathRequest, ListDirectoryRequest, LocalPathKindRequest,
    LocalPathKindResponse, OpenSftpSessionRequest, RenamePathRequest, SftpArchiveRequest,
    SftpCompressPathsRequest, SftpDownloadDirectoryRequest, SftpDownloadFileRequest, SftpEntry,
    SftpReadTextFileRequest, SftpSessionPathRequest, SftpSessionRenameRequest, SftpSessionRequest,
    SftpSessionResponse, SftpTextFileResponse, SftpTransferProgress, SftpTransferRequest,
    SftpUploadDirectoryRequest, SftpUploadFileRequest, SftpWriteTextFileRequest,
    SftpWriteTextFileResponse,
};
use crate::ssh::sftp_manager::{self, SftpSessionManager};

#[tauri::command]
pub async fn get_local_path_kind(
    request: LocalPathKindRequest,
) -> Result<LocalPathKindResponse, String> {
    let path = std::path::PathBuf::from(&request.path);
    let metadata = std::fs::metadata(&path).map_err(|error| error.to_string())?;
    let kind = if metadata.is_dir() {
        "directory"
    } else if metadata.is_file() {
        "file"
    } else {
        return Err(format!("unsupported local path type: {}", request.path));
    };
    let name = path
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| format!("invalid local path: {}", request.path))?
        .to_string();

    Ok(LocalPathKindResponse {
        kind: kind.to_string(),
        name,
    })
}

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
pub async fn compress_sftp_path(
    sessions: State<'_, SftpSessionManager>,
    request: SftpArchiveRequest,
) -> Result<(), String> {
    sessions
        .compress_path(&request.session_id, &request.path)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn compress_sftp_paths(
    sessions: State<'_, SftpSessionManager>,
    request: SftpCompressPathsRequest,
) -> Result<(), String> {
    sessions
        .compress_paths(&request.session_id, &request.archive_name, &request.paths)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn extract_sftp_archive(
    sessions: State<'_, SftpSessionManager>,
    request: SftpArchiveRequest,
) -> Result<(), String> {
    sessions
        .extract_archive(&request.session_id, &request.path)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn read_sftp_text_file(
    sessions: State<'_, SftpSessionManager>,
    request: SftpReadTextFileRequest,
) -> Result<SftpTextFileResponse, String> {
    sessions
        .read_text_file(&request.session_id, &request.path, request.max_bytes)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn write_sftp_text_file(
    sessions: State<'_, SftpSessionManager>,
    request: SftpWriteTextFileRequest,
) -> Result<SftpWriteTextFileResponse, String> {
    sessions
        .write_text_file(
            &request.session_id,
            &request.path,
            &request.content,
            request.expected_modified_at.as_deref(),
            request.overwrite,
        )
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
            &request.transfer_id,
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
            &request.transfer_id,
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
pub async fn upload_sftp_directory(
    app: AppHandle,
    sessions: State<'_, SftpSessionManager>,
    request: SftpUploadDirectoryRequest,
) -> Result<(), String> {
    let transfer_id = request.transfer_id.clone();
    sessions
        .upload_directory(
            &request.session_id,
            &request.local_path,
            &request.remote_path,
            request.overwrite,
            &request.transfer_id,
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
pub async fn download_sftp_directory(
    app: AppHandle,
    sessions: State<'_, SftpSessionManager>,
    request: SftpDownloadDirectoryRequest,
) -> Result<(), String> {
    let transfer_id = request.transfer_id.clone();
    sessions
        .download_directory(
            &request.session_id,
            &request.remote_path,
            &request.local_path,
            request.overwrite,
            &request.transfer_id,
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
pub async fn cancel_sftp_transfer(
    sessions: State<'_, SftpSessionManager>,
    request: SftpTransferRequest,
) -> Result<(), String> {
    sessions.cancel_transfer(&request.transfer_id).await;
    Ok(())
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
