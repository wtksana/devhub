use crate::ssh::session_manager::{
    drain_terminal_input, is_ignorable_terminal_read_error, local_shell_command,
    write_all_retrying_transient, InputDrain, SessionManager, TerminalWorkerMessage,
};
use std::io::{Error, ErrorKind, Result as IoResult, Write};
use std::time::Duration;

struct TransientWriteFailure {
    failures_remaining: usize,
    written: Vec<u8>,
}

impl Write for TransientWriteFailure {
    fn write(&mut self, buffer: &[u8]) -> IoResult<usize> {
        if self.failures_remaining > 0 {
            self.failures_remaining -= 1;
            return Err(Error::other("Failure while draining incoming flow"));
        }
        self.written.extend_from_slice(buffer);
        Ok(buffer.len())
    }

    fn flush(&mut self) -> IoResult<()> {
        Ok(())
    }
}

struct PermanentWriteFailure;

impl Write for PermanentWriteFailure {
    fn write(&mut self, _buffer: &[u8]) -> IoResult<usize> {
        Err(Error::new(ErrorKind::BrokenPipe, "broken pipe"))
    }

    fn flush(&mut self) -> IoResult<()> {
        Ok(())
    }
}

struct TransientFlushFailure {
    failures_remaining: usize,
    written: Vec<u8>,
}

impl Write for TransientFlushFailure {
    fn write(&mut self, buffer: &[u8]) -> IoResult<usize> {
        self.written.extend_from_slice(buffer);
        Ok(buffer.len())
    }

    fn flush(&mut self) -> IoResult<()> {
        if self.failures_remaining > 0 {
            self.failures_remaining -= 1;
            return Err(Error::other("Failure while draining incoming flow"));
        }
        Ok(())
    }
}

#[tokio::test]
async fn creates_and_closes_placeholder_session() {
    let manager = SessionManager::default();

    let session_id = manager.create_placeholder("dev".to_string()).await;

    assert!(manager.has_session(&session_id).await);
    manager.close(&session_id).await;
    assert!(!manager.has_session(&session_id).await);
}

#[test]
fn resolves_a_local_shell_command_for_the_current_platform() {
    let command = local_shell_command();

    assert!(!command.program.is_empty());
}

#[tokio::test]
async fn drains_queued_terminal_input_into_writer() {
    let (input_tx, mut input_rx) = tokio::sync::mpsc::channel(8);
    input_tx
        .send(TerminalWorkerMessage::Input("ls\r".to_string()))
        .await
        .unwrap();
    input_tx
        .send(TerminalWorkerMessage::Input("pwd\r".to_string()))
        .await
        .unwrap();

    let mut writer = Vec::new();

    let result = drain_terminal_input(&mut input_rx, &mut writer).unwrap();

    assert_eq!(result, InputDrain::Wrote);
    assert_eq!(writer, b"ls\rpwd\r");
}

#[tokio::test]
async fn sends_resize_to_terminal_worker() {
    let manager = SessionManager::default();
    let session_id = manager.create_placeholder("dev".to_string()).await;

    manager.resize_terminal(&session_id, 120, 36).await.unwrap();

    assert_eq!(
        manager.next_worker_message(&session_id).await,
        Some(TerminalWorkerMessage::Resize {
            cols: 120,
            rows: 36
        })
    );
}

#[test]
fn treats_transport_read_as_a_transient_ssh_read_error() {
    let error = std::io::Error::other("transport read");

    assert!(is_ignorable_terminal_read_error(&error));
}

#[test]
fn retries_transient_ssh_write_failures_without_dropping_input() {
    let mut writer = TransientWriteFailure {
        failures_remaining: 2,
        written: Vec::new(),
    };

    write_all_retrying_transient(&mut writer, b"\x1b[A", 3, Duration::ZERO).unwrap();

    assert_eq!(writer.written, b"\x1b[A");
}

#[test]
fn keeps_permanent_ssh_write_failures_fatal() {
    let mut writer = PermanentWriteFailure;

    let result = write_all_retrying_transient(&mut writer, b"i", 3, Duration::ZERO);

    assert!(result.is_err());
}

#[tokio::test]
async fn retries_transient_ssh_flush_failures() {
    let (input_tx, mut input_rx) = tokio::sync::mpsc::channel(8);
    input_tx
        .send(TerminalWorkerMessage::Input("j".to_string()))
        .await
        .unwrap();
    let mut writer = TransientFlushFailure {
        failures_remaining: 2,
        written: Vec::new(),
    };

    let result = drain_terminal_input(&mut input_rx, &mut writer).unwrap();

    assert_eq!(result, InputDrain::Wrote);
    assert_eq!(writer.written, b"j");
}
