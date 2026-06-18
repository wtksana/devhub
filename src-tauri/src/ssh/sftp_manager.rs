use std::collections::HashMap;
use std::ffi::OsStr;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};
use std::time::Duration;

use ssh2::{FileStat, Session, Sftp};
use thiserror::Error;
use tokio::sync::Mutex;
use uuid::Uuid;

use crate::core::credential_store::CredentialStore;
use crate::core::settings_store::SettingsStore;
use crate::models::sftp::{SftpEntry, SftpTextFileResponse, SftpWriteTextFileResponse};
use crate::ssh::client::{connect_from_stores, SshClientError};

type Result<T> = std::result::Result<T, String>;

#[derive(Debug, Error)]
pub enum SftpSessionError {
    #[error("connection not found: {0}")]
    ConnectionNotFound(String),
    #[error("credential error: {0}")]
    Credential(String),
    #[error("settings error: {0}")]
    Settings(String),
    #[error("sftp session not found: {0}")]
    SessionNotFound(String),
    #[error("ssh error: {0}")]
    Ssh(String),
    #[error("io error: {0}")]
    Io(String),
    #[error("remote path already exists: {0}")]
    RemotePathExists(String),
    #[error("remote file is too large: {size} bytes, max {max_bytes} bytes")]
    RemoteFileTooLarge { size: u64, max_bytes: u64 },
    #[error("remote file changed: {0}")]
    RemoteFileChanged(String),
    #[error("transfer canceled")]
    TransferCanceled,
}

type SessionResult<T> = std::result::Result<T, SftpSessionError>;

#[derive(Clone, Default)]
pub struct SftpSessionManager {
    sessions: Arc<Mutex<HashMap<String, ManagedSftpSession>>>,
    transfers: Arc<Mutex<HashMap<String, Arc<AtomicBool>>>>,
}

struct ManagedSftpSession {
    _connection_id: String,
    ssh: Option<Session>,
    sftp: Option<Sftp>,
}

impl SftpSessionManager {
    pub async fn create_placeholder(&self, connection_id: String) -> String {
        let session_id = Uuid::new_v4().to_string();
        self.sessions.lock().await.insert(
            session_id.clone(),
            ManagedSftpSession::placeholder(connection_id),
        );
        session_id
    }

    pub async fn open_session(
        &self,
        settings_store: SettingsStore,
        credential_store: CredentialStore,
        connection_id: String,
    ) -> SessionResult<String> {
        let managed_session = tokio::task::spawn_blocking(move || {
            let (ssh, _) = connect_from_stores(
                &settings_store,
                &credential_store,
                &connection_id,
                Duration::from_secs(20),
                Duration::from_secs(20),
            )?;
            let sftp = ssh.sftp()?;
            Ok::<ManagedSftpSession, SftpSessionError>(ManagedSftpSession {
                _connection_id: connection_id,
                ssh: Some(ssh),
                sftp: Some(sftp),
            })
        })
        .await
        .map_err(|error| SftpSessionError::Io(error.to_string()))??;

        let session_id = Uuid::new_v4().to_string();
        self.sessions
            .lock()
            .await
            .insert(session_id.clone(), managed_session);
        Ok(session_id)
    }

    pub async fn has_session(&self, session_id: &str) -> bool {
        self.sessions.lock().await.contains_key(session_id)
    }

    pub async fn close(&self, session_id: &str) {
        self.sessions.lock().await.remove(session_id);
    }

    pub async fn cancel_transfer(&self, transfer_id: &str) {
        if let Some(cancel_flag) = self.transfers.lock().await.get(transfer_id) {
            cancel_flag.store(true, Ordering::SeqCst);
        }
    }

    pub async fn list_directory(
        &self,
        session_id: &str,
        path: &str,
    ) -> SessionResult<Vec<SftpEntry>> {
        let entries = self
            .with_sftp(session_id, |sftp| Ok(sftp.readdir(Path::new(path))?))
            .await?;
        Ok(entries
            .into_iter()
            .map(|(entry_path, stat)| to_entry(path, entry_path, stat))
            .collect())
    }

