use crate::db::connection::database_connection_url;
use crate::db::metadata::{metadata_query_for_columns, metadata_query_for_tables};
use crate::models::settings::DatabaseConnectionSettings;

#[test]
fn builds_mysql_connection_url() {
    let connection = DatabaseConnectionSettings {
        kind: "mysql".to_string(),
        id: "mysql-dev".to_string(),
        name: "dev".to_string(),
        group: None,
        host: "127.0.0.1".to_string(),
        port: 3306,
        username: "root".to_string(),
        password: "p@ss word".to_string(),
        database: Some("app".to_string()),
    };

    assert_eq!(
        database_connection_url(&connection).unwrap(),
        "mysql://root:p%40ss%20word@127.0.0.1:3306/app"
    );
}

#[test]
fn builds_postgresql_connection_url_without_database() {
    let connection = DatabaseConnectionSettings {
        kind: "postgresql".to_string(),
        id: "postgres-dev".to_string(),
        name: "dev".to_string(),
        group: None,
        host: "127.0.0.1".to_string(),
        port: 5432,
        username: "postgres".to_string(),
        password: "secret".to_string(),
        database: None,
    };

    assert_eq!(
        database_connection_url(&connection).unwrap(),
        "postgresql://postgres:secret@127.0.0.1:5432"
    );
}

#[test]
fn builds_mysql_table_metadata_query() {
    let query = metadata_query_for_tables("mysql", "app", None).unwrap();

    assert!(query.sql.contains("information_schema.tables"));
    assert!(query.sql.contains("table_schema"));
}

#[test]
fn builds_postgresql_column_metadata_query() {
    let query = metadata_query_for_columns("postgresql", "public", "users").unwrap();

    assert!(query.sql.contains("information_schema.columns"));
    assert!(query.sql.contains("table_schema"));
}
