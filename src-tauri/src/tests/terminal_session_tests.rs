use crate::ssh::session_manager::{
    InputDrain, SessionManager, SshConnectLimiter, TerminalOutputCoalescer, TerminalWorkerMessage,
    drain_local_worker_messages, drain_terminal_input, is_ignorable_terminal_read_error,
    local_shell_command, terminal_environment,
};
use std::io::{Error, ErrorKind, Result as IoResult, Write};
use std::sync::{
    Arc,
    atomic::{AtomicUsize, Ordering},
};

struct PermanentWriteFailure;

impl Write for PermanentWriteFailure {
    fn write(&mut self, _buffer: &[u8]) -> IoResult<usize> {
        Err(Error::new(ErrorKind::BrokenPipe, "broken pipe"))
    }

    fn flush(&mut self) -> IoResult<()> {
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

#[test]
fn coalesces_terminal_output_until_flush_interval() {
    let mut coalescer = TerminalOutputCoalescer::default();

    assert_eq!(coalescer.push(b"hello".to_vec()), None);
    assert_eq!(coalescer.push(b" world".to_vec()), None);

    assert_eq!(coalescer.flush_pending(), Some(b"hello world".to_vec()));
    assert_eq!(coalescer.flush_pending(), None);
}

#[test]
fn coalescer_drops_backlog_as_whole_reset_notice_when_pending_output_overflows() {
    let mut coalescer = TerminalOutputCoalescer::with_max_pending_bytes(8);

    assert_eq!(coalescer.push(b"12345678".to_vec()), None);
    assert!(coalescer.push(b"9".to_vec()).is_none());

    let output = coalescer.flush_pending().unwrap();
    assert!(output.starts_with(b"\x1bc"));
    assert!(
        String::from_utf8_lossy(&output).contains("dropped output due to terminal backpressure")
    );
    assert!(output.ends_with(b"9"));
    assert!(
        !output
            .windows(b"12345678".len())
            .any(|window| window == b"12345678")
    );
}

#[test]
fn uses_terminal_settings_for_remote_terminal_environment() {
    let settings = crate::models::settings::TerminalSettings {
        term: "screen-256color".to_string(),
        colorterm: "24bit".to_string(),
        ..Default::default()
    };

    let environment = terminal_environment(&settings);

    assert_eq!(environment.term, "screen-256color");
    assert_eq!(environment.colorterm.as_deref(), Some("24bit"));
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

#[tokio::test]
async fn drains_local_worker_messages_with_only_the_last_resize() {
    let (input_tx, mut input_rx) = tokio::sync::mpsc::channel(8);
    input_tx
        .send(TerminalWorkerMessage::Resize {
            cols: 100,
            rows: 30,
        })
        .await
        .unwrap();
    input_tx
        .send(TerminalWorkerMessage::Input("pwd\r".to_string()))
        .await
        .unwrap();
    input_tx
        .send(TerminalWorkerMessage::Resize {
            cols: 120,
            rows: 36,
        })
        .await
        .unwrap();
    let mut writer = Vec::new();
    let mut resize_calls = Vec::new();

    let result = drain_local_worker_messages(
        TerminalWorkerMessage::Input("ls\r".to_string()),
        &mut input_rx,
        &mut writer,
        &mut |cols, rows| {
            resize_calls.push((cols, rows));
            Ok(())
        },
    )
    .unwrap();

    assert_eq!(result, InputDrain::Wrote);
    assert_eq!(writer, b"ls\rpwd\r");
    assert_eq!(resize_calls, vec![(120, 36)]);
}

#[test]
fn treats_transport_read_as_a_transient_ssh_read_error() {
    let error = std::io::Error::other("transport read");

    assert!(is_ignorable_terminal_read_error(&error));
}

#[tokio::test]
async fn keeps_permanent_terminal_write_failures_fatal() {
    let (input_tx, mut input_rx) = tokio::sync::mpsc::channel(8);
    input_tx
        .send(TerminalWorkerMessage::Input("i".to_string()))
        .await
        .unwrap();
    let mut writer = PermanentWriteFailure;

    let result = drain_terminal_input(&mut input_rx, &mut writer);

    assert!(result.is_err());
}

#[tokio::test]
async fn limits_concurrent_ssh_connects_per_remote_endpoint() {
    let limiter = SshConnectLimiter::default();
    let active_same_endpoint = Arc::new(AtomicUsize::new(0));
    let max_same_endpoint = Arc::new(AtomicUsize::new(0));

    let first_limiter = limiter.clone();
    let first_active = Arc::clone(&active_same_endpoint);
    let first_max = Arc::clone(&max_same_endpoint);
    let first = tokio::spawn(async move {
        let _permit = first_limiter.acquire("10.0.0.1", 22).await;
        let current = first_active.fetch_add(1, Ordering::SeqCst) + 1;
        first_max.fetch_max(current, Ordering::SeqCst);
        tokio::time::sleep(std::time::Duration::from_millis(30)).await;
        first_active.fetch_sub(1, Ordering::SeqCst);
    });

    let second_limiter = limiter.clone();
    let second_active = Arc::clone(&active_same_endpoint);
    let second_max = Arc::clone(&max_same_endpoint);
    let second = tokio::spawn(async move {
        let _permit = second_limiter.acquire("10.0.0.1", 22).await;
        let current = second_active.fetch_add(1, Ordering::SeqCst) + 1;
        second_max.fetch_max(current, Ordering::SeqCst);
        second_active.fetch_sub(1, Ordering::SeqCst);
    });

    let (first_result, second_result) = tokio::join!(first, second);
    first_result.unwrap();
    second_result.unwrap();

    assert_eq!(max_same_endpoint.load(Ordering::SeqCst), 1);
}
