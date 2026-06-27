use tauri::State;

use crate::commands::logging::{
    log_operation, metadata, metadata_bool, metadata_number, metadata_string,
};
use crate::core::app_logger::AppLogger;
use crate::core::settings_store::SettingsStore;
use crate::db::connection::DatabaseConnectionManager;
use crate::db::export;
use crate::db::metadata;
use crate::db::query;
use crate::db::sql_file;
use crate::db::sql_files::DatabaseSqlFileStore;
use crate::models::database::{
    DatabaseQueryResult, DatabaseResultExportResult, DatabaseSqlFile,
    DatabaseSqlFileExecutionResult, DatabaseSqlFilePreview, DatabaseTableDdlResult,
    DatabaseTablePageResult, DatabaseTableStructureUpdateResult, DatabaseTableUpdateResult,
    DeleteDatabaseTableRowsRequest,
    ExecuteDatabaseQueryRequest, ExecuteDatabaseSqlFileRequest, ExportDatabaseResultRequest,
    GetDatabaseTableDdlRequest, InsertDatabaseTableRowsRequest, ListDatabaseSqlFilesRequest,
    LoadDatabaseTablePageRequest, PreviewDatabaseSqlFileRequest, SaveDatabaseSqlFileRequest,
    UpdateDatabaseTableRowsRequest, UpdateDatabaseTableStructureRequest,
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
            Some(database_connection_metadata(&connection)),
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
            Some(database_connection_metadata(&connection)),
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
    let connection = load_database_connection(settings_store.inner(), &request.connection_id)?;
    let result =
        metadata::list_database_objects(database_manager.inner(), &connection, &request).await;
    match &result {
        Ok(nodes) => log_operation(
            settings_store.inner(),
            logger.inner(),
            "info",
            "database",
            database_object_list_action(&request),
            Some(target),
            "success",
            Some(started_at),
            None,
            Some(database_object_list_metadata(&request, nodes)),
        ),
        Err(error) => log_operation(
            settings_store.inner(),
            logger.inner(),
            "error",
            "database",
            database_object_list_action(&request),
            Some(target),
            "failed",
            Some(started_at),
            Some(error.clone()),
            Some(database_object_request_metadata(&request)),
        ),
    }
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
pub async fn preview_database_table_structure(
    settings_store: State<'_, SettingsStore>,
    logger: State<'_, AppLogger>,
    request: UpdateDatabaseTableStructureRequest,
) -> Result<DatabaseTableStructureUpdateResult, String> {
    let started_at = std::time::Instant::now();
    let target = database_table_target(&request.connection_id, &request.database, &request.table);
    let log_metadata = metadata([
        ("database", metadata_string(request.database.clone())),
        ("table", metadata_string(request.table.clone())),
        ("operation_count", metadata_number(request.operations.len() as i64)),
    ]);
    let connection = load_database_connection(settings_store.inner(), &request.connection_id)?;
    let result = query::preview_database_table_structure(&connection, &request).await;
    log_database_result(
        settings_store.inner(),
        logger.inner(),
        "preview_database_table_structure",
        target,
        started_at,
        &result,
        Some(log_metadata),
    );
    result
}

#[tauri::command]
pub async fn update_database_table_structure(
    settings_store: State<'_, SettingsStore>,
    database_manager: State<'_, DatabaseConnectionManager>,
    logger: State<'_, AppLogger>,
    request: UpdateDatabaseTableStructureRequest,
) -> Result<DatabaseTableStructureUpdateResult, String> {
    let started_at = std::time::Instant::now();
    let target = database_table_target(&request.connection_id, &request.database, &request.table);
    let log_metadata = metadata([
        ("database", metadata_string(request.database.clone())),
        ("table", metadata_string(request.table.clone())),
        ("operation_count", metadata_number(request.operations.len() as i64)),
    ]);
    let connection = load_database_connection(settings_store.inner(), &request.connection_id)?;
    let result =
        query::update_database_table_structure(database_manager.inner(), &connection, &request)
            .await;
    log_database_result(
        settings_store.inner(),
        logger.inner(),
        "update_database_table_structure",
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

#[tauri::command]
pub fn preview_database_sql_file(
    settings_store: State<'_, SettingsStore>,
    logger: State<'_, AppLogger>,
    request: PreviewDatabaseSqlFileRequest,
) -> Result<DatabaseSqlFilePreview, String> {
    let started_at = std::time::Instant::now();
    let target = database_file_target(&request.connection_id, &request.database, &request.path);
    let log_metadata = database_file_metadata(request.database.clone(), request.path.clone());
    let result = sql_file::preview_sql_file(&request.path);
    log_database_result(
        settings_store.inner(),
        logger.inner(),
        "preview_database_sql_file",
        target,
        started_at,
        &result,
        Some(log_metadata),
    );
    result
}

#[tauri::command]
pub async fn execute_database_sql_file(
    settings_store: State<'_, SettingsStore>,
    database_manager: State<'_, DatabaseConnectionManager>,
    logger: State<'_, AppLogger>,
    request: ExecuteDatabaseSqlFileRequest,
) -> Result<DatabaseSqlFileExecutionResult, String> {
    let started_at = std::time::Instant::now();
    let target = database_file_target(&request.connection_id, &request.database, &request.path);
    let log_metadata = database_file_metadata(request.database.clone(), request.path.clone());
    let connection = load_database_connection(settings_store.inner(), &request.connection_id)?;
    let result = sql_file::execute_sql_file(
        database_manager.inner(),
        &connection,
        &request.database,
        &request.path,
    )
    .await;
    log_database_result(
        settings_store.inner(),
        logger.inner(),
        "execute_database_sql_file",
        target,
        started_at,
        &result,
        Some(log_metadata),
    );
    result
}

#[tauri::command]
pub fn export_database_result(
    settings_store: State<'_, SettingsStore>,
    logger: State<'_, AppLogger>,
    request: ExportDatabaseResultRequest,
) -> Result<DatabaseResultExportResult, String> {
    let started_at = std::time::Instant::now();
    let target = database_file_target(&request.connection_id, &request.database, &request.path);
    let log_metadata = metadata([
        ("database", metadata_string(request.database.clone())),
        ("path", metadata_string(request.path.clone())),
        (
            "row_count",
            metadata_number(i64::try_from(request.rows.len()).unwrap_or(i64::MAX)),
        ),
    ]);
    let connection = load_database_connection(settings_store.inner(), &request.connection_id)?;
    let result = export::export_database_result(
        &connection.kind,
        request.table.as_deref(),
        &request.path,
        &request.format,
        request.include_header,
        &request.columns,
        &request.rows,
    )
    .map(|exported_rows| DatabaseResultExportResult {
        exported_rows,
        duration_ms: started_at.elapsed().as_millis(),
    });
    log_database_result(
        settings_store.inner(),
        logger.inner(),
        "export_database_result",
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

fn database_file_target(connection_id: &str, database: &str, path: &str) -> String {
    format!("{connection_id}:{database}:{path}")
}

fn database_file_metadata(
    database: String,
    path: String,
) -> serde_json::Map<String, serde_json::Value> {
    metadata([
        ("database", metadata_string(database)),
        ("path", metadata_string(path)),
    ])
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

const DATABASE_OBJECT_LOG_NAME_LIMIT: usize = 50;

fn database_connection_metadata(
    connection: &DatabaseConnectionSettings,
) -> serde_json::Map<String, serde_json::Value> {
    let mut items = vec![
        ("kind", metadata_string(connection.kind.clone())),
        ("username", metadata_string(connection.username.clone())),
        ("host", metadata_string(connection.host.clone())),
        ("port", metadata_number(i64::from(connection.port))),
        ("address", metadata_string(database_log_address(connection))),
    ];
    if let Some(database) = connection
        .database
        .as_ref()
        .filter(|value| !value.is_empty())
    {
        items.push(("database", metadata_string(database.clone())));
    }
    metadata(items)
}

fn database_log_address(connection: &DatabaseConnectionSettings) -> String {
    let base = format!(
        "{}://{}@{}:{}",
        connection.kind, connection.username, connection.host, connection.port
    );
    match connection
        .database
        .as_deref()
        .filter(|database| !database.is_empty())
    {
        Some(database) => format!("{base}/{database}"),
        None => base,
    }
}

fn database_object_request_metadata(
    request: &ListDatabaseObjectsRequest,
) -> serde_json::Map<String, serde_json::Value> {
    let mut items = Vec::new();
    if let Some(parent_kind) = request
        .parent_kind
        .as_ref()
        .filter(|value| !value.is_empty())
    {
        items.push(("parent_kind", metadata_string(parent_kind.clone())));
    }
    if let Some(database) = request.database.as_ref().filter(|value| !value.is_empty()) {
        items.push(("database", metadata_string(database.clone())));
    }
    if let Some(schema) = request.schema.as_ref().filter(|value| !value.is_empty()) {
        items.push(("schema", metadata_string(schema.clone())));
    }
    if let Some(table) = request.table.as_ref().filter(|value| !value.is_empty()) {
        items.push(("table", metadata_string(table.clone())));
    }
    metadata(items)
}

fn database_object_list_metadata(
    request: &ListDatabaseObjectsRequest,
    nodes: &[DatabaseTreeNode],
) -> serde_json::Map<String, serde_json::Value> {
    let mut log_metadata = database_object_request_metadata(request);
    append_database_object_summary(&mut log_metadata, nodes, "database", "databases");
    append_database_object_summary(&mut log_metadata, nodes, "schema", "schemas");
    append_database_object_summary(&mut log_metadata, nodes, "table", "tables");
    append_database_object_summary(&mut log_metadata, nodes, "view", "views");
    append_database_object_summary(&mut log_metadata, nodes, "column", "columns");
    log_metadata
}

fn database_object_list_action(request: &ListDatabaseObjectsRequest) -> &'static str {
    match request.parent_kind.as_deref() {
        None => "list_database_databases",
        Some("database") | Some("schema") => "list_database_tables",
        Some("table") | Some("view") => "list_database_columns",
        _ => "list_database_objects",
    }
}

fn append_database_object_summary(
    log_metadata: &mut serde_json::Map<String, serde_json::Value>,
    nodes: &[DatabaseTreeNode],
    kind: &str,
    plural_name: &str,
) {
    let names = nodes
        .iter()
        .filter(|node| node.kind == kind)
        .map(|node| node.name.clone())
        .collect::<Vec<_>>();
    let count_key = format!("returned_{kind}_count");
    log_metadata.insert(count_key, metadata_number(names.len() as i64));
    if names.is_empty() {
        return;
    }

    let truncated = names.len() > DATABASE_OBJECT_LOG_NAME_LIMIT;
    let values = names
        .into_iter()
        .take(DATABASE_OBJECT_LOG_NAME_LIMIT)
        .map(serde_json::Value::String)
        .collect::<Vec<_>>();
    log_metadata.insert(
        format!("returned_{plural_name}"),
        serde_json::Value::Array(values),
    );
    if truncated {
        log_metadata.insert(
            format!("returned_{plural_name}_truncated"),
            metadata_bool(true),
        );
    }
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
    use super::{
        database_connection_metadata, database_file_target, database_object_list_action,
        database_object_list_metadata, database_sql_file_target, database_table_target, sql_kind,
    };
    use crate::models::database::{DatabaseTreeNode, ListDatabaseObjectsRequest};
    use crate::models::settings::DatabaseConnectionSettings;
    use serde_json::json;

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
        assert_eq!(
            database_file_target("mysql-local", "app", "C:\\tmp\\seed.sql"),
            "mysql-local:app:C:\\tmp\\seed.sql"
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

    #[test]
    fn builds_database_connection_metadata_without_password() {
        let connection = DatabaseConnectionSettings {
            kind: "mysql".to_string(),
            id: "mysql-local".to_string(),
            name: "本地 MySQL".to_string(),
            group: Some("测试".to_string()),
            host: "127.0.0.1".to_string(),
            port: 3306,
            username: "root".to_string(),
            password: "secret".to_string(),
            database: Some("app".to_string()),
        };

        let metadata = database_connection_metadata(&connection);

        assert_eq!(metadata["kind"], "mysql");
        assert_eq!(metadata["username"], "root");
        assert_eq!(metadata["host"], "127.0.0.1");
        assert_eq!(metadata["port"], 3306);
        assert_eq!(metadata["database"], "app");
        assert_eq!(metadata["address"], "mysql://root@127.0.0.1:3306/app");
        assert!(!metadata.contains_key("password"));
    }

    #[test]
    fn summarizes_returned_databases_for_root_object_list() {
        let request = ListDatabaseObjectsRequest {
            connection_id: "mysql-local".to_string(),
            parent_kind: None,
            database: None,
            schema: None,
            table: None,
        };
        let nodes = vec![
            tree_node("database", "app"),
            tree_node("database", "information_schema"),
            tree_node("schema", "public"),
        ];

        let metadata = database_object_list_metadata(&request, &nodes);

        assert_eq!(metadata["returned_database_count"], 2);
        assert_eq!(metadata["returned_schema_count"], 1);
        assert_eq!(
            metadata["returned_databases"],
            json!(["app", "information_schema"])
        );
        assert_eq!(metadata["returned_schemas"], json!(["public"]));
    }

    #[test]
    fn summarizes_returned_tables_and_truncates_names() {
        let request = ListDatabaseObjectsRequest {
            connection_id: "mysql-local".to_string(),
            parent_kind: Some("database".to_string()),
            database: Some("app".to_string()),
            schema: None,
            table: None,
        };
        let mut nodes = (0..55)
            .map(|index| tree_node("table", &format!("table_{index:02}")))
            .collect::<Vec<_>>();
        nodes.push(tree_node("view", "v_users"));

        let metadata = database_object_list_metadata(&request, &nodes);

        assert_eq!(metadata["database"], "app");
        assert_eq!(metadata["parent_kind"], "database");
        assert_eq!(metadata["returned_table_count"], 55);
        assert_eq!(metadata["returned_view_count"], 1);
        assert_eq!(metadata["returned_tables"].as_array().unwrap().len(), 50);
        assert_eq!(metadata["returned_tables_truncated"], true);
        assert_eq!(metadata["returned_views"], json!(["v_users"]));
    }

    #[test]
    fn summarizes_empty_database_object_lists_with_zero_counts() {
        let request = ListDatabaseObjectsRequest {
            connection_id: "mysql-local".to_string(),
            parent_kind: Some("database".to_string()),
            database: Some("game".to_string()),
            schema: None,
            table: None,
        };

        let metadata = database_object_list_metadata(&request, &[]);

        assert_eq!(metadata["database"], "game");
        assert_eq!(metadata["parent_kind"], "database");
        assert_eq!(metadata["returned_database_count"], 0);
        assert_eq!(metadata["returned_schema_count"], 0);
        assert_eq!(metadata["returned_table_count"], 0);
        assert_eq!(metadata["returned_view_count"], 0);
        assert_eq!(metadata["returned_column_count"], 0);
        assert!(metadata.get("returned_tables").is_none());
    }

    #[test]
    fn classifies_database_object_list_log_action_by_parent_kind() {
        assert_eq!(
            database_object_list_action(&object_request(None)),
            "list_database_databases"
        );
        assert_eq!(
            database_object_list_action(&object_request(Some("database"))),
            "list_database_tables"
        );
        assert_eq!(
            database_object_list_action(&object_request(Some("schema"))),
            "list_database_tables"
        );
        assert_eq!(
            database_object_list_action(&object_request(Some("table"))),
            "list_database_columns"
        );
        assert_eq!(
            database_object_list_action(&object_request(Some("other"))),
            "list_database_objects"
        );
    }

    fn object_request(parent_kind: Option<&str>) -> ListDatabaseObjectsRequest {
        ListDatabaseObjectsRequest {
            connection_id: "mysql-local".to_string(),
            parent_kind: parent_kind.map(str::to_string),
            database: None,
            schema: None,
            table: None,
        }
    }

    fn tree_node(kind: &str, name: &str) -> DatabaseTreeNode {
        DatabaseTreeNode {
            id: format!("{kind}:{name}"),
            name: name.to_string(),
            kind: kind.to_string(),
            has_children: true,
            detail: None,
        }
    }
}
