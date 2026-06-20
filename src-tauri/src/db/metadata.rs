use sqlx::{Connection, MySqlConnection, PgConnection, Row};

use crate::db::connection::database_connection_url;
use crate::db::connection::DatabaseConnectionManager;
use crate::models::database::{DatabaseTreeNode, ListDatabaseObjectsRequest};
use crate::models::settings::DatabaseConnectionSettings;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MetadataQuery {
    pub sql: String,
    pub binds: Vec<String>,
}

pub async fn list_database_objects(
    _manager: &DatabaseConnectionManager,
    connection: &DatabaseConnectionSettings,
    request: &ListDatabaseObjectsRequest,
) -> Result<Vec<DatabaseTreeNode>, String> {
    match connection.kind.as_str() {
        "mysql" => list_mysql_objects(connection, request).await,
        "postgresql" => list_postgresql_objects(connection, request).await,
        kind => Err(format!("unsupported database connection kind: {kind}")),
    }
}

pub fn metadata_query_for_tables(
    kind: &str,
    database_or_schema: &str,
    table_type: Option<&str>,
) -> Result<MetadataQuery, String> {
    match kind {
        "mysql" => {
            let mut sql = "select table_name, table_type from information_schema.tables where table_schema = ?".to_string();
            let mut binds = vec![database_or_schema.to_string()];
            if let Some(table_type) = table_type {
                sql.push_str(" and table_type = ?");
                binds.push(table_type.to_string());
            }
            sql.push_str(" order by table_type, table_name");
            Ok(MetadataQuery { sql, binds })
        }
        "postgresql" => {
            let mut sql = "select table_name, table_type from information_schema.tables where table_schema = $1".to_string();
            let mut binds = vec![database_or_schema.to_string()];
            if let Some(table_type) = table_type {
                sql.push_str(" and table_type = $2");
                binds.push(table_type.to_string());
            }
            sql.push_str(" order by table_type, table_name");
            Ok(MetadataQuery { sql, binds })
        }
        kind => Err(format!("unsupported database connection kind: {kind}")),
    }
}

pub fn metadata_query_for_columns(
    kind: &str,
    schema: &str,
    table: &str,
) -> Result<MetadataQuery, String> {
    match kind {
        "mysql" => Ok(MetadataQuery {
            sql: "select column_name, data_type, is_nullable from information_schema.columns where table_schema = ? and table_name = ? order by ordinal_position".to_string(),
            binds: vec![schema.to_string(), table.to_string()],
        }),
        "postgresql" => Ok(MetadataQuery {
            sql: "select column_name, data_type, is_nullable from information_schema.columns where table_schema = $1 and table_name = $2 order by ordinal_position".to_string(),
            binds: vec![schema.to_string(), table.to_string()],
        }),
        kind => Err(format!("unsupported database connection kind: {kind}")),
    }
}

async fn list_mysql_objects(
    connection: &DatabaseConnectionSettings,
    request: &ListDatabaseObjectsRequest,
) -> Result<Vec<DatabaseTreeNode>, String> {
    let url = database_connection_url(connection)?;
    let mut connection = MySqlConnection::connect(&url)
        .await
        .map_err(|error| error.to_string())?;
    let nodes = match request.parent_kind.as_deref() {
        None => {
            let rows = sqlx::query(
                "select schema_name from information_schema.schemata order by schema_name",
            )
            .fetch_all(&mut connection)
            .await
            .map_err(|error| error.to_string())?;
            rows.into_iter()
                .map(|row| {
                    let name: String = row.get("schema_name");
                    DatabaseTreeNode {
                        id: format!("database:{name}"),
                        name,
                        kind: "database".to_string(),
                        has_children: true,
                        detail: None,
                    }
                })
                .collect()
        }
        Some("database") | Some("schema") => {
            let schema = request
                .database
                .as_deref()
                .or(request.schema.as_deref())
                .ok_or_else(|| "database is required".to_string())?;
            let query = metadata_query_for_tables("mysql", schema, None)?;
            let rows = sqlx::query(&query.sql)
                .bind(&query.binds[0])
                .fetch_all(&mut connection)
                .await
                .map_err(|error| error.to_string())?;
            rows.into_iter()
                .map(|row| {
                    let name: String = row.get("table_name");
                    let table_type: String = row.get("table_type");
                    let kind = table_kind(&table_type);
                    DatabaseTreeNode {
                        id: format!("{kind}:{schema}.{name}"),
                        name,
                        kind,
                        has_children: true,
                        detail: Some(table_type),
                    }
                })
                .collect()
        }
        Some("table") | Some("view") => {
            let schema = request
                .database
                .as_deref()
                .or(request.schema.as_deref())
                .ok_or_else(|| "database is required".to_string())?;
            let table = request
                .table
                .as_deref()
                .ok_or_else(|| "table is required".to_string())?;
            list_mysql_columns(&mut connection, schema, table).await?
        }
        Some(kind) => return Err(format!("unsupported database object kind: {kind}")),
    };
    connection
        .close()
        .await
        .map_err(|error| error.to_string())?;
    Ok(nodes)
}

