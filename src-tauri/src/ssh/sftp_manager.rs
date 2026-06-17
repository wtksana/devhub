use std::collections::HashMap;
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
            .with_sftp(session_id, |sftp| sftp.readdir(Path::new(path)))
            .await?;
        Ok(entries
            .into_iter()
            .map(|(entry_path, stat)| to_entry(path, entry_path, stat))
            .collect())
    }

    pub async fn delete_path(&self, session_id: &str, path: &str) -> SessionResult<()> {
        self.with_sftp(session_id, |sftp| {
            let remote_path = Path::new(path);
            match sftp.stat(remote_path)?.file_type() {
                file_type if file_type.is_dir() => sftp.rmdir(remote_path),
                _ => sftp.unlink(remote_path),
            }
        })
        .await
    }

    pub async fn rename_path(&self, session_id: &str, from: &str, to: &str) -> SessionResult<()> {
        self.with_sftp(session_id, |sftp| {
            sftp.rename(Path::new(from), Path::new(to), None)
        })
        .await
    }

    pub async fn create_directory(&self, session_id: &str, path: &str) -> SessionResult<()> {
        self.with_sftp(session_id, |sftp| sftp.mkdir(Path::new(path), 0o755))
            .await
    }

    pub async fn create_file(&self, session_id: &str, path: &str) -> SessionResult<()> {
        self.with_sftp(session_id, |sftp| sftp.create(Path::new(path)).map(|_| ()))
            .await
    }

    async fn with_sftp<T>(
        &self,
        session_id: &str,
        operation: impl FnOnce(&Sftp) -> std::result::Result<T, ssh2::Error>,
    ) -> SessionResult<T> {
        let sessions = self.sessions.lock().await;
        let Some(session) = sessions.get(session_id) else {
            return Err(SftpSessionError::SessionNotFound(session_id.to_string()));
        };

        let Some(sftp) = session.sftp.as_ref() else {
            return Err(SftpSessionError::SessionNotFound(session_id.to_string()));
        };

        Ok(operation(sftp)?)
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
        match sftp
            .stat(remote_path)
            .map_err(|error| error.to_string())?
            .file_type()
        {
            file_type if file_type.is_dir() => {
                sftp.rmdir(remote_path).map_err(|error| error.to_string())
            }
            _ => sftp.unlink(remote_path).map_err(|error| error.to_string()),
        }
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