    pub async fn delete_path(&self, session_id: &str, path: &str) -> SessionResult<()> {
        self.with_sftp(session_id, |sftp| {
            let remote_path = Path::new(path);
            delete_remote_path(sftp, remote_path)
        })
        .await
    }

    pub async fn rename_path(&self, session_id: &str, from: &str, to: &str) -> SessionResult<()> {
        self.with_sftp(session_id, |sftp| {
            Ok(sftp.rename(Path::new(from), Path::new(to), None)?)
        })
        .await
    }

    pub async fn create_directory(&self, session_id: &str, path: &str) -> SessionResult<()> {
        self.with_sftp(session_id, |sftp| Ok(sftp.mkdir(Path::new(path), 0o755)?))
            .await
    }

    pub async fn create_file(&self, session_id: &str, path: &str) -> SessionResult<()> {
        self.with_sftp(session_id, |sftp| {
            sftp.create(Path::new(path))?;
            Ok(())
        })
        .await
    }

    pub async fn upload_file(
        &self,
        session_id: &str,
        local_path: &str,
        remote_path: &str,
        overwrite: bool,
        transfer_id: &str,
        on_progress: impl FnMut(u8),
    ) -> SessionResult<()> {
        let local_path = PathBuf::from(local_path);
        let cancel_flag = self.register_transfer(transfer_id).await;
        let result = self
            .with_sftp(session_id, |sftp| {
                let remote_path_ref = Path::new(remote_path);
                if !overwrite && sftp.stat(remote_path_ref).is_ok() {
                    return Err(SftpSessionError::RemotePathExists(remote_path.to_string()));
                }
                let total_size = std::fs::metadata(&local_path)?.len();
                let mut local_file = std::fs::File::open(&local_path)?;
                let mut remote_file = sftp.create(remote_path_ref)?;
                copy_with_progress(
                    &mut local_file,
                    &mut remote_file,
                    total_size,
                    on_progress,
                    || cancel_flag.load(Ordering::SeqCst),
                )?;
                Ok(())
            })
            .await;
        self.unregister_transfer(transfer_id).await;
        result
    }

    pub async fn download_file(
        &self,
        session_id: &str,
        remote_path: &str,
        local_path: &str,
        transfer_id: &str,
        on_progress: impl FnMut(u8),
    ) -> SessionResult<()> {
        let local_path = PathBuf::from(local_path);
        let cancel_flag = self.register_transfer(transfer_id).await;
        let result = self
            .with_sftp(session_id, |sftp| {
                let total_size = sftp.stat(Path::new(remote_path))?.size.unwrap_or_default();
                let mut remote_file = sftp.open(Path::new(remote_path))?;
                let mut local_file = std::fs::File::create(&local_path)?;
                copy_with_progress(
                    &mut remote_file,
                    &mut local_file,
                    total_size,
                    on_progress,
                    || cancel_flag.load(Ordering::SeqCst),
                )?;
                Ok(())
            })
            .await;
        self.unregister_transfer(transfer_id).await;
        result
    }

    pub async fn upload_directory(
        &self,
        session_id: &str,
        local_path: &str,
        remote_path: &str,
        overwrite: bool,
        transfer_id: &str,
        mut on_progress: impl FnMut(u8),
    ) -> SessionResult<()> {
        let local_path = PathBuf::from(local_path);
        let cancel_flag = self.register_transfer(transfer_id).await;
        let result = self
            .with_sftp(session_id, |sftp| {
                let total_size = local_directory_size(&local_path)?;
                let mut progress = DirectoryTransferProgress::new(total_size);
                progress.emit(&mut on_progress);
                upload_directory_recursive(
                    sftp,
                    &local_path,
                    Path::new(remote_path),
                    overwrite,
                    &mut progress,
                    &mut on_progress,
                    &|| cancel_flag.load(Ordering::SeqCst),
                )?;
                progress.finish(&mut on_progress);
                Ok(())
            })
            .await;
        self.unregister_transfer(transfer_id).await;
        result
    }