async fn list_postgresql_objects(
    connection: &DatabaseConnectionSettings,
    request: &ListDatabaseObjectsRequest,
) -> Result<Vec<DatabaseTreeNode>, String> {
    let url = database_connection_url(connection)?;
    let mut connection = PgConnection::connect(&url)
        .await
        .map_err(|error| error.to_string())?;
    let nodes = match request.parent_kind.as_deref() {
        None => {
            let rows = sqlx::query("select schema_name from information_schema.schemata where schema_name not in ('information_schema', 'pg_catalog') order by schema_name")
                .fetch_all(&mut connection)
                .await
                .map_err(|error| error.to_string())?;
            rows.into_iter()
                .map(|row| {
                    let name: String = row.get("schema_name");
                    DatabaseTreeNode {
                        id: format!("schema:{name}"),
                        name,
                        kind: "schema".to_string(),
                        has_children: true,
                        detail: None,
                    }
                })
                .collect()
        }
        Some("schema") | Some("database") => {
            let schema = request
                .schema
                .as_deref()
                .or(request.database.as_deref())
                .ok_or_else(|| "schema is required".to_string())?;
            let query = metadata_query_for_tables("postgresql", schema, None)?;
            let rows = sqlx::query(&query.sql)
                .bind(&query.binds[0])
                .fetch_all(&mut connection)
                .await
                .map_err(|error| error.to_string())?;
            rows.into_iter()
                .map(|row| {
                    let name: String = row.get("table_name");
                    let table_type: String = row.get("table_type");
                    let kind = table_kind(&table_type);
                    DatabaseTreeNode {
                        id: format!("{kind}:{schema}.{name}"),
                        name,
                        kind,
                        has_children: true,
                        detail: Some(table_type),
                    }
                })
                .collect()
        }
        Some("table") | Some("view") => {
            let schema = request
                .schema
                .as_deref()
                .or(request.database.as_deref())
                .ok_or_else(|| "schema is required".to_string())?;
            let table = request
                .table
                .as_deref()
                .ok_or_else(|| "table is required".to_string())?;
            list_postgresql_columns(&mut connection, schema, table).await?
        }
        Some(kind) => return Err(format!("unsupported database object kind: {kind}")),
    };
    connection
        .close()
        .await
        .map_err(|error| error.to_string())?;
    Ok(nodes)
}

async fn list_mysql_columns(
    connection: &mut MySqlConnection,
    schema: &str,
    table: &str,
) -> Result<Vec<DatabaseTreeNode>, String> {
    let query = metadata_query_for_columns("mysql", schema, table)?;
    let rows = sqlx::query(&query.sql)
        .bind(&query.binds[0])
        .bind(&query.binds[1])
        .fetch_all(connection)
        .await
        .map_err(|error| error.to_string())?;

    Ok(column_nodes(rows, schema, table))
}

async fn list_postgresql_columns(
    connection: &mut PgConnection,
    schema: &str,
    table: &str,
) -> Result<Vec<DatabaseTreeNode>, String> {
    let query = metadata_query_for_columns("postgresql", schema, table)?;
    let rows = sqlx::query(&query.sql)
        .bind(&query.binds[0])
        .bind(&query.binds[1])
        .fetch_all(connection)
        .await
        .map_err(|error| error.to_string())?;

    Ok(column_nodes(rows, schema, table))
}

fn column_nodes<R>(rows: Vec<R>, schema: &str, table: &str) -> Vec<DatabaseTreeNode>
where
    R: Row,
    for<'r> &'r str: sqlx::ColumnIndex<R>,
    for<'r> String: sqlx::Decode<'r, R::Database> + sqlx::Type<R::Database>,
{
    rows.into_iter()
        .map(|row| {
            let name: String = row.get("column_name");
            let data_type: String = row.get("data_type");
            let is_nullable: String = row.get("is_nullable");
            DatabaseTreeNode {
                id: format!("column:{schema}.{table}.{name}"),
                name,
                kind: "column".to_string(),
                has_children: false,
                detail: Some(format!("{data_type} {is_nullable}")),
            }
        })
        .collect()
}

fn table_kind(table_type: &str) -> String {
    if table_type.to_ascii_lowercase().contains("view") {
        "view".to_string()
    } else {
        "table".to_string()
    }
}
