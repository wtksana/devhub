use tauri::State;

use crate::commands::logging::log_operation;
use crate::core::app_logger::AppLogger;
use crate::core::settings_store::SettingsStore;
use crate::db::connection::DatabaseConnectionManager;
use crate::db::metadata;
use crate::db::query;
use crate::db::sql_files::DatabaseSqlFileStore;
use crate::models::database::{
    DeleteDatabaseTableRowsRequest,
    DatabaseQueryResult, DatabaseSqlFile, DatabaseTableDdlResult, DatabaseTablePageResult,
    DatabaseTableUpdateResult, ExecuteDatabaseQueryRequest, GetDatabaseTableDdlRequest,
    InsertDatabaseTableRowsRequest, ListDatabaseSqlFilesRequest, LoadDatabaseTablePageRequest,
    SaveDatabaseSqlFileRequest,
    UpdateDatabaseTableRowsRequest,
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
    request: ListDatabaseObjectsRequest,
) -> Result<Vec<DatabaseTreeNode>, String> {
    let connection = load_database_connection(settings_store.inner(), &request.connection_id)?;
    metadata::list_database_objects(database_manager.inner(), &connection, &request).await
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
    let connection = load_database_connection(settings_store.inner(), &request.connection_id)?;
    let result = query::execute_database_query(database_manager.inner(), &connection, &request).await;
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
            None,
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
            None,
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
    let result = query::load_database_table_page(database_manager.inner(), &connection, &request).await;
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
    request: UpdateDatabaseTableRowsRequest,
) -> Result<DatabaseTableUpdateResult, String> {
    let connection = load_database_connection(settings_store.inner(), &request.connection_id)?;
    query::update_database_table_rows(database_manager.inner(), &connection, &request).await
}

#[tauri::command]
pub async fn insert_database_table_rows(
    settings_store: State<'_, SettingsStore>,
    database_manager: State<'_, DatabaseConnectionManager>,
    request: InsertDatabaseTableRowsRequest,
) -> Result<DatabaseTableUpdateResult, String> {
    let connection = load_database_connection(settings_store.inner(), &request.connection_id)?;
    query::insert_database_table_rows(database_manager.inner(), &connection, &request).await
}

#[tauri::command]
pub async fn delete_database_table_rows(
    settings_store: State<'_, SettingsStore>,
    database_manager: State<'_, DatabaseConnectionManager>,
    request: DeleteDatabaseTableRowsRequest,
) -> Result<DatabaseTableUpdateResult, String> {
    let connection = load_database_connection(settings_store.inner(), &request.connection_id)?;
    query::delete_database_table_rows(database_manager.inner(), &connection, &request).await
}

#[tauri::command]
pub async fn get_database_table_ddl(
    settings_store: State<'_, SettingsStore>,
    database_manager: State<'_, DatabaseConnectionManager>,
    request: GetDatabaseTableDdlRequest,
) -> Result<DatabaseTableDdlResult, String> {
    let connection = load_database_connection(settings_store.inner(), &request.connection_id)?;
    query::get_database_table_ddl(database_manager.inner(), &connection, &request).await
}

#[tauri::command]
pub fn list_database_sql_files(
    sql_file_store: State<'_, DatabaseSqlFileStore>,
    request: ListDatabaseSqlFilesRequest,
) -> Result<Vec<DatabaseSqlFile>, String> {
    sql_file_store.list(&request.connection_id, &request.database)
}

#[tauri::command]
pub fn save_database_sql_file(
    sql_file_store: State<'_, DatabaseSqlFileStore>,
    request: SaveDatabaseSqlFileRequest,
) -> Result<(), String> {
    sql_file_store.save(
        &request.connection_id,
        &request.database,
        &request.name,
        &request.content,
    )
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

fn database_query_target(settings_store: &SettingsStore, request: &ExecuteDatabaseQueryRequest) -> String {
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
