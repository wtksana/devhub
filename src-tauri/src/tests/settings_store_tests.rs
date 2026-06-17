use tempfile::tempdir;

use crate::core::settings_store::SettingsStore;
use crate::models::settings::{ConnectionAuthSettings, ConnectionSettings, DevHubSettings};

#[test]
fn creates_default_settings_when_missing() {
    let dir = tempdir().unwrap();
    let store = SettingsStore::new_for_dir(dir.path().to_path_buf());

    let settings = store.load_or_create().unwrap();
    let value = serde_json::to_value(&settings).unwrap();

    assert_eq!(settings.appearance.theme, "dark");
    assert_eq!(value["appearance"]["ui_font_family"], "Inter");
    assert_eq!(value["appearance"]["ui_font_size"], 13);
    assert_eq!(
        value["appearance"]["terminal_font_family"],
        "JetBrains Mono"
    );
    assert_eq!(value["layout"]["connection_sidebar_width"], 280);
    assert_eq!(value["sftp"]["file_size_unit"], "bytes");
    assert!(value.get("ai").is_none());
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

#[test]
fn allows_ssh_password_auth_in_settings() {
    let dir = tempdir().unwrap();
    let store = SettingsStore::new_for_dir(dir.path().to_path_buf());
    let mut settings = DevHubSettings::default();
    settings.connections.push(ConnectionSettings {
        id: "dev".to_string(),
        name: "Dev".to_string(),
        group: None,
        host: "localhost".to_string(),
        port: 22,
        username: "dev".to_string(),
        auth: ConnectionAuthSettings::Password {
            password: "plain-password".to_string(),
        },
    });

    store.save(&settings).unwrap();
    let loaded = store.load_or_create().unwrap();

    assert_eq!(
        loaded.connections[0].auth,
        ConnectionAuthSettings::Password {
            password: "plain-password".to_string()
        }
    );
}

#[test]
fn omits_empty_connection_group() {
    let dir = tempdir().unwrap();
    let store = SettingsStore::new_for_dir(dir.path().to_path_buf());
    let mut settings = DevHubSettings::default();
    settings.connections.push(ConnectionSettings {
        id: "dev".to_string(),
        name: "Dev".to_string(),
        group: None,
        host: "localhost".to_string(),
        port: 22,
        username: "dev".to_string(),
        auth: ConnectionAuthSettings::Password {
            password: String::new(),
        },
    });

    store.save(&settings).unwrap();

    let raw = std::fs::read_to_string(store.settings_path()).unwrap();
    assert!(!raw.contains(r#""group""#));
}

#[test]
fn omits_empty_private_key_passphrase_ref() {
    let dir = tempdir().unwrap();
    let store = SettingsStore::new_for_dir(dir.path().to_path_buf());
    let mut settings = DevHubSettings::default();
    settings.connections.push(ConnectionSettings {
        id: "dev".to_string(),
        name: "Dev".to_string(),
        group: None,
        host: "localhost".to_string(),
        port: 22,
        username: "dev".to_string(),
        auth: ConnectionAuthSettings::PrivateKey {
            private_key_path: "~/.ssh/id_ed25519".to_string(),
            passphrase_ref: None,
        },
    });

    store.save(&settings).unwrap();

    let raw = std::fs::read_to_string(store.settings_path()).unwrap();
    assert!(!raw.contains("passphrase_ref"));
}
