use tempfile::tempdir;

use crate::core::settings_store::SettingsStore;
use crate::models::settings::{
    ConnectionAuthSettings, ConnectionSettings, DatabaseConnectionSettings, DevHubSettings,
    RedisConnectionSettings, SshConnectionSettings, TerminalLogHighlightRule,
};

#[test]
fn creates_default_settings_when_missing() {
    let dir = tempdir().unwrap();
    let store = SettingsStore::new_for_dir(dir.path().to_path_buf());

    let settings = store.load_or_create().unwrap();
    let value = serde_json::to_value(&settings).unwrap();

    assert_eq!(settings.appearance.theme, "dark");
    assert_eq!(settings.appearance.language, "system");
    assert_eq!(value["appearance"]["ui_font_family"], "Consolas");
    assert_eq!(value["appearance"]["ui_font_size"], 16);
    assert_eq!(value["appearance"]["terminal_font_family"], "Consolas");
    assert_eq!(value["layout"]["connection_sidebar_width"], 280);
    assert_eq!(value["sftp"]["file_size_unit"], "bytes");
    assert_eq!(value["terminal"]["term"], "xterm-256color");
    assert_eq!(value["terminal"]["colorterm"], "truecolor");
    assert_eq!(value["terminal"]["log_highlight"]["auto_detect_tail"], true);
    assert_eq!(value["terminal"]["log_highlight"]["case_sensitive"], false);
    assert!(
        !value["terminal"]["log_highlight"]["rules"]
            .as_array()
            .unwrap()
            .is_empty()
    );
    assert!(value.get("ai").is_none());
    assert!(store.settings_path().exists());
}

#[test]
fn creates_default_logging_settings() {
    let settings = DevHubSettings::default();

    assert!(settings.logging.enabled);
    assert_eq!(settings.logging.level, "info");
    assert_eq!(settings.logging.retention_days, 14);
    assert!(!settings.logging.include_sql);
}

#[test]
fn saves_logging_settings() {
    let dir = tempdir().unwrap();
    let store = SettingsStore::new_for_dir(dir.path().to_path_buf());
    let mut settings = DevHubSettings::default();
    settings.logging.enabled = false;
    settings.logging.level = "debug".to_string();
    settings.logging.retention_days = 3;
    settings.logging.include_sql = true;

    store.save(&settings).unwrap();
    let loaded = store.load_or_create().unwrap();

    assert!(!loaded.logging.enabled);
    assert_eq!(loaded.logging.level, "debug");
    assert_eq!(loaded.logging.retention_days, 3);
    assert!(loaded.logging.include_sql);
}

#[test]
fn saves_terminal_environment_settings() {
    let dir = tempdir().unwrap();
    let store = SettingsStore::new_for_dir(dir.path().to_path_buf());
    let mut settings = DevHubSettings::default();
    settings.terminal.term = "screen-256color".to_string();
    settings.terminal.colorterm = "24bit".to_string();

    store.save(&settings).unwrap();
    let loaded = store.load_or_create().unwrap();

    assert_eq!(loaded.terminal.term, "screen-256color");
    assert_eq!(loaded.terminal.colorterm, "24bit");
}

#[test]
fn saves_terminal_log_highlight_settings() {
    let dir = tempdir().unwrap();
    let store = SettingsStore::new_for_dir(dir.path().to_path_buf());
    let mut settings = DevHubSettings::default();
    settings.terminal.log_highlight.auto_detect_tail = false;
    settings.terminal.log_highlight.case_sensitive = true;
    settings.terminal.log_highlight.rules = vec![TerminalLogHighlightRule {
        pattern: "\\bWARN\\b".to_string(),
        color: "#e5c07b".to_string(),
    }];

    store.save(&settings).unwrap();
    let loaded = store.load_or_create().unwrap();

    assert!(!loaded.terminal.log_highlight.auto_detect_tail);
    assert!(loaded.terminal.log_highlight.case_sensitive);
    assert_eq!(
        loaded.terminal.log_highlight.rules,
        vec![TerminalLogHighlightRule {
            pattern: "\\bWARN\\b".to_string(),
            color: "#e5c07b".to_string(),
        }]
    );
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
    settings
        .connections
        .push(ConnectionSettings::Ssh(SshConnectionSettings {
            kind: None,
            id: "dev".to_string(),
            name: "Dev".to_string(),
            group: None,
            host: "localhost".to_string(),
            port: 22,
            username: "dev".to_string(),
            auth: ConnectionAuthSettings::Password {
                password: "plain-password".to_string(),
            },
        }));

    store.save(&settings).unwrap();
    let loaded = store.load_or_create().unwrap();

    assert_eq!(
        loaded.connections[0],
        ConnectionSettings::Ssh(SshConnectionSettings {
            kind: None,
            id: "dev".to_string(),
            name: "Dev".to_string(),
            group: None,
            host: "localhost".to_string(),
            port: 22,
            username: "dev".to_string(),
            auth: ConnectionAuthSettings::Password {
                password: "plain-password".to_string()
            }
        })
    );
}

