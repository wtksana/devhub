use crate::db::connection::database_connection_url;
use crate::db::metadata::{metadata_query_for_columns, metadata_query_for_tables};
use crate::db::query::{
    apply_select_limit, build_table_page_queries, is_dangerous_sql, mysql_prefers_numeric_decode,
    normalize_table_page_request, quote_identifier,
};
use crate::models::database::LoadDatabaseTablePageRequest;
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

#[test]
fn appends_default_limit_to_select_without_limit() {
    assert_eq!(
        apply_select_limit("select * from users", 200).unwrap(),
        "select * from users LIMIT 200"
    );
}

#[test]
fn keeps_select_with_existing_limit() {
    assert_eq!(
        apply_select_limit("select * from users limit 20", 200).unwrap(),
        "select * from users limit 20"
    );
}

#[test]
fn treats_mysql_count_bigint_as_numeric_type() {
    assert!(mysql_prefers_numeric_decode("BIGINT"));
}

#[test]
fn builds_mysql_table_page_queries_with_sort_and_filter() {
    let request = LoadDatabaseTablePageRequest {
        connection_id: "mysql-dev".to_string(),
        database: "app".to_string(),
        table: "user`log".to_string(),
        page: Some(2),
        page_size: Some(50),
        sort_column: Some("created_at".to_string()),
        sort_direction: Some("desc".to_string()),
        filter: Some("status = 'SUCCESS'".to_string()),
    };
    let normalized = normalize_table_page_request(request).unwrap();
    let queries = build_table_page_queries("mysql", &normalized).unwrap();

    assert_eq!(
        queries.count_sql,
        "SELECT COUNT(*) AS total FROM `user``log` WHERE status = 'SUCCESS'"
    );
    assert_eq!(
        queries.page_sql,
        "SELECT * FROM `user``log` WHERE status = 'SUCCESS' ORDER BY `created_at` DESC LIMIT 50 OFFSET 50"
    );
}

#[test]
fn builds_postgresql_table_page_queries_without_optional_clauses() {
    let request = LoadDatabaseTablePageRequest {
        connection_id: "pg-dev".to_string(),
        database: "public".to_string(),
        table: "orders".to_string(),
        page: Some(1),
        page_size: Some(200),
        sort_column: None,
        sort_direction: None,
        filter: None,
    };
    let normalized = normalize_table_page_request(request).unwrap();
    let queries = build_table_page_queries("postgresql", &normalized).unwrap();

    assert_eq!(queries.count_sql, "SELECT COUNT(*) AS total FROM \"public\".\"orders\"");
    assert_eq!(queries.page_sql, "SELECT * FROM \"public\".\"orders\" LIMIT 200 OFFSET 0");
}

#[test]
fn normalizes_table_page_request_bounds() {
    let request = LoadDatabaseTablePageRequest {
        connection_id: "mysql-dev".to_string(),
        database: "app".to_string(),
        table: "users".to_string(),
        page: Some(0),
        page_size: Some(20_000),
        sort_column: None,
        sort_direction: None,
        filter: Some("   ".to_string()),
    };
    let normalized = normalize_table_page_request(request).unwrap();

    assert_eq!(normalized.page, 1);
    assert_eq!(normalized.page_size, 10_000);
    assert_eq!(normalized.filter, None);
}

#[test]
fn rejects_invalid_table_page_sort_direction() {
    let request = LoadDatabaseTablePageRequest {
        connection_id: "mysql-dev".to_string(),
        database: "app".to_string(),
        table: "users".to_string(),
        page: Some(1),
        page_size: Some(200),
        sort_column: Some("id".to_string()),
        sort_direction: Some("sideways".to_string()),
        filter: None,
    };

    assert_eq!(
        normalize_table_page_request(request).unwrap_err(),
        "unsupported sort direction: sideways"
    );
}

#[test]
fn detects_dangerous_sql() {
    assert!(is_dangerous_sql("delete from users"));
    assert!(!is_dangerous_sql("select * from users"));
}

#[test]
fn quotes_mysql_identifier() {
    assert_eq!(
        quote_identifier("mysql", "user`log").unwrap(),
        "`user``log`"
    );
}

#[test]
fn quotes_postgresql_identifier() {
    assert_eq!(
        quote_identifier("postgresql", "user\"log").unwrap(),
        "\"user\"\"log\""
    );
}
