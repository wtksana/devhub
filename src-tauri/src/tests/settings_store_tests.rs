use tempfile::tempdir;

use crate::core::settings_store::SettingsStore;

#[test]
fn creates_default_settings_when_missing() {
    let dir = tempdir().unwrap();
    let store = SettingsStore::new_for_dir(dir.path().to_path_buf());

    let settings = store.load_or_create().unwrap();

    assert_eq!(settings.appearance.theme, "dark");
    assert!(store.settings_path().exists());
}

#[test]
fn rejects_sensitive_fields() {
    let dir = tempdir().unwrap();
    let store = SettingsStore::new_for_dir(dir.path().to_path_buf());
    std::fs::write(
        store.settings_path(),
        r#"{"connections":[{"id":"bad","password":"plain"}]}"#,
    )
    .unwrap();

    let error = store.load_or_create().unwrap_err().to_string();

    assert!(error.contains("sensitive"));
}
