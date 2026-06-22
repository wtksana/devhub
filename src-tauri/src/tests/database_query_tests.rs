use std::collections::BTreeMap;

use crate::db::connection::{database_connection_url, database_pool_key};
use crate::db::metadata::{metadata_query_for_columns, metadata_query_for_tables};
use crate::db::query::{
    append_postgresql_indexes_to_ddl, apply_select_limit, build_table_page_queries,
    build_table_update_queries, is_dangerous_sql, mysql_prefers_datetime_decode,
    mysql_prefers_numeric_decode, mysql_table_ddl_from_values, mysql_table_ddl_query,
    normalize_table_page_request, normalize_table_update_request, postgresql_index_query_for_table,
    postgresql_prefers_datetime_decode, postgresql_table_ddl_query, primary_key_query_for_table,
    quote_identifier,
};
use crate::models::database::{
    DatabaseCellValue, DatabaseTableUpdateRow, LoadDatabaseTablePageRequest,
    UpdateDatabaseTableRowsRequest,
};
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
fn builds_database_pool_key_with_database_override() {
    let connection = DatabaseConnectionSettings {
        kind: "mysql".to_string(),
        id: "mysql-dev".to_string(),
        name: "dev".to_string(),
        group: None,
        host: "127.0.0.1".to_string(),
        port: 3306,
        username: "root".to_string(),
        password: "secret".to_string(),
        database: Some("defaultdb".to_string()),
    };

    let default_key = database_pool_key(&connection, None).unwrap();
    let app_key = database_pool_key(&connection, Some("app")).unwrap();

    assert_ne!(default_key, app_key);
    assert!(default_key.ends_with("/defaultdb"));
    assert!(app_key.ends_with("/app"));
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
fn treats_mysql_date_and_time_types_as_datetime_types() {
    assert!(mysql_prefers_datetime_decode("DATE"));
    assert!(mysql_prefers_datetime_decode("DATETIME"));
    assert!(mysql_prefers_datetime_decode("TIMESTAMP"));
    assert!(mysql_prefers_datetime_decode("TIME"));
}

#[test]
fn treats_postgresql_date_and_time_types_as_datetime_types() {
    assert!(postgresql_prefers_datetime_decode("DATE"));
    assert!(postgresql_prefers_datetime_decode("TIMESTAMP"));
    assert!(postgresql_prefers_datetime_decode(
        "TIMESTAMP WITH TIME ZONE"
    ));
    assert!(postgresql_prefers_datetime_decode("TIME"));
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
        order_by: None,
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
fn builds_table_page_queries_with_custom_order_by_clause() {
    let request = LoadDatabaseTablePageRequest {
        connection_id: "mysql-dev".to_string(),
        database: "app".to_string(),
        table: "users".to_string(),
        page: Some(1),
        page_size: Some(200),
        sort_column: None,
        sort_direction: None,
        order_by: Some("id desc".to_string()),
        filter: None,
    };
    let normalized = normalize_table_page_request(request).unwrap();
    let queries = build_table_page_queries("mysql", &normalized).unwrap();

    assert_eq!(
        queries.page_sql,
        "SELECT * FROM `users` ORDER BY id desc LIMIT 200 OFFSET 0"
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
        order_by: None,
        filter: None,
    };
    let normalized = normalize_table_page_request(request).unwrap();
    let queries = build_table_page_queries("postgresql", &normalized).unwrap();

    assert_eq!(
        queries.count_sql,
        "SELECT COUNT(*) AS total FROM \"public\".\"orders\""
    );
    assert_eq!(
        queries.page_sql,
        "SELECT * FROM \"public\".\"orders\" LIMIT 200 OFFSET 0"
    );
}

#[test]
fn mysql_table_page_identifier_uses_table_only() {
    let request = LoadDatabaseTablePageRequest {
        connection_id: "mysql-dev".to_string(),
        database: "app".to_string(),
        table: "users".to_string(),
        page: Some(1),
        page_size: Some(200),
        sort_column: None,
        sort_direction: None,
        order_by: None,
        filter: None,
    };
    let normalized = normalize_table_page_request(request).unwrap();
    let queries = build_table_page_queries("mysql", &normalized).unwrap();

    assert!(queries.page_sql.starts_with("SELECT * FROM `users`"));
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
        order_by: None,
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
        order_by: None,
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

#[test]
fn builds_mysql_primary_key_query() {
    let query = primary_key_query_for_table("mysql", "app", "users").unwrap();

    assert!(query.sql.contains("information_schema.key_column_usage"));
    assert!(query.sql.contains("constraint_name = 'PRIMARY'"));
    assert_eq!(query.binds, vec!["app".to_string(), "users".to_string()]);
}

#[test]
fn builds_mysql_table_ddl_query_with_escaped_identifier() {
    assert_eq!(
        mysql_table_ddl_query("user`log").unwrap(),
        "SHOW CREATE TABLE `user``log`"
    );
}

#[test]
fn reads_mysql_table_ddl_from_second_column_before_named_column() {
    assert_eq!(
        mysql_table_ddl_from_values(
            Ok("CREATE TABLE `users` (`id` int)".to_string()),
            Err("no column found for name: Create Table".to_string()),
        )
        .unwrap(),
        "CREATE TABLE `users` (`id` int)"
    );
}

#[test]
fn builds_postgresql_primary_key_query() {
    let query = primary_key_query_for_table("postgresql", "public", "users").unwrap();

    assert!(query.sql.contains("information_schema.table_constraints"));
    assert!(query.sql.contains("PRIMARY KEY"));
    assert_eq!(query.binds, vec!["public".to_string(), "users".to_string()]);
}

#[test]
fn builds_postgresql_table_ddl_query_with_escaped_identifiers() {
    let query = postgresql_table_ddl_query("public\"schema", "user\"log").unwrap();

    assert!(query.sql.contains("create table \"public\"\"schema\".%s"));
    assert!(query.sql.contains("quote_ident(c.table_name)"));
    assert!(query.sql.contains("information_schema.columns"));
    assert_eq!(query.binds, vec!["public\"schema".to_string(), "user\"log".to_string()]);
}

#[test]
fn builds_postgresql_index_query_for_table() {
    let query = postgresql_index_query_for_table("public", "users").unwrap();

    assert!(query.sql.contains("from pg_indexes"));
    assert!(query.sql.contains("schemaname = $1"));
    assert!(query.sql.contains("tablename = $2"));
    assert_eq!(query.binds, vec!["public".to_string(), "users".to_string()]);
}

#[test]
fn appends_postgresql_indexes_after_table_ddl() {
    let ddl = append_postgresql_indexes_to_ddl(
        "create table \"public\".\"users\" (\n  \"id\" integer\n);",
        vec![
            "CREATE INDEX idx_users_name ON public.users USING btree (name)".to_string(),
            "CREATE UNIQUE INDEX users_pkey ON public.users USING btree (id)".to_string(),
        ],
    );

    assert_eq!(
        ddl,
        "create table \"public\".\"users\" (\n  \"id\" integer\n);\n\nCREATE INDEX idx_users_name ON public.users USING btree (name);\nCREATE UNIQUE INDEX users_pkey ON public.users USING btree (id);"
    );
}

#[test]
fn builds_mysql_table_update_query() {
    let request = table_update_request(
        "mysql-dev",
        "app",
        "users",
        vec!["id"],
        vec![(
            "name",
            DatabaseCellValue::Text {
                value: "Alice".to_string(),
            },
        )],
        vec![(
            "id",
            DatabaseCellValue::Number {
                value: "1".to_string(),
            },
        )],
    );
    let normalized = normalize_table_update_request(request, &["id".to_string()]).unwrap();
    let queries = build_table_update_queries("mysql", &normalized).unwrap();

    assert_eq!(
        queries[0].sql,
        "UPDATE `users` SET `name` = ? WHERE `id` = ?"
    );
    assert_eq!(
        queries[0].values,
        vec![
            DatabaseCellValue::Text {
                value: "Alice".to_string()
            },
            DatabaseCellValue::Number {
                value: "1".to_string()
            },
        ]
    );
}

#[test]
fn builds_postgresql_table_update_query_with_composite_primary_key() {
    let request = table_update_request(
        "pg-dev",
        "public",
        "order_items",
        vec!["order_id", "item_id"],
        vec![(
            "quantity",
            DatabaseCellValue::Number {
                value: "2".to_string(),
            },
        )],
        vec![
            (
                "order_id",
                DatabaseCellValue::Number {
                    value: "10".to_string(),
                },
            ),
            (
                "item_id",
                DatabaseCellValue::Number {
                    value: "3".to_string(),
                },
            ),
        ],
    );
    let normalized =
        normalize_table_update_request(request, &["order_id".to_string(), "item_id".to_string()])
            .unwrap();
    let queries = build_table_update_queries("postgresql", &normalized).unwrap();

    assert_eq!(
        queries[0].sql,
        "UPDATE \"public\".\"order_items\" SET \"quantity\" = $1 WHERE \"order_id\" = $2 AND \"item_id\" = $3"
    );
}

#[test]
fn rejects_table_update_without_primary_key() {
    let request = table_update_request(
        "mysql-dev",
        "app",
        "users",
        vec![],
        vec![(
            "name",
            DatabaseCellValue::Text {
                value: "Alice".to_string(),
            },
        )],
        vec![],
    );

    assert_eq!(
        normalize_table_update_request(request, &[]).unwrap_err(),
        "table has no primary key"
    );
}

#[test]
fn rejects_table_update_when_changes_include_primary_key() {
    let request = table_update_request(
        "mysql-dev",
        "app",
        "users",
        vec!["id"],
        vec![(
            "id",
            DatabaseCellValue::Number {
                value: "2".to_string(),
            },
        )],
        vec![(
            "id",
            DatabaseCellValue::Number {
                value: "1".to_string(),
            },
        )],
    );

    assert_eq!(
        normalize_table_update_request(request, &["id".to_string()]).unwrap_err(),
        "primary key column cannot be updated: id"
    );
}

#[test]
fn rejects_table_update_without_changes() {
    let request = table_update_request(
        "mysql-dev",
        "app",
        "users",
        vec!["id"],
        vec![],
        vec![(
            "id",
            DatabaseCellValue::Number {
                value: "1".to_string(),
            },
        )],
    );

    assert_eq!(
        normalize_table_update_request(request, &["id".to_string()]).unwrap_err(),
        "row changes are required"
    );
}

fn table_update_request(
    connection_id: &str,
    database: &str,
    table: &str,
    primary_key_columns: Vec<&str>,
    changes: Vec<(&str, DatabaseCellValue)>,
    primary_key_values: Vec<(&str, DatabaseCellValue)>,
) -> UpdateDatabaseTableRowsRequest {
    UpdateDatabaseTableRowsRequest {
        connection_id: connection_id.to_string(),
        database: database.to_string(),
        table: table.to_string(),
        primary_key_columns: primary_key_columns
            .into_iter()
            .map(str::to_string)
            .collect(),
        rows: vec![DatabaseTableUpdateRow {
            primary_key_values: primary_key_values
                .into_iter()
                .map(|(key, value)| (key.to_string(), value))
                .collect::<BTreeMap<_, _>>(),
            changes: changes
                .into_iter()
                .map(|(key, value)| (key.to_string(), value))
                .collect::<BTreeMap<_, _>>(),
        }],
    }
}
