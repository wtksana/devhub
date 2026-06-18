use std::net::TcpStream;
use std::path::Path;
use std::time::Duration;

use ssh2::Session;
use thiserror::Error;

use crate::core::credential_store::CredentialStore;
use crate::core::settings_store::SettingsStore;
use crate::models::settings::{ConnectionAuthSettings, ConnectionSettings};

#[derive(Debug, Error)]
pub enum SshClientError {
    #[error("connection not found: {0}")]
    ConnectionNotFound(String),
    #[error("credential error: {0}")]
    Credential(String),
    #[error("settings error: {0}")]
    Settings(String),
    #[error("ssh error: {0}")]
    Ssh(String),
    #[error("io error: {0}")]
    Io(String),
}

type Result<T> = std::result::Result<T, SshClientError>;

#[derive(Debug)]
pub enum ResolvedAuth {
    Password(String),
    PrivateKey {
        private_key_path: String,
        passphrase: Option<String>,
    },
}

pub fn load_connection(
    settings_store: &SettingsStore,
    connection_id: &str,
) -> Result<ConnectionSettings> {
    let settings = settings_store
        .load_or_create()
        .map_err(|error| SshClientError::Settings(error.to_string()))?;

    settings
        .connections
        .iter()
        .find(|item| item.id == connection_id)
        .cloned()
        .ok_or_else(|| SshClientError::ConnectionNotFound(connection_id.to_string()))
}

pub fn resolve_auth(
    _credential_store: &CredentialStore,
    connection: &ConnectionSettings,
) -> Result<ResolvedAuth> {
    match &connection.auth {
        ConnectionAuthSettings::Password { password } => {
            Ok(ResolvedAuth::Password(password.clone()))
        }
        ConnectionAuthSettings::PrivateKey {
            private_key_path,
            passphrase,
        } => Ok(ResolvedAuth::PrivateKey {
            private_key_path: private_key_path.clone(),
            passphrase: passphrase.clone(),
        }),
    }
}

pub fn connect_authenticated(
    connection: &ConnectionSettings,
    auth: ResolvedAuth,
    read_timeout: Duration,
    write_timeout: Duration,
) -> Result<Session> {
    let tcp = TcpStream::connect((connection.host.as_str(), connection.port))
        .map_err(|error| SshClientError::Io(error.to_string()))?;
    tcp.set_read_timeout(Some(read_timeout))
        .map_err(|error| SshClientError::Io(error.to_string()))?;
    tcp.set_write_timeout(Some(write_timeout))
        .map_err(|error| SshClientError::Io(error.to_string()))?;

    let mut ssh = Session::new().map_err(|error| SshClientError::Ssh(error.to_string()))?;
    ssh.set_tcp_stream(tcp);
    ssh.handshake()
        .map_err(|error| SshClientError::Ssh(error.to_string()))?;
    authenticate(&ssh, &connection.username, auth)?;
    Ok(ssh)
}

pub fn connect_from_stores(
    settings_store: &SettingsStore,
    credential_store: &CredentialStore,
    connection_id: &str,
    read_timeout: Duration,
    write_timeout: Duration,
) -> Result<(Session, ConnectionSettings)> {
    let connection = load_connection(settings_store, connection_id)?;
    let auth = resolve_auth(credential_store, &connection)?;
    let ssh = connect_authenticated(&connection, auth, read_timeout, write_timeout)?;
    Ok((ssh, connection))
}

fn authenticate(ssh: &Session, username: &str, auth: ResolvedAuth) -> Result<()> {
    match auth {
        ResolvedAuth::Password(password) => ssh
            .userauth_password(username, &password)
            .map_err(|error| SshClientError::Ssh(error.to_string())),
        ResolvedAuth::PrivateKey {
            private_key_path,
            passphrase,
        } => ssh
            .userauth_pubkey_file(
                username,
                None,
                Path::new(&private_key_path),
                passphrase.as_deref(),
            )
            .map_err(|error| SshClientError::Ssh(error.to_string())),
    }
}
