use tauri::State;

use crate::commands::logging::{log_operation, metadata, metadata_number, metadata_string};
use crate::core::app_logger::AppLogger;
use crate::core::settings_store::SettingsStore;
use crate::db::connection::DatabaseConnectionManager;
use crate::db::metadata;
use crate::db::query;
use crate::db::sql_files::DatabaseSqlFileStore;
use crate::models::database::{
    DatabaseQueryResult, DatabaseSqlFile, DatabaseTableDdlResult, DatabaseTablePageResult,
    DatabaseTableUpdateResult, DeleteDatabaseTableRowsRequest, ExecuteDatabaseQueryRequest,
    GetDatabaseTableDdlRequest, InsertDatabaseTableRowsRequest, ListDatabaseSqlFilesRequest,
    LoadDatabaseTablePageRequest, SaveDatabaseSqlFileRequest, UpdateDatabaseTableRowsRequest,
};
use crate::models::database::{DatabaseTreeNode, ListDatabaseObjectsRequest};
use crate::models::settings::{ConnectionSettings, DatabaseConnectionSettings};

#[tauri::command]
pub async fn test_database_connection(
    settings_store: State<'_, SettingsStore>,
    database_manager: State<'_, DatabaseConnectionManager>,
    logger: State<'_, AppLogger>,
    connection_id: String,
) -> Result<String, String> {
    let started_at = std::time::Instant::now();
    let connection = load_database_connection(settings_store.inner(), &connection_id)?;
    let result = database_manager
        .test_connection(&connection)
        .await
        .map(|_| "OK".to_string());
    match &result {
        Ok(_) => log_operation(
            settings_store.inner(),
            logger.inner(),
            "info",
            "database",
            "test_database_connection",
            Some(connection_id),
            "success",
            Some(started_at),
            None,
            None,
        ),
        Err(error) => log_operation(
            settings_store.inner(),
            logger.inner(),
            "error",
            "database",
            "test_database_connection",
            Some(connection_id),
            "failed",
            Some(started_at),
            Some(error.clone()),
            None,
        ),
    }
    result
}

#[tauri::command]
pub async fn test_database_connection_config(
    database_manager: State<'_, DatabaseConnectionManager>,
    connection: DatabaseConnectionSettings,
) -> Result<String, String> {
    database_manager
        .test_connection(&connection)
        .await
        .map(|_| "OK".to_string())
}

#[tauri::command]
pub async fn list_database_objects(
    settings_store: State<'_, SettingsStore>,
    database_manager: State<'_, DatabaseConnectionManager>,
    logger: State<'_, AppLogger>,
    request: ListDatabaseObjectsRequest,
) -> Result<Vec<DatabaseTreeNode>, String> {
    let started_at = std::time::Instant::now();
    let target = match request.database.as_deref() {
        Some(database) if !database.is_empty() => {
            format!("{}:{database}", request.connection_id)
        }
        _ => request.connection_id.clone(),
    };
    let metadata = request
        .database
        .clone()
        .map(|database| metadata([("database", metadata_string(database))]));
    let connection = load_database_connection(settings_store.inner(), &request.connection_id)?;
    let result =
        metadata::list_database_objects(database_manager.inner(), &connection, &request).await;
    log_database_result(
        settings_store.inner(),
        logger.inner(),
        "list_database_objects",
        target,
        started_at,
        &result,
        metadata,
    );
    result
}

#[tauri::command]
pub async fn execute_database_query(
    settings_store: State<'_, SettingsStore>,
    database_manager: State<'_, DatabaseConnectionManager>,
    logger: State<'_, AppLogger>,
    request: ExecuteDatabaseQueryRequest,
) -> Result<DatabaseQueryResult, String> {
    let started_at = std::time::Instant::now();
    let target = database_query_target(settings_store.inner(), &request);
    let sql_kind = sql_kind(&request.sql);
    let connection = load_database_connection(settings_store.inner(), &request.connection_id)?;
    let result =
        query::execute_database_query(database_manager.inner(), &connection, &request).await;
    let log_metadata = metadata([("sql_kind", metadata_string(sql_kind))]);
    match &result {
        Ok(_) => log_operation(
            settings_store.inner(),
            logger.inner(),
            "info",
            "database",
            "execute_database_query",
            Some(target),
            "success",
            Some(started_at),
            None,
            Some(log_metadata.clone()),
        ),
        Err(error) => log_operation(
            settings_store.inner(),
            logger.inner(),
            "error",
            "database",
            "execute_database_query",
            Some(target),
            "failed",
            Some(started_at),
            Some(error.clone()),
            Some(log_metadata),
        ),
    }
    result
}

