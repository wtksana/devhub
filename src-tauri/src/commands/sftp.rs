use tauri::{AppHandle, Emitter, State};

use crate::commands::logging::{
    log_operation, metadata, metadata_bool, metadata_number, metadata_string,
};
use crate::core::app_logger::AppLogger;
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

fn sftp_target(session_id: &str, path: &str) -> String {
    format!("{session_id}:{path}")
}

fn log_sftp_result<T>(
    settings_store: &SettingsStore,
    logger: &AppLogger,
    action: &str,
    target: String,
    started_at: std::time::Instant,
    result: &Result<T, String>,
    metadata: Option<serde_json::Map<String, serde_json::Value>>,
) {
    match result {
        Ok(_) => log_operation(
            settings_store,
            logger,
            "info",
            "sftp",
            action,
            Some(target),
            "success",
            Some(started_at),
            None,
            metadata,
        ),
        Err(error) => log_operation(
            settings_store,
            logger,
            "error",
            "sftp",
            action,
            Some(target),
            "failed",
            Some(started_at),
            Some(error.clone()),
            metadata,
        ),
    }
}

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
    logger: State<'_, AppLogger>,
    request: OpenSftpSessionRequest,
) -> Result<SftpSessionResponse, String> {
    let started_at = std::time::Instant::now();
    let connection_id = request.connection_id.clone();
    let result = sessions
        .open_session(
            settings_store.inner().clone(),
            credential_store.inner().clone(),
            request.connection_id,
        )
        .await
        .map(|session_id| SftpSessionResponse { session_id })
        .map_err(|error| error.to_string());
    match &result {
        Ok(_) => log_operation(
            settings_store.inner(),
            logger.inner(),
            "info",
            "sftp",
            "open_sftp_session",
            Some(connection_id),
            "success",
            Some(started_at),
            None,
            None,
        ),
        Err(error) => log_operation(
            settings_store.inner(),
            logger.inner(),
            "error",
            "sftp",
            "open_sftp_session",
            Some(connection_id),
            "failed",
            Some(started_at),
            Some(error.clone()),
            None,
        ),
    }
    result
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
    settings_store: State<'_, SettingsStore>,
    logger: State<'_, AppLogger>,
    request: SftpSessionPathRequest,
) -> Result<Vec<SftpEntry>, String> {
    let started_at = std::time::Instant::now();
    let target = format!("{}:{}", request.session_id, request.path);
    let result = sessions
        .list_directory(&request.session_id, &request.path)
        .await
        .map_err(|error| error.to_string());
    match &result {
        Ok(_) => log_operation(
            settings_store.inner(),
            logger.inner(),
            "info",
            "sftp",
            "list_sftp_directory",
            Some(target),
            "success",
            Some(started_at),
            None,
            None,
        ),
        Err(error) => log_operation(
            settings_store.inner(),
            logger.inner(),
            "error",
            "sftp",
            "list_sftp_directory",
            Some(target),
            "failed",
            Some(started_at),
            Some(error.clone()),
            None,
        ),
    }
    result
}

#[tauri::command]
pub async fn delete_sftp_path(
    sessions: State<'_, SftpSessionManager>,
    settings_store: State<'_, SettingsStore>,
    logger: State<'_, AppLogger>,
    request: SftpSessionPathRequest,
) -> Result<(), String> {
    let started_at = std::time::Instant::now();
    let target = sftp_target(&request.session_id, &request.path);
    let result = sessions
        .delete_path(&request.session_id, &request.path)
        .await
        .map_err(|error| error.to_string());
    log_sftp_result(
        settings_store.inner(),
        logger.inner(),
        "delete_sftp_path",
        target,
        started_at,
        &result,
        None,
    );
    result
}

#[tauri::command]
pub async fn rename_sftp_path(
    sessions: State<'_, SftpSessionManager>,
    settings_store: State<'_, SettingsStore>,
    logger: State<'_, AppLogger>,
    request: SftpSessionRenameRequest,
) -> Result<(), String> {
    let started_at = std::time::Instant::now();
    let target = format!("{}:{} -> {}", request.session_id, request.from, request.to);
    let result = sessions
        .rename_path(&request.session_id, &request.from, &request.to)
        .await
        .map_err(|error| error.to_string());
    log_sftp_result(
        settings_store.inner(),
        logger.inner(),
        "rename_sftp_path",
        target,
        started_at,
        &result,
        None,
    );
    result
}

