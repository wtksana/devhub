use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::Arc;
use std::time::Duration;

use tauri::{AppHandle, Emitter};
use thiserror::Error;
use tokio::sync::{
    mpsc::{self, error::TryRecvError},
    Mutex,
};
use uuid::Uuid;

use crate::core::credential_store::CredentialStore;
use crate::core::settings_store::SettingsStore;
use crate::models::settings::ConnectionSettings;
use crate::models::terminal::TerminalOutputEvent;
use crate::ssh::client::{
    connect_authenticated, load_connection, resolve_auth, ResolvedAuth, SshClientError,
};

const TERMINAL_OUTPUT_EVENT: &str = "terminal://output";
const INPUT_CHANNEL_SIZE: usize = 256;
const OUTPUT_BUFFER_SIZE: usize = 8192;

#[derive(Debug, Error)]
pub enum TerminalSessionError {
    #[error("connection not found: {0}")]
    ConnectionNotFound(String),
    #[error("credential error: {0}")]
    Credential(String),
    #[error("settings error: {0}")]
    Settings(String),
    #[error("terminal session not found: {0}")]
    SessionNotFound(String),
    #[error("terminal input channel closed")]
    InputClosed,
    #[error("ssh error: {0}")]
    Ssh(String),
    #[error("io error: {0}")]
    Io(String),
}

type Result<T> = std::result::Result<T, TerminalSessionError>;

#[derive(Clone, Default)]
pub struct SessionManager {
    sessions: Arc<Mutex<HashMap<String, ManagedSession>>>,
}

#[derive(Debug)]
pub struct ManagedSession {
    pub connection_id: String,
    input: mpsc::Sender<String>,
}

impl SessionManager {
    pub async fn create_placeholder(&self, connection_id: String) -> String {
        let (input, _rx) = mpsc::channel(INPUT_CHANNEL_SIZE);
        let session_id = Uuid::new_v4().to_string();
        self.sessions.lock().await.insert(
            session_id.clone(),
            ManagedSession {
                connection_id,
                input,
            },
        );
        session_id
    }

    pub async fn has_session(&self, session_id: &str) -> bool {
        self.sessions.lock().await.contains_key(session_id)
    }

    pub async fn open_terminal(
        &self,
        app: AppHandle,
        settings_store: &SettingsStore,
        credential_store: &CredentialStore,
        connection_id: String,
        cols: u16,
        rows: u16,
    ) -> Result<String> {
        let connection = load_connection(settings_store, &connection_id)?;
        let auth = resolve_auth(credential_store, &connection)?;
        let session_id = Uuid::new_v4().to_string();
        let (input, input_rx) = mpsc::channel(INPUT_CHANNEL_SIZE);
        self.sessions.lock().await.insert(
            session_id.clone(),
            ManagedSession {
                connection_id,
                input,
            },
        );

        spawn_ssh_worker(
            app,
            session_id.clone(),
            connection,
            auth,
            input_rx,
            cols,
            rows,
        );
        Ok(session_id)
    }

    pub async fn write_terminal(&self, session_id: &str, data: String) -> Result<()> {
        let input = self
            .sessions
            .lock()
            .await
            .get(session_id)
            .map(|session| session.input.clone())
            .ok_or_else(|| TerminalSessionError::SessionNotFound(session_id.to_string()))?;
        input
            .send(data)
            .await
            .map_err(|_| TerminalSessionError::InputClosed)
    }

    pub async fn resize_terminal(&self, session_id: &str, _cols: u16, _rows: u16) -> Result<()> {
        if !self.sessions.lock().await.contains_key(session_id) {
            return Err(TerminalSessionError::SessionNotFound(
                session_id.to_string(),
            ));
        }
        Ok(())
    }

    pub async fn close(&self, session_id: &str) {
        self.sessions.lock().await.remove(session_id);
    }
}

fn spawn_ssh_worker(
    app: AppHandle,
    session_id: String,
    connection: ConnectionSettings,
    auth: crate::ssh::client::ResolvedAuth,
    mut input_rx: mpsc::Receiver<String>,
    cols: u16,
    rows: u16,
) {
    tokio::task::spawn_blocking(move || {
        if let Err(error) = run_ssh_worker(
            &app,
            &session_id,
            connection,
            auth,
            &mut input_rx,
            cols,
            rows,
        ) {
            emit_output(&app, &session_id, format!("\r\n[devhub] {error}\r\n"));
        }
    });
}

fn run_ssh_worker(
    app: &AppHandle,
    session_id: &str,
    connection: ConnectionSettings,
    auth: ResolvedAuth,
    input_rx: &mut mpsc::Receiver<String>,
    cols: u16,
    rows: u16,
) -> Result<()> {
    let ssh = connect_authenticated(
        &connection,
        auth,
        Duration::from_millis(100),
        Duration::from_secs(10),
    )?;

    let mut channel = ssh
        .channel_session()
        .map_err(|error| TerminalSessionError::Ssh(error.to_string()))?;
    channel
        .request_pty(
            "xterm-256color",
            None,
            Some((cols as u32, rows as u32, 0, 0)),
        )
        .map_err(|error| TerminalSessionError::Ssh(error.to_string()))?;
    channel
        .shell()
        .map_err(|error| TerminalSessionError::Ssh(error.to_string()))?;

    let mut buffer = [0_u8; OUTPUT_BUFFER_SIZE];
    loop {
        match channel.read(&mut buffer) {
            Ok(0) => break,
            Ok(size) => emit_output(
                app,
                session_id,
                String::from_utf8_lossy(&buffer[..size]).to_string(),
            ),
            Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {}
            Err(error) if error.kind() == std::io::ErrorKind::TimedOut => {}
            Err(error) => return Err(TerminalSessionError::Io(error.to_string())),
        }

        loop {
            match input_rx.try_recv() {
                Ok(input) => {
                    channel
                        .write_all(input.as_bytes())
                        .map_err(|error| TerminalSessionError::Io(error.to_string()))?;
                    channel
                        .flush()
                        .map_err(|error| TerminalSessionError::Io(error.to_string()))?;
                }
                Err(TryRecvError::Empty) => break,
                Err(TryRecvError::Disconnected) => {
                    let _ = channel.close();
                    return Ok(());
                }
            }
        }

        if channel.eof() {
            break;
        }
    }

    let _ = channel.close();
    Ok(())
}

fn emit_output(app: &AppHandle, session_id: &str, data: String) {
    let _ = app.emit(
        TERMINAL_OUTPUT_EVENT,
        TerminalOutputEvent {
            session_id: session_id.to_string(),
            data,
        },
    );
}

impl From<SshClientError> for TerminalSessionError {
    fn from(error: SshClientError) -> Self {
        match error {
            SshClientError::ConnectionNotFound(connection_id) => {
                TerminalSessionError::ConnectionNotFound(connection_id)
            }
            SshClientError::Credential(message) => TerminalSessionError::Credential(message),
            SshClientError::Settings(message) => TerminalSessionError::Settings(message),
            SshClientError::Ssh(message) => TerminalSessionError::Ssh(message),
            SshClientError::Io(message) => TerminalSessionError::Io(message),
        }
    }
}