#[test]
fn omits_empty_connection_group() {
    let dir = tempdir().unwrap();
    let store = SettingsStore::new_for_dir(dir.path().to_path_buf());
    let mut settings = DevHubSettings::default();
    settings
        .connections
        .push(ConnectionSettings::Ssh(SshConnectionSettings {
            kind: None,
            id: "dev".to_string(),
            name: "Dev".to_string(),
            group: None,
            host: "localhost".to_string(),
            port: 22,
            username: "dev".to_string(),
            auth: ConnectionAuthSettings::Password {
                password: String::new(),
            },
        }));

    store.save(&settings).unwrap();

    let raw = std::fs::read_to_string(store.settings_path()).unwrap();
    assert!(!raw.contains(r#""group""#));
}

#[test]
fn omits_empty_private_key_passphrase() {
    let dir = tempdir().unwrap();
    let store = SettingsStore::new_for_dir(dir.path().to_path_buf());
    let mut settings = DevHubSettings::default();
    settings
        .connections
        .push(ConnectionSettings::Ssh(SshConnectionSettings {
            kind: None,
            id: "dev".to_string(),
            name: "Dev".to_string(),
            group: None,
            host: "localhost".to_string(),
            port: 22,
            username: "dev".to_string(),
            auth: ConnectionAuthSettings::PrivateKey {
                private_key_path: "~/.ssh/id_ed25519".to_string(),
                passphrase: None,
            },
        }));

    store.save(&settings).unwrap();

    let raw = std::fs::read_to_string(store.settings_path()).unwrap();
    assert!(!raw.contains("passphrase"));
}

#[test]
fn saves_private_key_passphrase_in_settings() {
    let dir = tempdir().unwrap();
    let store = SettingsStore::new_for_dir(dir.path().to_path_buf());
    let mut settings = DevHubSettings::default();
    settings
        .connections
        .push(ConnectionSettings::Ssh(SshConnectionSettings {
            kind: None,
            id: "dev".to_string(),
            name: "Dev".to_string(),
            group: Some("staging".to_string()),
            host: "localhost".to_string(),
            port: 22,
            username: "dev".to_string(),
            auth: ConnectionAuthSettings::PrivateKey {
                private_key_path: "~/.ssh/id_ed25519".to_string(),
                passphrase: Some("key-passphrase".to_string()),
            },
        }));

    store.save(&settings).unwrap();
    let loaded = store.load_or_create().unwrap();

    assert_eq!(
        loaded.connections[0],
        ConnectionSettings::Ssh(SshConnectionSettings {
            kind: None,
            id: "dev".to_string(),
            name: "Dev".to_string(),
            group: Some("staging".to_string()),
            host: "localhost".to_string(),
            port: 22,
            username: "dev".to_string(),
            auth: ConnectionAuthSettings::PrivateKey {
                private_key_path: "~/.ssh/id_ed25519".to_string(),
                passphrase: Some("key-passphrase".to_string())
            }
        })
    );
}

#[test]
fn allows_redis_password_in_settings() {
    let dir = tempdir().unwrap();
    let store = SettingsStore::new_for_dir(dir.path().to_path_buf());
    let mut settings = DevHubSettings::default();
    settings
        .connections
        .push(ConnectionSettings::Redis(RedisConnectionSettings {
            id: "redis-local".to_string(),
            name: "Local Redis".to_string(),
            group: None,
            host: "127.0.0.1".to_string(),
            port: 6379,
            database: 0,
            password: Some("redis-password".to_string()),
        }));

    store.save(&settings).unwrap();
    let loaded = store.load_or_create().unwrap();

    assert_eq!(
        loaded.connections[0],
        ConnectionSettings::Redis(RedisConnectionSettings {
            id: "redis-local".to_string(),
            name: "Local Redis".to_string(),
            group: None,
            host: "127.0.0.1".to_string(),
            port: 6379,
            database: 0,
            password: Some("redis-password".to_string()),
        })
    );
}

#[test]
fn allows_mysql_password_in_settings() {
    let dir = tempdir().unwrap();
    let store = SettingsStore::new_for_dir(dir.path().to_path_buf());
    let mut settings = DevHubSettings::default();
    settings
        .connections
        .push(ConnectionSettings::Mysql(DatabaseConnectionSettings {
            kind: "mysql".to_string(),
            id: "mysql-local".to_string(),
            name: "Local MySQL".to_string(),
            group: None,
            host: "127.0.0.1".to_string(),
            port: 3306,
            username: "root".to_string(),
            password: "mysql-password".to_string(),
            database: Some("app".to_string()),
        }));

    store.save(&settings).unwrap();
    let loaded = store.load_or_create().unwrap();

    assert_eq!(
        loaded.connections[0],
        ConnectionSettings::Mysql(DatabaseConnectionSettings {
            kind: "mysql".to_string(),
            id: "mysql-local".to_string(),
            name: "Local MySQL".to_string(),
            group: None,
            host: "127.0.0.1".to_string(),
            port: 3306,
            username: "root".to_string(),
            password: "mysql-password".to_string(),
            database: Some("app".to_string()),
        })
    );
}

#[test]
fn allows_postgresql_password_in_settings() {
    let dir = tempdir().unwrap();
    let store = SettingsStore::new_for_dir(dir.path().to_path_buf());
    let mut settings = DevHubSettings::default();
    settings
        .connections
        .push(ConnectionSettings::Postgresql(DatabaseConnectionSettings {
            kind: "postgresql".to_string(),
            id: "pg-local".to_string(),
            name: "Local PostgreSQL".to_string(),
            group: None,
            host: "127.0.0.1".to_string(),
            port: 5432,
            username: "postgres".to_string(),
            password: "postgresql-password".to_string(),
            database: Some("app".to_string()),
        }));

    store.save(&settings).unwrap();
    let loaded = store.load_or_create().unwrap();

    assert_eq!(
        loaded.connections[0],
        ConnectionSettings::Postgresql(DatabaseConnectionSettings {
            kind: "postgresql".to_string(),
            id: "pg-local".to_string(),
            name: "Local PostgreSQL".to_string(),
            group: None,
            host: "127.0.0.1".to_string(),
            port: 5432,
            username: "postgres".to_string(),
            password: "postgresql-password".to_string(),
            database: Some("app".to_string()),
        })
    );
}