#[tauri::command]
pub async fn create_sftp_directory(
    sessions: State<'_, SftpSessionManager>,
    settings_store: State<'_, SettingsStore>,
    logger: State<'_, AppLogger>,
    request: SftpSessionPathRequest,
) -> Result<(), String> {
    let started_at = std::time::Instant::now();
    let target = sftp_target(&request.session_id, &request.path);
    let result = sessions
        .create_directory(&request.session_id, &request.path)
        .await
        .map_err(|error| error.to_string());
    log_sftp_result(
        settings_store.inner(),
        logger.inner(),
        "create_sftp_directory",
        target,
        started_at,
        &result,
        None,
    );
    result
}

#[tauri::command]
pub async fn create_sftp_file(
    sessions: State<'_, SftpSessionManager>,
    settings_store: State<'_, SettingsStore>,
    logger: State<'_, AppLogger>,
    request: SftpSessionPathRequest,
) -> Result<(), String> {
    let started_at = std::time::Instant::now();
    let target = sftp_target(&request.session_id, &request.path);
    let result = sessions
        .create_file(&request.session_id, &request.path)
        .await
        .map_err(|error| error.to_string());
    log_sftp_result(
        settings_store.inner(),
        logger.inner(),
        "create_sftp_file",
        target,
        started_at,
        &result,
        None,
    );
    result
}

#[tauri::command]
pub async fn compress_sftp_path(
    sessions: State<'_, SftpSessionManager>,
    settings_store: State<'_, SettingsStore>,
    logger: State<'_, AppLogger>,
    request: SftpArchiveRequest,
) -> Result<(), String> {
    let started_at = std::time::Instant::now();
    let target = sftp_target(&request.session_id, &request.path);
    let result = sessions
        .compress_path(&request.session_id, &request.path)
        .await
        .map_err(|error| error.to_string());
    log_sftp_result(
        settings_store.inner(),
        logger.inner(),
        "compress_sftp_path",
        target,
        started_at,
        &result,
        None,
    );
    result
}

#[tauri::command]
pub async fn compress_sftp_paths(
    sessions: State<'_, SftpSessionManager>,
    settings_store: State<'_, SettingsStore>,
    logger: State<'_, AppLogger>,
    request: SftpCompressPathsRequest,
) -> Result<(), String> {
    let started_at = std::time::Instant::now();
    let target = format!(
        "{}:{} paths -> {}",
        request.session_id,
        request.paths.len(),
        request.archive_name
    );
    let log_metadata = metadata([("count", metadata_number(request.paths.len() as i64))]);
    let result = sessions
        .compress_paths(&request.session_id, &request.archive_name, &request.paths)
        .await
        .map_err(|error| error.to_string());
    log_sftp_result(
        settings_store.inner(),
        logger.inner(),
        "compress_sftp_paths",
        target,
        started_at,
        &result,
        Some(log_metadata),
    );
    result
}

#[tauri::command]
pub async fn extract_sftp_archive(
    sessions: State<'_, SftpSessionManager>,
    settings_store: State<'_, SettingsStore>,
    logger: State<'_, AppLogger>,
    request: SftpArchiveRequest,
) -> Result<(), String> {
    let started_at = std::time::Instant::now();
    let target = sftp_target(&request.session_id, &request.path);
    let result = sessions
        .extract_archive(&request.session_id, &request.path)
        .await
        .map_err(|error| error.to_string());
    log_sftp_result(
        settings_store.inner(),
        logger.inner(),
        "extract_sftp_archive",
        target,
        started_at,
        &result,
        None,
    );
    result
}

#[tauri::command]
pub async fn read_sftp_text_file(
    sessions: State<'_, SftpSessionManager>,
    settings_store: State<'_, SettingsStore>,
    logger: State<'_, AppLogger>,
    request: SftpReadTextFileRequest,
) -> Result<SftpTextFileResponse, String> {
    let started_at = std::time::Instant::now();
    let target = sftp_target(&request.session_id, &request.path);
    let log_metadata = metadata([("max_bytes", metadata_number(request.max_bytes as i64))]);
    let result = sessions
        .read_text_file(&request.session_id, &request.path, request.max_bytes)
        .await
        .map_err(|error| error.to_string());
    log_sftp_result(
        settings_store.inner(),
        logger.inner(),
        "read_sftp_text_file",
        target,
        started_at,
        &result,
        Some(log_metadata),
    );
    result
}

