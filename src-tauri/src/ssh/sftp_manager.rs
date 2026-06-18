use std::collections::HashMap;
use std::ffi::OsStr;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use ssh2::{FileStat, Session, Sftp};
use thiserror::Error;
use tokio::sync::Mutex;
use uuid::Uuid;

use crate::core::credential_store::CredentialStore;
use crate::core::settings_store::SettingsStore;
use crate::models::sftp::SftpEntry;
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
}

type SessionResult<T> = std::result::Result<T, SftpSessionError>;

#[derive(Clone, Default)]
pub struct SftpSessionManager {
    sessions: Arc<Mutex<HashMap<String, ManagedSftpSession>>>,
}

struct ManagedSftpSession {
    _connection_id: String,
    _ssh: Option<Session>,
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
                _ssh: Some(ssh),
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
        on_progress: impl FnMut(u8),
    ) -> SessionResult<()> {
        let local_path = PathBuf::from(local_path);
        self.with_sftp(session_id, |sftp| {
            let remote_path_ref = Path::new(remote_path);
            if !overwrite && sftp.stat(remote_path_ref).is_ok() {
                return Err(SftpSessionError::RemotePathExists(remote_path.to_string()));
            }
            let total_size = std::fs::metadata(&local_path)?.len();
            let mut local_file = std::fs::File::open(&local_path)?;
            let mut remote_file = sftp.create(remote_path_ref)?;
            copy_with_progress(&mut local_file, &mut remote_file, total_size, on_progress)?;
            Ok(())
        })
        .await
    }

    pub async fn download_file(
        &self,
        session_id: &str,
        remote_path: &str,
        local_path: &str,
        on_progress: impl FnMut(u8),
    ) -> SessionResult<()> {
        let local_path = PathBuf::from(local_path);
        self.with_sftp(session_id, |sftp| {
            let total_size = sftp.stat(Path::new(remote_path))?.size.unwrap_or_default();
            let mut remote_file = sftp.open(Path::new(remote_path))?;
            let mut local_file = std::fs::File::create(&local_path)?;
            copy_with_progress(&mut remote_file, &mut local_file, total_size, on_progress)?;
            Ok(())
        })
        .await
    }

    pub async fn upload_directory(
        &self,
        session_id: &str,
        local_path: &str,
        remote_path: &str,
        overwrite: bool,
        mut on_progress: impl FnMut(u8),
    ) -> SessionResult<()> {
        let local_path = PathBuf::from(local_path);
        self.with_sftp(session_id, |sftp| {
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
            )?;
            progress.finish(&mut on_progress);
            Ok(())
        })
        .await
    }

    pub async fn download_directory(
        &self,
        session_id: &str,
        remote_path: &str,
        local_path: &str,
        overwrite: bool,
        mut on_progress: impl FnMut(u8),
    ) -> SessionResult<()> {
        let local_path = PathBuf::from(local_path);
        self.with_sftp(session_id, |sftp| {
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
            )?;
            progress.finish(&mut on_progress);
            Ok(())
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
}

impl ManagedSftpSession {
    fn placeholder(connection_id: String) -> Self {
        Self {
            _connection_id: connection_id,
            _ssh: None,
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
) -> SessionResult<()> {
    ensure_remote_directory(sftp, remote_path)?;
    for entry in std::fs::read_dir(local_path)? {
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
            )?;
        } else if file_type.is_file() {
            if !overwrite && sftp.stat(&next_remote_path).is_ok() {
                return Err(SftpSessionError::RemotePathExists(
                    next_remote_path.to_string_lossy().to_string(),
                ));
            }
            let mut local_file = std::fs::File::open(entry.path())?;
            let mut remote_file = sftp.create(&next_remote_path)?;
            copy_with_total_progress(&mut local_file, &mut remote_file, progress, on_progress)?;
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
) -> SessionResult<()> {
    std::fs::create_dir_all(local_path)?;
    for (entry_path, stat) in sftp.readdir(remote_path)? {
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
            )?;
        } else if file_type.is_file() {
            if !overwrite && next_local_path.exists() {
                return Err(SftpSessionError::RemotePathExists(
                    next_local_path.to_string_lossy().to_string(),
                ));
            }
            let mut remote_file = sftp.open(&entry_path)?;
            let mut local_file = std::fs::File::create(&next_local_path)?;
            copy_with_total_progress(&mut remote_file, &mut local_file, progress, on_progress)?;
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
) -> std::io::Result<()> {
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let bytes_read = reader.read(&mut buffer)?;
        if bytes_read == 0 {
            break;
        }
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
) -> std::io::Result<()> {
    let mut buffer = [0_u8; 64 * 1024];
    let mut copied = 0_u64;
    let mut last_progress = 0_u8;

    on_progress(0);
    loop {
        let bytes_read = reader.read(&mut buffer)?;
        if bytes_read == 0 {
            break;
        }
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
}
