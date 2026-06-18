use crate::commands::sftp::get_local_path_kind;
use crate::models::sftp::LocalPathKindRequest;

#[tokio::test]
async fn detects_local_file_and_directory_kind() {
    let temp_dir = tempfile::tempdir().expect("create temp dir");
    let file_path = temp_dir.path().join("app.log");
    std::fs::write(&file_path, "hello").expect("write temp file");

    let file_result = get_local_path_kind(LocalPathKindRequest {
        path: file_path.to_string_lossy().to_string(),
    })
    .await
    .expect("detect local file");
    let directory_result = get_local_path_kind(LocalPathKindRequest {
        path: temp_dir.path().to_string_lossy().to_string(),
    })
    .await
    .expect("detect local directory");

    assert_eq!(file_result.kind, "file");
    assert_eq!(file_result.name, "app.log");
    assert_eq!(directory_result.kind, "directory");
    assert!(!directory_result.name.is_empty());
}