#[tauri::command]
pub async fn write_sftp_text_file(
    sessions: State<'_, SftpSessionManager>,
    settings_store: State<'_, SettingsStore>,
    logger: State<'_, AppLogger>,
    request: SftpWriteTextFileRequest,
) -> Result<SftpWriteTextFileResponse, String> {
    let started_at = std::time::Instant::now();
    let target = sftp_target(&request.session_id, &request.path);
    let log_metadata = metadata([("overwrite", metadata_bool(request.overwrite))]);
    let result = sessions
        .write_text_file(
            &request.session_id,
            &request.path,
            &request.content,
            request.expected_modified_at.as_deref(),
            request.overwrite,
        )
        .await
        .map_err(|error| error.to_string());
    log_sftp_result(
        settings_store.inner(),
        logger.inner(),
        "write_sftp_text_file",
        target,
        started_at,
        &result,
        Some(log_metadata),
    );
    result
}

#[tauri::command]
pub async fn upload_sftp_file(
    app: AppHandle,
    sessions: State<'_, SftpSessionManager>,
    settings_store: State<'_, SettingsStore>,
    logger: State<'_, AppLogger>,
    request: SftpUploadFileRequest,
) -> Result<(), String> {
    let started_at = std::time::Instant::now();
    let target = format!("{}:{}", request.session_id, request.remote_path);
    let transfer_id = request.transfer_id.clone();
    let result = sessions
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
        .map_err(|error| error.to_string());
    match &result {
        Ok(()) => log_operation(
            settings_store.inner(),
            logger.inner(),
            "info",
            "sftp",
            "upload_sftp_file",
            Some(target),
            "success",
            Some(started_at),
            None,
            None,
        ),
        Err(error) => log_operation(
            settings_store.inner(),
            logger.inner(),
            "error",
            "sftp",
            "upload_sftp_file",
            Some(target),
            "failed",
            Some(started_at),
            Some(error.clone()),
            None,
        ),
    }
    result
}

#[tauri::command]
pub async fn download_sftp_file(
    app: AppHandle,
    sessions: State<'_, SftpSessionManager>,
    settings_store: State<'_, SettingsStore>,
    logger: State<'_, AppLogger>,
    request: SftpDownloadFileRequest,
) -> Result<(), String> {
    let started_at = std::time::Instant::now();
    let target = format!("{}:{}", request.session_id, request.remote_path);
    let transfer_id = request.transfer_id.clone();
    let result = sessions
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
        .map_err(|error| error.to_string());
    match &result {
        Ok(()) => log_operation(
            settings_store.inner(),
            logger.inner(),
            "info",
            "sftp",
            "download_sftp_file",
            Some(target),
            "success",
            Some(started_at),
            None,
            None,
        ),
        Err(error) => log_operation(
            settings_store.inner(),
            logger.inner(),
            "error",
            "sftp",
            "download_sftp_file",
            Some(target),
            "failed",
            Some(started_at),
            Some(error.clone()),
            None,
        ),
    }
    result
}

#[tauri::command]
pub async fn upload_sftp_directory(
    app: AppHandle,
    sessions: State<'_, SftpSessionManager>,
    settings_store: State<'_, SettingsStore>,
    logger: State<'_, AppLogger>,
    request: SftpUploadDirectoryRequest,
) -> Result<(), String> {
    let started_at = std::time::Instant::now();
    let target = sftp_target(&request.session_id, &request.remote_path);
    let log_metadata = metadata([
        ("transfer_id", metadata_string(request.transfer_id.clone())),
        ("overwrite", metadata_bool(request.overwrite)),
    ]);
    let transfer_id = request.transfer_id.clone();
    let result = sessions
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
        .map_err(|error| error.to_string());
    log_sftp_result(
        settings_store.inner(),
        logger.inner(),
        "upload_sftp_directory",
        target,
        started_at,
        &result,
        Some(log_metadata),
    );
    result
}

