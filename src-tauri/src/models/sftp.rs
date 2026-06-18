use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ListDirectoryRequest {
    pub connection_id: String,
    pub path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OpenSftpSessionRequest {
    pub connection_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SftpSessionRequest {
    pub session_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SftpSessionPathRequest {
    pub session_id: String,
    pub path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SftpArchiveRequest {
    pub session_id: String,
    pub path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SftpReadTextFileRequest {
    pub session_id: String,
    pub path: String,
    pub max_bytes: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SftpWriteTextFileRequest {
    pub session_id: String,
    pub path: String,
    pub content: String,
    pub expected_modified_at: Option<String>,
    pub overwrite: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct SftpTextFileResponse {
    pub path: String,
    pub content: String,
    pub size: u64,
    pub modified_at: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct SftpWriteTextFileResponse {
    pub path: String,
    pub size: u64,
    pub modified_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SftpSessionRenameRequest {
    pub session_id: String,
    pub from: String,
    pub to: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SftpUploadFileRequest {
    pub session_id: String,
    pub transfer_id: String,
    pub local_path: String,
    pub remote_path: String,
    pub overwrite: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SftpDownloadFileRequest {
    pub session_id: String,
    pub transfer_id: String,
    pub remote_path: String,
    pub local_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SftpUploadDirectoryRequest {
    pub session_id: String,
    pub transfer_id: String,
    pub local_path: String,
    pub remote_path: String,
    pub overwrite: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SftpDownloadDirectoryRequest {
    pub session_id: String,
    pub transfer_id: String,
    pub remote_path: String,
    pub local_path: String,
    pub overwrite: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct SftpTransferProgress {
    pub transfer_id: String,
    pub progress: u8,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SftpSessionResponse {
    pub session_id: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct SftpEntry {
    pub name: String,
    pub path: String,
    pub kind: String,
    pub size: u64,
    pub modified_at: Option<String>,
    pub permissions: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeletePathRequest {
    pub connection_id: String,
    pub path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RenamePathRequest {
    pub connection_id: String,
    pub from: String,
    pub to: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateDirectoryRequest {
    pub connection_id: String,
    pub path: String,
}
