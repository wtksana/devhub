use crate::ssh::session_manager::SessionManager;

#[tokio::test]
async fn creates_and_closes_placeholder_session() {
    let manager = SessionManager::default();

    let session_id = manager.create_placeholder("dev".to_string()).await;

    assert!(manager.has_session(&session_id).await);
    manager.close(&session_id).await;
    assert!(!manager.has_session(&session_id).await);
}