#[tauri::command]
pub async fn download_sftp_directory(
    app: AppHandle,
    sessions: State<'_, SftpSessionManager>,
    settings_store: State<'_, SettingsStore>,
    logger: State<'_, AppLogger>,
    request: SftpDownloadDirectoryRequest,
) -> Result<(), String> {
    let started_at = std::time::Instant::now();
    let target = sftp_target(&request.session_id, &request.remote_path);
    let log_metadata = metadata([
        ("transfer_id", metadata_string(request.transfer_id.clone())),
        ("overwrite", metadata_bool(request.overwrite)),
    ]);
    let transfer_id = request.transfer_id.clone();
    let result = sessions
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
        .map_err(|error| error.to_string());
    log_sftp_result(
        settings_store.inner(),
        logger.inner(),
        "download_sftp_directory",
        target,
        started_at,
        &result,
        Some(log_metadata),
    );
    result
}

#[tauri::command]
pub async fn cancel_sftp_transfer(
    sessions: State<'_, SftpSessionManager>,
    settings_store: State<'_, SettingsStore>,
    logger: State<'_, AppLogger>,
    request: SftpTransferRequest,
) -> Result<(), String> {
    let started_at = std::time::Instant::now();
    let target = request.transfer_id.clone();
    sessions.cancel_transfer(&request.transfer_id).await;
    log_operation(
        settings_store.inner(),
        logger.inner(),
        "info",
        "sftp",
        "cancel_sftp_transfer",
        Some(target),
        "success",
        Some(started_at),
        None,
        None,
    );
    Ok(())
}

#[tauri::command]
pub async fn list_directory(
    settings_store: State<'_, SettingsStore>,
    credential_store: State<'_, CredentialStore>,
    logger: State<'_, AppLogger>,
    request: ListDirectoryRequest,
) -> Result<Vec<SftpEntry>, String> {
    let started_at = std::time::Instant::now();
    let target = sftp_target(&request.connection_id, &request.path);
    let result = sftp_manager::list_directory(
        settings_store.inner().clone(),
        credential_store.inner().clone(),
        request.connection_id,
        request.path,
    )
    .await;
    log_sftp_result(
        settings_store.inner(),
        logger.inner(),
        "list_directory",
        target,
        started_at,
        &result,
        None,
    );
    result
}

#[tauri::command]
pub async fn delete_path(
    settings_store: State<'_, SettingsStore>,
    credential_store: State<'_, CredentialStore>,
    logger: State<'_, AppLogger>,
    request: DeletePathRequest,
) -> Result<(), String> {
    let started_at = std::time::Instant::now();
    let target = sftp_target(&request.connection_id, &request.path);
    let result = sftp_manager::delete_path(
        settings_store.inner().clone(),
        credential_store.inner().clone(),
        request.connection_id,
        request.path,
    )
    .await;
    log_sftp_result(
        settings_store.inner(),
        logger.inner(),
        "delete_path",
        target,
        started_at,
        &result,
        None,
    );
    result
}

#[tauri::command]
pub async fn rename_path(
    settings_store: State<'_, SettingsStore>,
    credential_store: State<'_, CredentialStore>,
    logger: State<'_, AppLogger>,
    request: RenamePathRequest,
) -> Result<(), String> {
    let started_at = std::time::Instant::now();
    let target = format!(
        "{}:{} -> {}",
        request.connection_id, request.from, request.to
    );
    let result = sftp_manager::rename_path(
        settings_store.inner().clone(),
        credential_store.inner().clone(),
        request.connection_id,
        request.from,
        request.to,
    )
    .await;
    log_sftp_result(
        settings_store.inner(),
        logger.inner(),
        "rename_path",
        target,
        started_at,
        &result,
        None,
    );
    result
}

#[tauri::command]
pub async fn create_directory(
    settings_store: State<'_, SettingsStore>,
    credential_store: State<'_, CredentialStore>,
    logger: State<'_, AppLogger>,
    request: CreateDirectoryRequest,
) -> Result<(), String> {
    let started_at = std::time::Instant::now();
    let target = sftp_target(&request.connection_id, &request.path);
    let result = sftp_manager::create_directory(
        settings_store.inner().clone(),
        credential_store.inner().clone(),
        request.connection_id,
        request.path,
    )
    .await;
    log_sftp_result(
        settings_store.inner(),
        logger.inner(),
        "create_directory",
        target,
        started_at,
        &result,
        None,
    );
    result
}

#[cfg(test)]
mod tests {
    use super::sftp_target;

    #[test]
    fn builds_sftp_log_target() {
        assert_eq!(sftp_target("sftp-1", "/var/log"), "sftp-1:/var/log");
    }
}
