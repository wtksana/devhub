use tauri::State;

use crate::core::settings_store::SettingsStore;
use crate::db::connection::DatabaseConnectionManager;
use crate::db::metadata;
use crate::db::query;
use crate::models::database::{DatabaseQueryResult, ExecuteDatabaseQueryRequest};
use crate::models::database::{DatabaseTreeNode, ListDatabaseObjectsRequest};
use crate::models::settings::{ConnectionSettings, DatabaseConnectionSettings};

#[tauri::command]
pub async fn test_database_connection(
    settings_store: State<'_, SettingsStore>,
    database_manager: State<'_, DatabaseConnectionManager>,
    connection_id: String,
) -> Result<String, String> {
    let connection = load_database_connection(settings_store.inner(), &connection_id)?;
    database_manager
        .test_connection(&connection)
        .await
        .map(|_| "OK".to_string())
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
    request: ExecuteDatabaseQueryRequest,
) -> Result<DatabaseQueryResult, String> {
    let connection = load_database_connection(settings_store.inner(), &request.connection_id)?;
    query::execute_database_query(database_manager.inner(), &connection, &request).await
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