#[tauri::command]
pub async fn load_database_table_page(
    settings_store: State<'_, SettingsStore>,
    database_manager: State<'_, DatabaseConnectionManager>,
    logger: State<'_, AppLogger>,
    request: LoadDatabaseTablePageRequest,
) -> Result<DatabaseTablePageResult, String> {
    let started_at = std::time::Instant::now();
    let target = format!(
        "{}:{}:{}",
        request.connection_id, request.database, request.table
    );
    let connection = load_database_connection(settings_store.inner(), &request.connection_id)?;
    let result =
        query::load_database_table_page(database_manager.inner(), &connection, &request).await;
    match &result {
        Ok(_) => log_operation(
            settings_store.inner(),
            logger.inner(),
            "info",
            "database",
            "load_database_table_page",
            Some(target),
            "success",
            Some(started_at),
            None,
            None,
        ),
        Err(error) => log_operation(
            settings_store.inner(),
            logger.inner(),
            "error",
            "database",
            "load_database_table_page",
            Some(target),
            "failed",
            Some(started_at),
            Some(error.clone()),
            None,
        ),
    }
    result
}

#[tauri::command]
pub async fn update_database_table_rows(
    settings_store: State<'_, SettingsStore>,
    database_manager: State<'_, DatabaseConnectionManager>,
    logger: State<'_, AppLogger>,
    request: UpdateDatabaseTableRowsRequest,
) -> Result<DatabaseTableUpdateResult, String> {
    let started_at = std::time::Instant::now();
    let target = database_table_target(&request.connection_id, &request.database, &request.table);
    let log_metadata = metadata([
        ("database", metadata_string(request.database.clone())),
        ("table", metadata_string(request.table.clone())),
        ("row_count", metadata_number(request.rows.len() as i64)),
    ]);
    let connection = load_database_connection(settings_store.inner(), &request.connection_id)?;
    let result =
        query::update_database_table_rows(database_manager.inner(), &connection, &request).await;
    log_database_result(
        settings_store.inner(),
        logger.inner(),
        "update_database_table_rows",
        target,
        started_at,
        &result,
        Some(log_metadata),
    );
    result
}

#[tauri::command]
pub async fn insert_database_table_rows(
    settings_store: State<'_, SettingsStore>,
    database_manager: State<'_, DatabaseConnectionManager>,
    logger: State<'_, AppLogger>,
    request: InsertDatabaseTableRowsRequest,
) -> Result<DatabaseTableUpdateResult, String> {
    let started_at = std::time::Instant::now();
    let target = database_table_target(&request.connection_id, &request.database, &request.table);
    let log_metadata = metadata([
        ("database", metadata_string(request.database.clone())),
        ("table", metadata_string(request.table.clone())),
        ("row_count", metadata_number(request.rows.len() as i64)),
    ]);
    let connection = load_database_connection(settings_store.inner(), &request.connection_id)?;
    let result =
        query::insert_database_table_rows(database_manager.inner(), &connection, &request).await;
    log_database_result(
        settings_store.inner(),
        logger.inner(),
        "insert_database_table_rows",
        target,
        started_at,
        &result,
        Some(log_metadata),
    );
    result
}

#[tauri::command]
pub async fn delete_database_table_rows(
    settings_store: State<'_, SettingsStore>,
    database_manager: State<'_, DatabaseConnectionManager>,
    logger: State<'_, AppLogger>,
    request: DeleteDatabaseTableRowsRequest,
) -> Result<DatabaseTableUpdateResult, String> {
    let started_at = std::time::Instant::now();
    let target = database_table_target(&request.connection_id, &request.database, &request.table);
    let log_metadata = metadata([
        ("database", metadata_string(request.database.clone())),
        ("table", metadata_string(request.table.clone())),
        ("row_count", metadata_number(request.rows.len() as i64)),
    ]);
    let connection = load_database_connection(settings_store.inner(), &request.connection_id)?;
    let result =
        query::delete_database_table_rows(database_manager.inner(), &connection, &request).await;
    log_database_result(
        settings_store.inner(),
        logger.inner(),
        "delete_database_table_rows",
        target,
        started_at,
        &result,
        Some(log_metadata),
    );
    result
}

#[tauri::command]
pub async fn get_database_table_ddl(
    settings_store: State<'_, SettingsStore>,
    database_manager: State<'_, DatabaseConnectionManager>,
    logger: State<'_, AppLogger>,
    request: GetDatabaseTableDdlRequest,
) -> Result<DatabaseTableDdlResult, String> {
    let started_at = std::time::Instant::now();
    let target = database_table_target(&request.connection_id, &request.database, &request.table);
    let log_metadata = database_table_metadata(request.database.clone(), request.table.clone());
    let connection = load_database_connection(settings_store.inner(), &request.connection_id)?;
    let result =
        query::get_database_table_ddl(database_manager.inner(), &connection, &request).await;
    log_database_result(
        settings_store.inner(),
        logger.inner(),
        "get_database_table_ddl",
        target,
        started_at,
        &result,
        Some(log_metadata),
    );
    result
}