    pub async fn download_directory(
        &self,
        session_id: &str,
        remote_path: &str,
        local_path: &str,
        overwrite: bool,
        transfer_id: &str,
        mut on_progress: impl FnMut(u8),
    ) -> SessionResult<()> {
        let local_path = PathBuf::from(local_path);
        let cancel_flag = self.register_transfer(transfer_id).await;
        let result = self
            .with_sftp(session_id, |sftp| {
                let remote_path = Path::new(remote_path);
                let total_size = remote_directory_size(sftp, remote_path)?;
                let mut progress = DirectoryTransferProgress::new(total_size);
                progress.emit(&mut on_progress);
                download_directory_recursive(
                    sftp,
                    remote_path,
                    &local_path,
                    overwrite,
                    &mut progress,
                    &mut on_progress,
                    &|| cancel_flag.load(Ordering::SeqCst),
                )?;
                progress.finish(&mut on_progress);
                Ok(())
            })
            .await;
        self.unregister_transfer(transfer_id).await;
        result
    }

    async fn register_transfer(&self, transfer_id: &str) -> Arc<AtomicBool> {
        let cancel_flag = Arc::new(AtomicBool::new(false));
        self.transfers
            .lock()
            .await
            .insert(transfer_id.to_string(), Arc::clone(&cancel_flag));
        cancel_flag
    }

    async fn unregister_transfer(&self, transfer_id: &str) {
        self.transfers.lock().await.remove(transfer_id);
    }

    pub async fn compress_path(&self, session_id: &str, path: &str) -> SessionResult<()> {
        self.with_ssh(session_id, |ssh| {
            run_remote_command(ssh, &build_compress_command(path))
        })
        .await
    }

    pub async fn compress_paths(
        &self,
        session_id: &str,
        archive_name: &str,
        paths: &[String],
    ) -> SessionResult<()> {
        let command = build_compress_paths_command(archive_name, paths)?;
        self.with_ssh(session_id, |ssh| run_remote_command(ssh, &command))
            .await
    }

    pub async fn extract_archive(&self, session_id: &str, path: &str) -> SessionResult<()> {
        self.with_ssh(session_id, |ssh| {
            run_remote_command(ssh, &build_extract_command(path))
        })
        .await
    }

    pub async fn read_text_file(
        &self,
        session_id: &str,
        path: &str,
        max_bytes: u64,
    ) -> SessionResult<SftpTextFileResponse> {
        self.with_sftp(session_id, |sftp| {
            let remote_path = Path::new(path);
            let stat = sftp.stat(remote_path)?;
            let size = stat.size.unwrap_or_default();
            if size > max_bytes {
                return Err(SftpSessionError::RemoteFileTooLarge { size, max_bytes });
            }
            let mut file = sftp.open(remote_path)?;
            let mut bytes = Vec::new();
            file.read_to_end(&mut bytes)?;
            let content = String::from_utf8(bytes)
                .map_err(|error| SftpSessionError::Io(error.to_string()))?;
            Ok(SftpTextFileResponse {
                path: path.to_string(),
                content,
                size,
                modified_at: stat.mtime.map(|value| value.to_string()),
            })
        })
        .await
    }

    pub async fn write_text_file(
        &self,
        session_id: &str,
        path: &str,
        content: &str,
        expected_modified_at: Option<&str>,
        overwrite: bool,
    ) -> SessionResult<SftpWriteTextFileResponse> {
        self.with_sftp(session_id, |sftp| {
            let remote_path = Path::new(path);
            let current_stat = sftp.stat(remote_path)?;
            let current_modified_at = current_stat.mtime.map(|value| value.to_string());
            if !overwrite && expected_modified_at != current_modified_at.as_deref() {
                return Err(SftpSessionError::RemoteFileChanged(path.to_string()));
            }
            let mut file = sftp.create(remote_path)?;
            file.write_all(content.as_bytes())?;
            let stat = sftp.stat(remote_path)?;
            Ok(SftpWriteTextFileResponse {
                path: path.to_string(),
                size: stat.size.unwrap_or(content.len() as u64),
                modified_at: stat.mtime.map(|value| value.to_string()),
            })
        })
        .await
    }

    async fn with_sftp<T>(
        &self,
        session_id: &str,
        operation: impl FnOnce(&Sftp) -> SessionResult<T>,
    ) -> SessionResult<T> {
        let sessions = self.sessions.lock().await;
        let Some(session) = sessions.get(session_id) else {
            return Err(SftpSessionError::SessionNotFound(session_id.to_string()));
        };

        let Some(sftp) = session.sftp.as_ref() else {
            return Err(SftpSessionError::SessionNotFound(session_id.to_string()));
        };

        operation(sftp)
    }

