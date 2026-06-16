use std::path::{Path, PathBuf};
use std::time::Duration;

use ssh2::FileStat;

use crate::core::credential_store::CredentialStore;
use crate::core::settings_store::SettingsStore;
use crate::models::sftp::SftpEntry;
use crate::ssh::client::connect_from_stores;

type Result<T> = std::result::Result<T, String>;

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
