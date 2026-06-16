use crate::models::sftp::SftpEntry;

#[test]
fn serializes_sftp_entry_for_frontend() {
    let entry = SftpEntry {
        name: "logs".to_string(),
        path: "/var/log".to_string(),
        kind: "directory".to_string(),
        size: 4096,
        modified_at: Some("1710000000".to_string()),
        permissions: Some("755".to_string()),
    };

    let value = serde_json::to_value(entry).unwrap();

    assert_eq!(value["name"], "logs");
    assert_eq!(value["path"], "/var/log");
    assert_eq!(value["kind"], "directory");
    assert_eq!(value["size"], 4096);
}