    async fn with_ssh<T>(
        &self,
        session_id: &str,
        operation: impl FnOnce(&Session) -> SessionResult<T>,
    ) -> SessionResult<T> {
        let sessions = self.sessions.lock().await;
        let Some(session) = sessions.get(session_id) else {
            return Err(SftpSessionError::SessionNotFound(session_id.to_string()));
        };

        let Some(ssh) = session.ssh.as_ref() else {
            return Err(SftpSessionError::SessionNotFound(session_id.to_string()));
        };

        operation(ssh)
    }
}

impl ManagedSftpSession {
    fn placeholder(connection_id: String) -> Self {
        Self {
            _connection_id: connection_id,
            ssh: None,
            sftp: None,
        }
    }
}

impl From<SshClientError> for SftpSessionError {
    fn from(error: SshClientError) -> Self {
        match error {
            SshClientError::ConnectionNotFound(connection_id) => {
                SftpSessionError::ConnectionNotFound(connection_id)
            }
            SshClientError::NotSshConnection(connection_id) => SftpSessionError::Settings(format!(
                "connection is not an ssh connection: {connection_id}"
            )),
            SshClientError::Credential(message) => SftpSessionError::Credential(message),
            SshClientError::Settings(message) => SftpSessionError::Settings(message),
            SshClientError::Ssh(message) => SftpSessionError::Ssh(message),
            SshClientError::Io(message) => SftpSessionError::Io(message),
        }
    }
}

impl From<ssh2::Error> for SftpSessionError {
    fn from(error: ssh2::Error) -> Self {
        SftpSessionError::Ssh(error.to_string())
    }
}

impl From<std::io::Error> for SftpSessionError {
    fn from(error: std::io::Error) -> Self {
        SftpSessionError::Io(error.to_string())
    }
}

pub async fn list_directory(
    settings_store: SettingsStore,
    credential_store: CredentialStore,
    connection_id: String,
    path: String,
) -> Result<Vec<SftpEntry>> {
    tokio::task::spawn_blocking(move || {
        let (ssh, _) = connect_from_stores(
            &settings_store,
            &credential_store,
            &connection_id,
            Duration::from_secs(20),
            Duration::from_secs(20),
        )
        .map_err(|error| error.to_string())?;
        let sftp = ssh.sftp().map_err(|error| error.to_string())?;
        let entries = sftp
            .readdir(Path::new(&path))
            .map_err(|error| error.to_string())?;

        Ok(entries
            .into_iter()
            .map(|(entry_path, stat)| to_entry(&path, entry_path, stat))
            .collect())
    })
    .await
    .map_err(|error| error.to_string())?
}

