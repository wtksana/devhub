use crate::ssh::session_manager::{
    drain_terminal_input, local_shell_command, InputDrain, SessionManager, TerminalWorkerMessage,
};

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
