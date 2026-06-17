use crate::ssh::sftp_manager::SftpSessionManager;

#[tokio::test]
async fn creates_and_closes_sftp_placeholder_session() {
    let manager = SftpSessionManager::default();

    let session_id = manager.create_placeholder("prod-web-01".to_string()).await;

    assert!(manager.has_session(&session_id).await);
    manager.close(&session_id).await;
    assert!(!manager.has_session(&session_id).await);
}

#[tokio::test]
async fn closing_missing_sftp_session_is_idempotent() {
    let manager = SftpSessionManager::default();

    manager.close("missing-session").await;

    assert!(!manager.has_session("missing-session").await);
}

#[tokio::test]
async fn list_directory_rejects_missing_sftp_session() {
    let manager = SftpSessionManager::default();

    let result = manager.list_directory("missing-session", "/").await;

    assert_eq!(
        result.unwrap_err().to_string(),
        "sftp session not found: missing-session"
    );
}

#[tokio::test]
async fn file_operations_reject_missing_sftp_session() {
    let manager = SftpSessionManager::default();

    let delete_result = manager.delete_path("missing-session", "/tmp/a").await;
    let rename_result = manager
        .rename_path("missing-session", "/tmp/a", "/tmp/b")
        .await;
    let create_directory_result = manager
        .create_directory("missing-session", "/tmp/new-directory")
        .await;
    let create_file_result = manager
        .create_file("missing-session", "/tmp/new-file")
        .await;
    let upload_result = manager
        .upload_file("missing-session", "C:/tmp/local.txt", "/tmp/remote.txt", false, |_| {})
        .await;
    let download_result = manager
        .download_file("missing-session", "/tmp/remote.txt", "C:/tmp/local.txt", |_| {})
        .await;

    assert_eq!(
        delete_result.unwrap_err().to_string(),
        "sftp session not found: missing-session"
    );
    assert_eq!(
        rename_result.unwrap_err().to_string(),
        "sftp session not found: missing-session"
    );
    assert_eq!(
        create_directory_result.unwrap_err().to_string(),
        "sftp session not found: missing-session"
    );
    assert_eq!(
        create_file_result.unwrap_err().to_string(),
        "sftp session not found: missing-session"
    );
    assert_eq!(
        upload_result.unwrap_err().to_string(),
        "sftp session not found: missing-session"
    );
    assert_eq!(
        download_result.unwrap_err().to_string(),
        "sftp session not found: missing-session"
    );
}