pub async fn delete_path(
    settings_store: SettingsStore,
    credential_store: CredentialStore,
    connection_id: String,
    path: String,
) -> Result<()> {
    tokio::task::spawn_blocking(move || {
        let (ssh, _) = connect_from_stores(
            &settings_store,
            &credential_store,
            &connection_id,
            Duration::from_secs(20),
            Duration::from_secs(20),
        )
        .map_err(|error| error.to_string())?;
        let sftp = ssh.sftp().map_err(|error| error.to_string())?;
        let remote_path = Path::new(&path);
        delete_remote_path(&sftp, remote_path).map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

pub async fn rename_path(
    settings_store: SettingsStore,
    credential_store: CredentialStore,
    connection_id: String,
    from: String,
    to: String,
) -> Result<()> {
    tokio::task::spawn_blocking(move || {
        let (ssh, _) = connect_from_stores(
            &settings_store,
            &credential_store,
            &connection_id,
            Duration::from_secs(20),
            Duration::from_secs(20),
        )
        .map_err(|error| error.to_string())?;
        ssh.sftp()
            .map_err(|error| error.to_string())?
            .rename(Path::new(&from), Path::new(&to), None)
            .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

pub async fn create_directory(
    settings_store: SettingsStore,
    credential_store: CredentialStore,
    connection_id: String,
    path: String,
) -> Result<()> {
    tokio::task::spawn_blocking(move || {
        let (ssh, _) = connect_from_stores(
            &settings_store,
            &credential_store,
            &connection_id,
            Duration::from_secs(20),
            Duration::from_secs(20),
        )
        .map_err(|error| error.to_string())?;
        ssh.sftp()
            .map_err(|error| error.to_string())?
            .mkdir(Path::new(&path), 0o755)
            .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

fn to_entry(parent: &str, path: PathBuf, stat: FileStat) -> SftpEntry {
    let name = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_string();
    let kind = if stat.file_type().is_dir() {
        "directory"
    } else if stat.file_type().is_file() {
        "file"
    } else if stat.file_type().is_symlink() {
        "symlink"
    } else {
        "unknown"
    };

    SftpEntry {
        name: name.clone(),
        path: join_remote_path(parent, &name),
        kind: kind.to_string(),
        size: stat.size.unwrap_or(0),
        modified_at: stat.mtime.map(|value| value.to_string()),
        permissions: stat.perm.map(|value| format!("{:o}", value & 0o777)),
    }
}

fn join_remote_path(parent: &str, name: &str) -> String {
    if parent == "/" {
        format!("/{name}")
    } else {
        format!("{}/{}", parent.trim_end_matches('/'), name)
    }
}

fn local_directory_size(path: &Path) -> SessionResult<u64> {
    let mut total_size = 0_u64;
    for entry in std::fs::read_dir(path)? {
        let entry = entry?;
        let file_type = entry.file_type()?;
        if file_type.is_dir() {
            total_size += local_directory_size(&entry.path())?;
        } else if file_type.is_file() {
            total_size += entry.metadata()?.len();
        }
    }
    Ok(total_size)
}

fn remote_directory_size(sftp: &Sftp, path: &Path) -> SessionResult<u64> {
    let mut total_size = 0_u64;
    for (entry_path, stat) in sftp.readdir(path)? {
        let file_type = stat.file_type();
        if file_type.is_dir() {
            total_size += remote_directory_size(sftp, &entry_path)?;
        } else if file_type.is_file() {
            total_size += stat.size.unwrap_or_default();
        }
    }
    Ok(total_size)
}

fn upload_directory_recursive(
    sftp: &Sftp,
    local_path: &Path,
    remote_path: &Path,
    overwrite: bool,
    progress: &mut DirectoryTransferProgress,
    on_progress: &mut impl FnMut(u8),
    is_canceled: &impl Fn() -> bool,
) -> SessionResult<()> {
    ensure_not_canceled(is_canceled)?;
    ensure_remote_directory(sftp, remote_path)?;
    for entry in std::fs::read_dir(local_path)? {
        ensure_not_canceled(is_canceled)?;
        let entry = entry?;
        let entry_name = entry.file_name();
        let next_remote_path = remote_child_path(remote_path, &entry_name);
        let file_type = entry.file_type()?;
        if file_type.is_dir() {
            upload_directory_recursive(
                sftp,
                &entry.path(),
                &next_remote_path,
                overwrite,
                progress,
                on_progress,
                is_canceled,
            )?;
        } else if file_type.is_file() {
            if !overwrite && sftp.stat(&next_remote_path).is_ok() {
                return Err(SftpSessionError::RemotePathExists(
                    next_remote_path.to_string_lossy().to_string(),
                ));
            }
            let mut local_file = std::fs::File::open(entry.path())?;
            let mut remote_file = sftp.create(&next_remote_path)?;
            copy_with_total_progress(
                &mut local_file,
                &mut remote_file,
                progress,
                on_progress,
                is_canceled,
            )?;
        }
    }
    Ok(())
}

fn download_directory_recursive(
    sftp: &Sftp,
    remote_path: &Path,
    local_path: &Path,
    overwrite: bool,
    progress: &mut DirectoryTransferProgress,
    on_progress: &mut impl FnMut(u8),
    is_canceled: &impl Fn() -> bool,
) -> SessionResult<()> {
    ensure_not_canceled(is_canceled)?;
    std::fs::create_dir_all(local_path)?;
    for (entry_path, stat) in sftp.readdir(remote_path)? {
        ensure_not_canceled(is_canceled)?;
        let Some(entry_name) = entry_path.file_name() else {
            continue;
        };
        let next_local_path = local_path.join(entry_name);
        let file_type = stat.file_type();
        if file_type.is_dir() {
            download_directory_recursive(
                sftp,
                &entry_path,
                &next_local_path,
                overwrite,
                progress,
                on_progress,
                is_canceled,
            )?;
        } else if file_type.is_file() {
            if !overwrite && next_local_path.exists() {
                return Err(SftpSessionError::RemotePathExists(
                    next_local_path.to_string_lossy().to_string(),
                ));
            }
            let mut remote_file = sftp.open(&entry_path)?;
            let mut local_file = std::fs::File::create(&next_local_path)?;
            copy_with_total_progress(
                &mut remote_file,
                &mut local_file,
                progress,
                on_progress,
                is_canceled,
            )?;
        }
    }
    Ok(())
}

fn ensure_remote_directory(sftp: &Sftp, path: &Path) -> SessionResult<()> {
    match sftp.stat(path) {
        Ok(stat) if stat.file_type().is_dir() => Ok(()),
        Ok(_) => Err(SftpSessionError::RemotePathExists(
            path.to_string_lossy().to_string(),
        )),
        Err(_) => {
            sftp.mkdir(path, 0o755)?;
            Ok(())
        }
    }
}

fn remote_child_path(parent: &Path, name: &OsStr) -> PathBuf {
    PathBuf::from(join_remote_path(
        &parent.to_string_lossy(),
        &name.to_string_lossy(),
    ))
}

fn build_compress_command(path: &str) -> String {
    let (parent, name) = split_remote_parent_name(path);
    format!(
        "cd {} && tar -czf {} {}",
        shell_quote(&parent),
        shell_quote(&format!("{name}.tar.gz")),
        shell_quote(&name),
    )
}

fn build_compress_paths_command(archive_name: &str, paths: &[String]) -> SessionResult<String> {
    if paths.is_empty() {
        return Err(SftpSessionError::Io("no paths selected".to_string()));
    }
    let (parent, first_name) = split_remote_parent_name(&paths[0]);
    let mut names = vec![first_name];
    for path in &paths[1..] {
        let (next_parent, name) = split_remote_parent_name(path);
        if next_parent != parent {
            return Err(SftpSessionError::Io(
                "selected paths must be in the same directory".to_string(),
            ));
        }
        names.push(name);
    }
    let archive_name = normalize_archive_name(archive_name);
    let sources = names
        .iter()
        .map(|name| shell_quote(name))
        .collect::<Vec<_>>()
        .join(" ");
    Ok(format!(
        "cd {} && tar -czf {} {}",
        shell_quote(&parent),
        shell_quote(&archive_name),
        sources,
    ))
}

fn normalize_archive_name(name: &str) -> String {
    let trimmed_name = name.trim();
    if trimmed_name.ends_with(".tar.gz") || trimmed_name.ends_with(".tgz") {
        trimmed_name.to_string()
    } else {
        format!("{trimmed_name}.tar.gz")
    }
}

fn build_extract_command(path: &str) -> String {
    let (parent, name) = split_remote_parent_name(path);
    format!(
        "cd {} && tar -xzf {}",
        shell_quote(&parent),
        shell_quote(&name),
    )
}

fn split_remote_parent_name(path: &str) -> (String, String) {
    let trimmed_path = path.trim_end_matches('/');
    let normalized_path = if trimmed_path.is_empty() {
        "/"
    } else {
        trimmed_path
    };
    let Some(index) = normalized_path.rfind('/') else {
        return (".".to_string(), normalized_path.to_string());
    };
    let name = normalized_path[index + 1..].to_string();
    let parent = if index == 0 {
        "/".to_string()
    } else {
        normalized_path[..index].to_string()
    };
    (parent, name)
}

fn shell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}

fn run_remote_command(ssh: &Session, command: &str) -> SessionResult<()> {
    let mut channel = ssh.channel_session()?;
    channel.exec(command)?;

    let mut stdout = String::new();
    channel.read_to_string(&mut stdout)?;

    let mut stderr = String::new();
    channel.stderr().read_to_string(&mut stderr)?;

    channel.wait_close()?;
    let exit_status = channel.exit_status()?;
    if exit_status == 0 {
        return Ok(());
    }

    let message = stderr.trim();
    if !message.is_empty() {
        return Err(SftpSessionError::Ssh(message.to_string()));
    }

    let message = stdout.trim();
    if !message.is_empty() {
        return Err(SftpSessionError::Ssh(message.to_string()));
    }

    Err(SftpSessionError::Ssh(format!(
        "remote command failed with exit status {exit_status}"
    )))
}

#[cfg(test)]
#[derive(Debug, PartialEq, Eq)]
enum RemoteDeleteOperation {
    File(PathBuf),
    Directory(PathBuf),
}

#[cfg(test)]
fn push_delete_file_operation(operations: &mut Vec<RemoteDeleteOperation>, path: &Path) {
    operations.push(RemoteDeleteOperation::File(path.to_path_buf()));
}

#[cfg(test)]
fn push_delete_directory_operation(operations: &mut Vec<RemoteDeleteOperation>, path: &Path) {
    operations.push(RemoteDeleteOperation::Directory(path.to_path_buf()));
}

fn delete_remote_path(sftp: &Sftp, path: &Path) -> SessionResult<()> {
    match sftp.stat(path)?.file_type() {
        file_type if file_type.is_dir() => delete_remote_directory_recursive(sftp, path),
        _ => {
            sftp.unlink(path)?;
            Ok(())
        }
    }
}

fn delete_remote_directory_recursive(sftp: &Sftp, path: &Path) -> SessionResult<()> {
    for (entry_path, stat) in sftp.readdir(path)? {
        if is_dot_entry(&entry_path) {
            continue;
        }
        let file_type = stat.file_type();
        if file_type.is_dir() {
            delete_remote_directory_recursive(sftp, &entry_path)?;
        } else {
            sftp.unlink(&entry_path)?;
        }
    }
    sftp.rmdir(path)?;
    Ok(())
}

fn is_dot_entry(path: &Path) -> bool {
    matches!(
        path.file_name().and_then(|value| value.to_str()),
        Some(".") | Some("..")
    )
}

struct DirectoryTransferProgress {
    total_size: u64,
    copied: u64,
    last_progress: Option<u8>,
}

impl DirectoryTransferProgress {
    fn new(total_size: u64) -> Self {
        Self {
            total_size,
            copied: 0,
            last_progress: None,
        }
    }

    fn add(&mut self, bytes: u64, on_progress: &mut impl FnMut(u8)) {
        self.copied += bytes;
        self.emit(on_progress);
    }

    fn emit(&mut self, on_progress: &mut impl FnMut(u8)) {
        let progress = self
            .copied
            .saturating_mul(100)
            .checked_div(self.total_size)
            .unwrap_or(100)
            .min(100) as u8;
        if self.last_progress != Some(progress) {
            self.last_progress = Some(progress);
            on_progress(progress);
        }
    }

    fn finish(&mut self, on_progress: &mut impl FnMut(u8)) {
        self.copied = self.total_size;
        self.emit(on_progress);
    }
}

fn copy_with_total_progress(
    reader: &mut impl Read,
    writer: &mut impl Write,
    progress: &mut DirectoryTransferProgress,
    on_progress: &mut impl FnMut(u8),
    is_canceled: &impl Fn() -> bool,
) -> std::io::Result<()> {
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        ensure_not_canceled_io(is_canceled)?;
        let bytes_read = reader.read(&mut buffer)?;
        if bytes_read == 0 {
            break;
        }
        ensure_not_canceled_io(is_canceled)?;
        writer.write_all(&buffer[..bytes_read])?;
        progress.add(bytes_read as u64, on_progress);
    }
    Ok(())
}

fn copy_with_progress(
    reader: &mut impl Read,
    writer: &mut impl Write,
    total_size: u64,
    mut on_progress: impl FnMut(u8),
    is_canceled: impl Fn() -> bool,
) -> std::io::Result<()> {
    let mut buffer = [0_u8; 64 * 1024];
    let mut copied = 0_u64;
    let mut last_progress = 0_u8;

    on_progress(0);
    loop {
        ensure_not_canceled_io(&is_canceled)?;
        let bytes_read = reader.read(&mut buffer)?;
        if bytes_read == 0 {
            break;
        }
        ensure_not_canceled_io(&is_canceled)?;
        writer.write_all(&buffer[..bytes_read])?;
        copied += bytes_read as u64;
        let progress = copied
            .saturating_mul(100)
            .checked_div(total_size)
            .unwrap_or(100)
            .min(100) as u8;
        if progress != last_progress {
            last_progress = progress;
            on_progress(progress);
        }
    }
    if last_progress != 100 {
        on_progress(100);
    }
    Ok(())
}

fn ensure_not_canceled(is_canceled: &impl Fn() -> bool) -> SessionResult<()> {
    if is_canceled() {
        return Err(SftpSessionError::TransferCanceled);
    }
    Ok(())
}

fn ensure_not_canceled_io(is_canceled: &impl Fn() -> bool) -> std::io::Result<()> {
    if is_canceled() {
        return Err(std::io::Error::new(
            std::io::ErrorKind::Interrupted,
            "transfer canceled",
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builds_recursive_delete_order_with_children_before_parent() {
        let mut operations = Vec::new();
        push_delete_file_operation(&mut operations, Path::new("/data/logs/app.log"));
        push_delete_directory_operation(&mut operations, Path::new("/data/logs/archive"));
        push_delete_directory_operation(&mut operations, Path::new("/data/logs"));

        assert_eq!(
            operations,
            vec![
                RemoteDeleteOperation::File(PathBuf::from("/data/logs/app.log")),
                RemoteDeleteOperation::Directory(PathBuf::from("/data/logs/archive")),
                RemoteDeleteOperation::Directory(PathBuf::from("/data/logs")),
            ]
        );
    }

    #[test]
    fn builds_archive_commands_in_the_remote_parent_directory() {
        assert_eq!(
            build_compress_command("/data/logs"),
            "cd '/data' && tar -czf 'logs.tar.gz' 'logs'"
        );
        assert_eq!(
            build_extract_command("/data/logs.tar.gz"),
            "cd '/data' && tar -xzf 'logs.tar.gz'"
        );
    }

    #[test]
    fn quotes_archive_commands_for_shell_paths() {
        assert_eq!(
            build_compress_command("/data/today's logs"),
            "cd '/data' && tar -czf 'today'\\''s logs.tar.gz' 'today'\\''s logs'"
        );
    }

    #[test]
    fn builds_batch_archive_command_for_entries_in_the_same_directory() {
        assert_eq!(
            build_compress_paths_command(
                "selected.tar.gz",
                &["/data/app.log".to_string(), "/data/logs".to_string()],
            )
            .unwrap(),
            "cd '/data' && tar -czf 'selected.tar.gz' 'app.log' 'logs'"
        );
        assert_eq!(
            build_compress_paths_command(
                "selected",
                &["/data/app.log".to_string(), "/data/logs".to_string()],
            )
            .unwrap(),
            "cd '/data' && tar -czf 'selected.tar.gz' 'app.log' 'logs'"
        );
    }

    #[test]
    fn rejects_batch_archive_paths_from_different_directories() {
        let error = build_compress_paths_command(
            "selected.tar.gz",
            &["/data/app.log".to_string(), "/var/logs".to_string()],
        )
        .unwrap_err();

        assert_eq!(
            error.to_string(),
            "io error: selected paths must be in the same directory"
        );
    }

    #[test]
    fn stops_copy_when_transfer_is_canceled() {
        use std::cell::Cell;

        let mut reader = std::io::Cursor::new(vec![1_u8; 128 * 1024]);
        let mut writer = Vec::new();
        let progress_calls = Cell::new(0);

        let error = copy_with_progress(
            &mut reader,
            &mut writer,
            128 * 1024,
            |_| {
                progress_calls.set(progress_calls.get() + 1);
            },
            || progress_calls.get() > 0,
        )
        .unwrap_err();

        assert_eq!(error.kind(), std::io::ErrorKind::Interrupted);
        assert_eq!(error.to_string(), "transfer canceled");
    }
}