#[tauri::command]
pub fn list_database_sql_files(
    settings_store: State<'_, SettingsStore>,
    logger: State<'_, AppLogger>,
    sql_file_store: State<'_, DatabaseSqlFileStore>,
    request: ListDatabaseSqlFilesRequest,
) -> Result<Vec<DatabaseSqlFile>, String> {
    let started_at = std::time::Instant::now();
    let target = format!("{}:{}", request.connection_id, request.database);
    let log_metadata = metadata([("database", metadata_string(request.database.clone()))]);
    let result = sql_file_store.list(&request.connection_id, &request.database);
    log_database_result(
        settings_store.inner(),
        logger.inner(),
        "list_database_sql_files",
        target,
        started_at,
        &result,
        Some(log_metadata),
    );
    result
}

#[tauri::command]
pub fn save_database_sql_file(
    settings_store: State<'_, SettingsStore>,
    logger: State<'_, AppLogger>,
    sql_file_store: State<'_, DatabaseSqlFileStore>,
    request: SaveDatabaseSqlFileRequest,
) -> Result<(), String> {
    let started_at = std::time::Instant::now();
    let target = database_sql_file_target(&request.connection_id, &request.database, &request.name);
    let log_metadata = metadata([
        ("database", metadata_string(request.database.clone())),
        ("name", metadata_string(request.name.clone())),
    ]);
    let result = sql_file_store.save(
        &request.connection_id,
        &request.database,
        &request.name,
        &request.content,
    );
    log_database_result(
        settings_store.inner(),
        logger.inner(),
        "save_database_sql_file",
        target,
        started_at,
        &result,
        Some(log_metadata),
    );
    result
}

fn load_database_connection(
    settings_store: &SettingsStore,
    connection_id: &str,
) -> Result<DatabaseConnectionSettings, String> {
    let settings = settings_store
        .load_or_create()
        .map_err(|error| error.to_string())?;
    settings
        .connections
        .into_iter()
        .find_map(|connection| match connection {
            ConnectionSettings::Mysql(connection) | ConnectionSettings::Postgresql(connection)
                if connection.id == connection_id =>
            {
                Some(connection)
            }
            _ => None,
        })
        .ok_or_else(|| format!("database connection not found: {connection_id}"))
}

fn database_query_target(
    settings_store: &SettingsStore,
    request: &ExecuteDatabaseQueryRequest,
) -> String {
    let base = match &request.database {
        Some(database) if !database.is_empty() => format!("{}:{database}", request.connection_id),
        _ => request.connection_id.clone(),
    };
    let include_sql = settings_store
        .load_or_create()
        .map(|settings| settings.logging.include_sql)
        .unwrap_or(false);

    if include_sql {
        format!("{base}:{}", request.sql)
    } else {
        base
    }
}

fn database_table_target(connection_id: &str, database: &str, table: &str) -> String {
    format!("{connection_id}:{database}:{table}")
}

fn database_sql_file_target(connection_id: &str, database: &str, name: &str) -> String {
    format!("{connection_id}:{database}:{name}")
}

fn sql_kind(sql: &str) -> &'static str {
    let first = sql
        .split_whitespace()
        .next()
        .unwrap_or_default()
        .to_ascii_lowercase();
    match first.as_str() {
        "select" | "with" => "select",
        "insert" => "insert",
        "update" => "update",
        "delete" => "delete",
        "create" | "alter" | "drop" | "truncate" => "ddl",
        _ => "other",
    }
}

fn database_table_metadata(
    database: String,
    table: String,
) -> serde_json::Map<String, serde_json::Value> {
    metadata([
        ("database", metadata_string(database)),
        ("table", metadata_string(table)),
    ])
}

fn log_database_result<T>(
    settings_store: &SettingsStore,
    logger: &AppLogger,
    action: &str,
    target: String,
    started_at: std::time::Instant,
    result: &Result<T, String>,
    metadata: Option<serde_json::Map<String, serde_json::Value>>,
) {
    match result {
        Ok(_) => log_operation(
            settings_store,
            logger,
            "info",
            "database",
            action,
            Some(target),
            "success",
            Some(started_at),
            None,
            metadata,
        ),
        Err(error) => log_operation(
            settings_store,
            logger,
            "error",
            "database",
            action,
            Some(target),
            "failed",
            Some(started_at),
            Some(error.clone()),
            metadata,
        ),
    }
}

#[cfg(test)]
mod tests {
    use super::{database_sql_file_target, database_table_target, sql_kind};

    #[test]
    fn builds_database_log_targets() {
        assert_eq!(
            database_table_target("mysql-local", "app", "users"),
            "mysql-local:app:users"
        );
        assert_eq!(
            database_sql_file_target("mysql-local", "app", "default"),
            "mysql-local:app:default"
        );
    }

    #[test]
    fn classifies_sql_kind() {
        assert_eq!(sql_kind(" select * from users"), "select");
        assert_eq!(
            sql_kind("WITH recent AS (select 1) select * from recent"),
            "select"
        );
        assert_eq!(sql_kind("insert into users values (1)"), "insert");
        assert_eq!(sql_kind("update users set name = 'a'"), "update");
        assert_eq!(sql_kind("delete from users"), "delete");
        assert_eq!(sql_kind("create table t(id int)"), "ddl");
        assert_eq!(sql_kind("show tables"), "other");
    }
}
