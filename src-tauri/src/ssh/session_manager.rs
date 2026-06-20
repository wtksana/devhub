use std::collections::HashMap;
use std::io::{Read, Write};
use std::process::Command;
use std::sync::Arc;
use std::time::Duration;

use portable_pty::{CommandBuilder, PtySize};
use tauri::{AppHandle, Emitter};
use thiserror::Error;
use tokio::sync::{
    mpsc::{self, error::TryRecvError},
    Mutex, OwnedMutexGuard,
};
use uuid::Uuid;

use crate::core::credential_store::CredentialStore;
use crate::core::settings_store::SettingsStore;
use crate::models::settings::SshConnectionSettings;
use crate::models::terminal::TerminalOutputEvent;
use crate::ssh::client::{
    connect_authenticated, load_ssh_connection, resolve_auth, ResolvedAuth, SshClientError,
};

const TERMINAL_OUTPUT_EVENT: &str = "terminal://output";
const INPUT_CHANNEL_SIZE: usize = 256;
const OUTPUT_BUFFER_SIZE: usize = 8192;
pub const LOCAL_CONNECTION_ID: &str = "local";
const SSH_IDLE_SLEEP: Duration = Duration::from_millis(10);
const SSH_SESSION_TIMEOUT_MS: u32 = 100;

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

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum InputDrain {
    Idle,
    Wrote,
    Disconnected,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TerminalWorkerMessage {
    Input(String),
    Resize { cols: u16, rows: u16 },
}

#[derive(Clone, Default)]
pub struct SessionManager {
    sessions: Arc<Mutex<HashMap<String, ManagedSession>>>,
    ssh_connect_limiter: SshConnectLimiter,
}

#[derive(Clone, Default)]
pub struct SshConnectLimiter {
    endpoints: Arc<Mutex<HashMap<String, Arc<Mutex<()>>>>>,
}

impl SshConnectLimiter {
    pub async fn acquire(&self, host: &str, port: u16) -> OwnedMutexGuard<()> {
        let key = format!("{host}:{port}");
        let endpoint_lock = {
            let mut endpoints = self.endpoints.lock().await;
            Arc::clone(
                endpoints
                    .entry(key)
                    .or_insert_with(|| Arc::new(Mutex::new(()))),
            )
        };
        endpoint_lock.lock_owned().await
    }

    fn blocking_acquire(&self, host: &str, port: u16) -> OwnedMutexGuard<()> {
        let key = format!("{host}:{port}");
        let endpoint_lock = {
            let mut endpoints = self.endpoints.blocking_lock();
            Arc::clone(
                endpoints
                    .entry(key)
                    .or_insert_with(|| Arc::new(Mutex::new(()))),
            )
        };
        endpoint_lock.blocking_lock_owned()
    }
}

#[derive(Debug)]
pub struct ManagedSession {
    pub connection_id: String,
    tx: mpsc::Sender<TerminalWorkerMessage>,
    rx: Option<Arc<Mutex<mpsc::Receiver<TerminalWorkerMessage>>>>,
}

impl SessionManager {
    pub async fn create_placeholder(&self, connection_id: String) -> String {
        let (tx, rx) = mpsc::channel(INPUT_CHANNEL_SIZE);
        let session_id = Uuid::new_v4().to_string();
        self.sessions.lock().await.insert(
            session_id.clone(),
            ManagedSession {
                connection_id,
                tx,
                rx: Some(Arc::new(Mutex::new(rx))),
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
        if connection_id == LOCAL_CONNECTION_ID {
            return self
                .open_local_terminal(app, connection_id, cols, rows)
                .await;
        }

        let connection = load_ssh_connection(settings_store, &connection_id)?;
        let auth = resolve_auth(credential_store, &connection)?;
        let session_id = Uuid::new_v4().to_string();
        let (tx, input_rx) = mpsc::channel(INPUT_CHANNEL_SIZE);
        self.sessions.lock().await.insert(
            session_id.clone(),
            ManagedSession {
                connection_id,
                tx,
                rx: None,
            },
        );

        spawn_ssh_worker(
            app,
            session_id.clone(),
            self.ssh_connect_limiter.clone(),
            connection,
            auth,
            input_rx,
            cols,
            rows,
        );
        Ok(session_id)
    }

    async fn open_local_terminal(
        &self,
        app: AppHandle,
        connection_id: String,
        cols: u16,
        rows: u16,
    ) -> Result<String> {
        let session_id = Uuid::new_v4().to_string();
        let (tx, input_rx) = mpsc::channel(INPUT_CHANNEL_SIZE);
        self.sessions.lock().await.insert(
            session_id.clone(),
            ManagedSession {
                connection_id,
                tx,
                rx: None,
            },
        );

        spawn_local_worker(app, session_id.clone(), input_rx, cols, rows);
        Ok(session_id)
    }

    pub async fn write_terminal(&self, session_id: &str, data: String) -> Result<()> {
        let tx = self
            .sessions
            .lock()
            .await
            .get(session_id)
            .map(|session| session.tx.clone())
            .ok_or_else(|| TerminalSessionError::SessionNotFound(session_id.to_string()))?;
        tx.send(TerminalWorkerMessage::Input(data))
            .await
            .map_err(|_| TerminalSessionError::InputClosed)
    }

    pub async fn resize_terminal(&self, session_id: &str, cols: u16, rows: u16) -> Result<()> {
        let tx = self
            .sessions
            .lock()
            .await
            .get(session_id)
            .map(|session| session.tx.clone())
            .ok_or_else(|| TerminalSessionError::SessionNotFound(session_id.to_string()))?;
        tx.send(TerminalWorkerMessage::Resize { cols, rows })
            .await
            .map_err(|_| TerminalSessionError::InputClosed)
    }

    pub async fn next_worker_message(&self, session_id: &str) -> Option<TerminalWorkerMessage> {
        let rx = self
            .sessions
            .lock()
            .await
            .get(session_id)
            .and_then(|session| session.rx.clone())?;
        let mut rx = rx.lock().await;
        rx.recv().await
    }

    pub async fn close(&self, session_id: &str) {
        self.sessions.lock().await.remove(session_id);
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LocalShellCommand {
    pub program: String,
    pub args: Vec<String>,
}

pub fn local_shell_command() -> LocalShellCommand {
    #[cfg(target_os = "windows")]
    {
        for program in ["pwsh.exe", "powershell.exe", "cmd.exe"] {
            if Command::new("where")
                .arg(program)
                .output()
                .map(|output| output.status.success())
                .unwrap_or(false)
            {
                return LocalShellCommand {
                    program: program.to_string(),
                    args: Vec::new(),
                };
            }
        }
        LocalShellCommand {
            program: "cmd.exe".to_string(),
            args: Vec::new(),
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        LocalShellCommand {
            program: std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".to_string()),
            args: Vec::new(),
        }
    }
}

fn spawn_local_worker(
    app: AppHandle,
    session_id: String,
    input_rx: mpsc::Receiver<TerminalWorkerMessage>,
    cols: u16,
    rows: u16,
) {
    tokio::task::spawn_blocking(move || {
        if let Err(error) = run_local_worker(&app, &session_id, input_rx, cols, rows) {
            emit_output(&app, &session_id, format!("\r\n[devhub] {error}\r\n"));
        }
    });
}

fn run_local_worker(
    app: &AppHandle,
    session_id: &str,
    mut input_rx: mpsc::Receiver<TerminalWorkerMessage>,
    cols: u16,
    rows: u16,
) -> Result<()> {
    let command = local_shell_command();
    let pty_system = portable_pty::native_pty_system();
    let pair = pty_system
        .openpty(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|error| TerminalSessionError::Io(error.to_string()))?;
    let mut command_builder = CommandBuilder::new(command.program);
    for arg in command.args {
        command_builder.arg(arg);
    }
    let mut child = pair
        .slave
        .spawn_command(command_builder)
        .map_err(|error| TerminalSessionError::Io(error.to_string()))?;
    let mut reader = pair
        .master
        .try_clone_reader()
        .map_err(|error| TerminalSessionError::Io(error.to_string()))?;
    let mut writer = pair
        .master
        .take_writer()
        .map_err(|error| TerminalSessionError::Io(error.to_string()))?;
    let master = Arc::new(Mutex::new(pair.master));
    let resize_master = Arc::clone(&master);
    let mut buffer = [0_u8; OUTPUT_BUFFER_SIZE];
    let _input_writer = std::thread::spawn(move || {
        while let Some(message) = input_rx.blocking_recv() {
            match message {
                TerminalWorkerMessage::Input(input) => {
                    if writer.write_all(input.as_bytes()).is_err() {
                        break;
                    }
                    if writer.flush().is_err() {
                        break;
                    }
                }
                TerminalWorkerMessage::Resize { cols, rows } => {
                    let size = PtySize {
                        rows,
                        cols,
                        pixel_width: 0,
                        pixel_height: 0,
                    };
                    let master = resize_master.blocking_lock();
                    if master.resize(size).is_err() {
                        break;
                    }
                }
            }
        }
    });

    loop {
        match reader.read(&mut buffer) {
            Ok(0) => break,
            Ok(size) => emit_output(
                app,
                session_id,
                String::from_utf8_lossy(&buffer[..size]).to_string(),
            ),
            Err(error) if is_ignorable_terminal_read_error(&error) => {}
            Err(error) => return Err(TerminalSessionError::Io(error.to_string())),
        }

        if let Ok(Some(_)) = child.try_wait() {
            break;
        }
    }

    let _ = child.kill();
    Ok(())
}

fn spawn_ssh_worker(
    app: AppHandle,
    session_id: String,
    connect_limiter: SshConnectLimiter,
    connection: SshConnectionSettings,
    auth: crate::ssh::client::ResolvedAuth,
    mut input_rx: mpsc::Receiver<TerminalWorkerMessage>,
    cols: u16,
    rows: u16,
) {
    tokio::task::spawn_blocking(move || {
        if let Err(error) = run_ssh_worker(
            &app,
            &session_id,
            connect_limiter,
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
    connect_limiter: SshConnectLimiter,
    connection: SshConnectionSettings,
    auth: ResolvedAuth,
    input_rx: &mut mpsc::Receiver<TerminalWorkerMessage>,
    cols: u16,
    rows: u16,
) -> Result<()> {
    let ssh = {
        let _connect_permit = connect_limiter.blocking_acquire(&connection.host, connection.port);
        connect_authenticated(
            &connection,
            auth,
            Duration::from_millis(100),
            Duration::from_secs(10),
        )?
    };

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
    ssh.set_blocking(true);
    ssh.set_timeout(SSH_SESSION_TIMEOUT_MS);

    let mut buffer = [0_u8; OUTPUT_BUFFER_SIZE];
    loop {
        let worker_drain = drain_ssh_worker_messages(input_rx, &mut channel)?;
        if worker_drain == InputDrain::Disconnected {
            let _ = channel.close();
            return Ok(());
        }

        let mut read_output = false;
        match channel.read(&mut buffer) {
            Ok(0) => {
                if channel.eof() {
                    break;
                }
            }
            Ok(size) => {
                read_output = true;
                emit_output(
                    app,
                    session_id,
                    String::from_utf8_lossy(&buffer[..size]).to_string(),
                );
            }
            Err(error) if is_ignorable_terminal_read_error(&error) => {}
            Err(error) => return Err(TerminalSessionError::Io(error.to_string())),
        }

        if channel.eof() {
            break;
        }

        if worker_drain == InputDrain::Idle && !read_output {
            std::thread::sleep(SSH_IDLE_SLEEP);
        }
    }

    let _ = channel.close();
    Ok(())
}

pub fn is_ignorable_terminal_read_error(error: &std::io::Error) -> bool {
    matches!(
        error.kind(),
        std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut
    ) || error.to_string().contains("transport read")
}

pub fn drain_terminal_input<W: Write>(
    input_rx: &mut mpsc::Receiver<TerminalWorkerMessage>,
    writer: &mut W,
) -> Result<InputDrain> {
    let mut wrote = false;

    loop {
        match input_rx.try_recv() {
            Ok(TerminalWorkerMessage::Input(input)) => {
                writer
                    .write_all(input.as_bytes())
                    .map_err(|error| TerminalSessionError::Io(error.to_string()))?;
                wrote = true;
            }
            Ok(TerminalWorkerMessage::Resize { .. }) => {}
            Err(TryRecvError::Empty) => break,
            Err(TryRecvError::Disconnected) => return Ok(InputDrain::Disconnected),
        }
    }

    flush_terminal_input(writer, wrote)
}

fn drain_ssh_worker_messages(
    input_rx: &mut mpsc::Receiver<TerminalWorkerMessage>,
    channel: &mut ssh2::Channel,
) -> Result<InputDrain> {
    let mut wrote = false;

    loop {
        match input_rx.try_recv() {
            Ok(TerminalWorkerMessage::Input(input)) => {
                channel
                    .write_all(input.as_bytes())
                    .map_err(|error| TerminalSessionError::Io(error.to_string()))?;
                wrote = true;
            }
            Ok(TerminalWorkerMessage::Resize { cols, rows }) => {
                channel
                    .request_pty_size(cols as u32, rows as u32, None, None)
                    .map_err(|error| TerminalSessionError::Ssh(error.to_string()))?;
            }
            Err(TryRecvError::Empty) => break,
            Err(TryRecvError::Disconnected) => return Ok(InputDrain::Disconnected),
        }
    }

    flush_terminal_input(channel, wrote)
}

fn flush_terminal_input<W: Write>(writer: &mut W, wrote: bool) -> Result<InputDrain> {
    if wrote {
        writer
            .flush()
            .map_err(|error| TerminalSessionError::Io(error.to_string()))?;
        Ok(InputDrain::Wrote)
    } else {
        Ok(InputDrain::Idle)
    }
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
            SshClientError::NotSshConnection(connection_id) => TerminalSessionError::Settings(
                format!("connection is not an ssh connection: {connection_id}"),
            ),
            SshClientError::Credential(message) => TerminalSessionError::Credential(message),
            SshClientError::Settings(message) => TerminalSessionError::Settings(message),
            SshClientError::Ssh(message) => TerminalSessionError::Ssh(message),
            SshClientError::Io(message) => TerminalSessionError::Io(message),
        }
    }
}
