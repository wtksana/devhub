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
        .upload_file(
            "missing-session",
            "C:/tmp/local.txt",
            "/tmp/remote.txt",
            false,
            |_| {},
        )
        .await;
    let download_result = manager
        .download_file(
            "missing-session",
            "/tmp/remote.txt",
            "C:/tmp/local.txt",
            |_| {},
        )
        .await;
    let upload_directory_result = manager
        .upload_directory(
            "missing-session",
            "C:/tmp/local-directory",
            "/tmp/remote-directory",
            false,
            |_| {},
        )
        .await;
    let download_directory_result = manager
        .download_directory(
            "missing-session",
            "/tmp/remote-directory",
            "C:/tmp/local-directory",
            false,
            |_| {},
        )
        .await;
    let compress_result = manager.compress_path("missing-session", "/tmp/logs").await;
    let extract_result = manager
        .extract_archive("missing-session", "/tmp/logs.tar.gz")
        .await;
    let read_text_result = manager
        .read_text_file("missing-session", "/tmp/app.log", 5 * 1024 * 1024)
        .await;
    let write_text_result = manager
        .write_text_file(
            "missing-session",
            "/tmp/app.log",
            "hello",
            Some("1710000000"),
            false,
        )
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
    assert_eq!(
        upload_directory_result.unwrap_err().to_string(),
        "sftp session not found: missing-session"
    );
    assert_eq!(
        download_directory_result.unwrap_err().to_string(),
        "sftp session not found: missing-session"
    );
    assert_eq!(
        compress_result.unwrap_err().to_string(),
        "sftp session not found: missing-session"
    );
    assert_eq!(
        extract_result.unwrap_err().to_string(),
        "sftp session not found: missing-session"
    );
    assert_eq!(
        read_text_result.unwrap_err().to_string(),
        "sftp session not found: missing-session"
    );
    assert_eq!(
        write_text_result.unwrap_err().to_string(),
        "sftp session not found: missing-session"
    );
}
