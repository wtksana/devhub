use crate::models::settings::{ConnectionSettings, DatabaseConnectionSettings};

#[test]
fn parses_mysql_connection_settings() {
    let json = r#"{
      "kind": "mysql",
      "id": "mysql-dev",
      "name": "开发 MySQL",
      "group": "开发环境",
      "host": "127.0.0.1",
      "port": 3306,
      "username": "root",
      "password": "secret",
      "database": "app"
    }"#;

    let connection: ConnectionSettings = serde_json::from_str(json).unwrap();

    assert_eq!(connection.id(), "mysql-dev");
    assert!(matches!(connection, ConnectionSettings::Mysql(_)));
}

#[test]
fn parses_postgresql_connection_settings() {
    let json = r#"{
      "kind": "postgresql",
      "id": "pg-dev",
      "name": "开发 PostgreSQL",
      "host": "127.0.0.1",
      "port": 5432,
      "username": "postgres",
      "password": "secret",
      "database": "app"
    }"#;

    let connection: ConnectionSettings = serde_json::from_str(json).unwrap();

    assert_eq!(connection.id(), "pg-dev");
    assert!(matches!(connection, ConnectionSettings::Postgresql(_)));
}

#[test]
fn serializes_mysql_connection_settings() {
    let connection = ConnectionSettings::Mysql(DatabaseConnectionSettings {
        kind: "mysql".to_string(),
        id: "mysql-dev".to_string(),
        name: "开发 MySQL".to_string(),
        group: Some("开发环境".to_string()),
        host: "127.0.0.1".to_string(),
        port: 3306,
        username: "root".to_string(),
        password: "secret".to_string(),
        database: Some("app".to_string()),
    });

    let value = serde_json::to_value(connection).unwrap();

    assert_eq!(value["kind"], "mysql");
    assert_eq!(value["id"], "mysql-dev");
    assert_eq!(value["group"], "开发环境");
    assert_eq!(value["database"], "app");
}

#[test]
fn serializes_postgresql_connection_settings_without_empty_fields() {
    let connection = ConnectionSettings::Postgresql(DatabaseConnectionSettings {
        kind: "postgresql".to_string(),
        id: "pg-dev".to_string(),
        name: "开发 PostgreSQL".to_string(),
        group: None,
        host: "127.0.0.1".to_string(),
        port: 5432,
        username: "postgres".to_string(),
        password: "secret".to_string(),
        database: None,
    });

    let value = serde_json::to_value(connection).unwrap();

    assert_eq!(value["kind"], "postgresql");
    assert_eq!(value["id"], "pg-dev");
    assert!(value.get("group").is_none());
    assert!(value.get("database").is_none());
}
