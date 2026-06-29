use sqlx::mysql::MySqlRow;
use sqlx::{MySqlConnection, PgConnection, Row, ValueRef};

use crate::db::connection::{DatabaseConnectionManager, DatabasePool};
use crate::db::query;
use crate::models::database::{DatabaseCellValue, DatabaseTreeNode, ListDatabaseObjectsRequest};
use crate::models::settings::DatabaseConnectionSettings;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MetadataQuery {
    pub sql: String,
    pub binds: Vec<String>,
}

pub async fn list_database_objects(
    manager: &DatabaseConnectionManager,
    connection: &DatabaseConnectionSettings,
    request: &ListDatabaseObjectsRequest,
) -> Result<Vec<DatabaseTreeNode>, String> {
    match connection.kind.as_str() {
        "mysql" => {
            let DatabasePool::Mysql(pool) = manager.pool(connection, None).await? else {
                return Err("database pool kind mismatch".to_string());
            };
            list_mysql_objects(&pool, request).await
        }
        "postgresql" => {
            let DatabasePool::Postgresql(pool) = manager.pool(connection, None).await? else {
                return Err("database pool kind mismatch".to_string());
            };
            list_postgresql_objects(&pool, request).await
        }
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
            let mut sql = format!(
                "select cast(table_name as char) as table_name, cast(table_type as char) as table_type from information_schema.tables where table_schema = {}",
                mysql_string_literal(database_or_schema)
            );
            let binds = Vec::new();
            if let Some(table_type) = table_type {
                sql.push_str(" and table_type = ");
                sql.push_str(&mysql_string_literal(table_type));
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

pub fn metadata_query_for_schemas(kind: &str) -> Result<MetadataQuery, String> {
    match kind {
        "mysql" => Ok(MetadataQuery {
            sql: "select cast(schema_name as char) as schema_name from information_schema.schemata order by schema_name".to_string(),
            binds: Vec::new(),
        }),
        "postgresql" => Ok(MetadataQuery {
            sql: "select schema_name from information_schema.schemata where schema_name not in ('information_schema', 'pg_catalog') order by schema_name".to_string(),
            binds: Vec::new(),
        }),
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
            sql: "select cast(column_name as char) as column_name, cast(column_type as char) as data_type, cast(is_nullable as char) as is_nullable, coalesce(cast(column_default as char), '') as column_default, case when column_default is null then 'YES' else 'NO' end as column_default_is_null, coalesce(cast(extra as char), '') as extra, coalesce(cast(column_comment as char), '') as column_comment from information_schema.columns where table_schema = ? and table_name = ? order by ordinal_position".to_string(),
            binds: vec![schema.to_string(), table.to_string()],
        }),
        "postgresql" => Ok(MetadataQuery {
            sql: "select column_name, data_type, is_nullable, coalesce(column_default, '') as column_default, case when column_default is null then 'YES' else 'NO' end as column_default_is_null, '' as extra, '' as column_comment from information_schema.columns where table_schema = $1 and table_name = $2 order by ordinal_position".to_string(),
            binds: vec![schema.to_string(), table.to_string()],
        }),
        kind => Err(format!("unsupported database connection kind: {kind}")),
    }
}

pub fn metadata_query_for_indexes(
    kind: &str,
    schema: &str,
    table: &str,
) -> Result<MetadataQuery, String> {
    match kind {
        "mysql" => Ok(MetadataQuery {
            sql: "select cast(index_name as char) as index_name, case when non_unique = 0 then 'YES' else 'NO' end as is_unique, group_concat(cast(column_name as char) order by seq_in_index separator ', ') as columns, concat(case when non_unique = 0 then 'UNIQUE KEY' else 'KEY' end, ' `', cast(index_name as char), '` (', group_concat(concat('`', cast(column_name as char), '`') order by seq_in_index separator ', '), ')') as definition from information_schema.statistics where table_schema = ? and table_name = ? group by index_name, non_unique order by index_name".to_string(),
            binds: vec![schema.to_string(), table.to_string()],
        }),
        "postgresql" => Ok(MetadataQuery {
            sql: "select indexname as index_name, case when indexdef ilike 'create unique index%' then 'YES' else 'NO' end as is_unique, '' as columns, indexdef as definition from pg_indexes where schemaname = $1 and tablename = $2 order by indexname".to_string(),
            binds: vec![schema.to_string(), table.to_string()],
        }),
        kind => Err(format!("unsupported database connection kind: {kind}")),
    }
}

async fn list_mysql_objects(
    pool: &sqlx::MySqlPool,
    request: &ListDatabaseObjectsRequest,
) -> Result<Vec<DatabaseTreeNode>, String> {
    let nodes = match request.parent_kind.as_deref() {
        None => {
            let mut connection = pool.acquire().await.map_err(|error| error.to_string())?;
            let query = metadata_query_for_schemas("mysql")?;
            let rows = sqlx::query(&query.sql)
                .fetch_all(&mut *connection)
                .await
                .map_err(|error| error.to_string())?;
            rows.into_iter()
                .map(|row| {
                    let name = mysql_string_by_index(&row, 0)?;
                    Ok(DatabaseTreeNode {
                        id: format!("database:{name}"),
                        name,
                        kind: "database".to_string(),
                        has_children: true,
                        detail: None,
                    })
                })
                .collect::<Result<Vec<_>, String>>()?
        }
        Some("database") | Some("schema") => {
            let schema = request
                .database
                .as_deref()
                .or(request.schema.as_deref())
                .ok_or_else(|| "database is required".to_string())?;
            list_mysql_tables_via_query_path(pool, schema).await?
        }
        Some("table") | Some("view") => {
            let mut connection = pool.acquire().await.map_err(|error| error.to_string())?;
            let schema = request
                .database
                .as_deref()
                .or(request.schema.as_deref())
                .ok_or_else(|| "database is required".to_string())?;
            let table = request
                .table
                .as_deref()
                .ok_or_else(|| "table is required".to_string())?;
            let mut nodes = list_mysql_columns(&mut connection, schema, table).await?;
            nodes.extend(list_mysql_indexes(&mut connection, schema, table).await?);
            nodes
        }
        Some(kind) => return Err(format!("unsupported database object kind: {kind}")),
    };
    Ok(nodes)
}

async fn list_mysql_tables_via_query_path(
    pool: &sqlx::MySqlPool,
    schema: &str,
) -> Result<Vec<DatabaseTreeNode>, String> {
    let query = metadata_query_for_tables("mysql", schema, None)?;
    let result = query::execute_mysql_query(pool, &query.sql, true, false).await?;
    Ok(table_nodes_from_query_result(schema, result.rows))
}

fn table_nodes_from_query_result(
    schema: &str,
    rows: Vec<Vec<DatabaseCellValue>>,
) -> Vec<DatabaseTreeNode> {
    rows.into_iter()
        .filter_map(|row| {
            let name = cell_string(row.first()?)?;
            let table_type = cell_string(row.get(1)?).unwrap_or_default();
            Some(table_node(schema, name, table_type))
        })
        .collect()
}

fn table_node(schema: &str, name: String, table_type: String) -> DatabaseTreeNode {
    let kind = table_kind(&table_type);
    DatabaseTreeNode {
        id: format!("{kind}:{schema}.{name}"),
        name,
        kind,
        has_children: true,
        detail: Some(table_type),
    }
}

fn cell_string(value: &DatabaseCellValue) -> Option<String> {
    match value {
        DatabaseCellValue::Text { value } | DatabaseCellValue::Number { value } => {
            Some(value.clone())
        }
        DatabaseCellValue::Bool { value } => Some(value.to_string()),
        DatabaseCellValue::Null => None,
    }
}

async fn list_postgresql_objects(
    pool: &sqlx::PgPool,
    request: &ListDatabaseObjectsRequest,
) -> Result<Vec<DatabaseTreeNode>, String> {
    let mut connection = pool.acquire().await.map_err(|error| error.to_string())?;
    let nodes = match request.parent_kind.as_deref() {
        None => {
            let query = metadata_query_for_schemas("postgresql")?;
            let rows = sqlx::query(&query.sql)
                .fetch_all(&mut *connection)
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
                .fetch_all(&mut *connection)
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
            let mut nodes = list_postgresql_columns(&mut connection, schema, table).await?;
            nodes.extend(list_postgresql_indexes(&mut connection, schema, table).await?);
            nodes
        }
        Some(kind) => return Err(format!("unsupported database object kind: {kind}")),
    };
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

    mysql_column_nodes(rows, schema, table)
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

async fn list_mysql_indexes(
    connection: &mut MySqlConnection,
    schema: &str,
    table: &str,
) -> Result<Vec<DatabaseTreeNode>, String> {
    let query = metadata_query_for_indexes("mysql", schema, table)?;
    let rows = sqlx::query(&query.sql)
        .bind(&query.binds[0])
        .bind(&query.binds[1])
        .fetch_all(connection)
        .await
        .map_err(|error| error.to_string())?;

    mysql_index_nodes(rows, schema, table)
}

async fn list_postgresql_indexes(
    connection: &mut PgConnection,
    schema: &str,
    table: &str,
) -> Result<Vec<DatabaseTreeNode>, String> {
    let query = metadata_query_for_indexes("postgresql", schema, table)?;
    let rows = sqlx::query(&query.sql)
        .bind(&query.binds[0])
        .bind(&query.binds[1])
        .fetch_all(connection)
        .await
        .map_err(|error| error.to_string())?;

    Ok(index_nodes(rows, schema, table))
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
            let default_value: String = row.get("column_default");
            let default_is_null: String = row.get("column_default_is_null");
            let extra: String = row.get("extra");
            let comment: String = row.get("column_comment");
            DatabaseTreeNode {
                id: format!("column:{schema}.{table}.{name}"),
                name,
                kind: "column".to_string(),
                has_children: false,
                detail: Some(format!(
                    "type={data_type};nullable={is_nullable};default={default_value};default_null={default_is_null};extra={extra};comment={comment}"
                )),
            }
        })
        .collect()
}

fn index_nodes<R>(rows: Vec<R>, schema: &str, table: &str) -> Vec<DatabaseTreeNode>
where
    R: Row,
    for<'r> &'r str: sqlx::ColumnIndex<R>,
    for<'r> String: sqlx::Decode<'r, R::Database> + sqlx::Type<R::Database>,
{
    rows.into_iter()
        .map(|row| {
            let name: String = row.get("index_name");
            let is_unique: String = row.get("is_unique");
            let columns: String = row.get("columns");
            let definition: String = row.get("definition");
            DatabaseTreeNode {
                id: format!("index:{schema}.{table}.{name}"),
                name,
                kind: "index".to_string(),
                has_children: false,
                detail: Some(format!(
                    "unique={is_unique};columns={columns};definition={definition}"
                )),
            }
        })
        .collect()
}

fn mysql_column_nodes(
    rows: Vec<MySqlRow>,
    schema: &str,
    table: &str,
) -> Result<Vec<DatabaseTreeNode>, String> {
    rows.into_iter()
        .map(|row| {
            let name = mysql_string_by_name(&row, "column_name")?;
            let data_type = mysql_string_by_name(&row, "data_type")?;
            let is_nullable = mysql_string_by_name(&row, "is_nullable")?;
            let default_value = mysql_string_by_name(&row, "column_default")?;
            let default_is_null = mysql_string_by_name(&row, "column_default_is_null")?;
            let extra = mysql_string_by_name(&row, "extra")?;
            let comment = mysql_string_by_name(&row, "column_comment")?;
            Ok(DatabaseTreeNode {
                id: format!("column:{schema}.{table}.{name}"),
                name,
                kind: "column".to_string(),
                has_children: false,
                detail: Some(format!(
                    "type={data_type};nullable={is_nullable};default={default_value};default_null={default_is_null};extra={extra};comment={comment}"
                )),
            })
        })
        .collect()
}

fn mysql_index_nodes(
    rows: Vec<MySqlRow>,
    schema: &str,
    table: &str,
) -> Result<Vec<DatabaseTreeNode>, String> {
    rows.into_iter()
        .map(|row| {
            let name = mysql_string_by_name(&row, "index_name")?;
            let is_unique = mysql_string_by_name(&row, "is_unique")?;
            let columns = mysql_string_by_name(&row, "columns")?;
            let definition = mysql_string_by_name(&row, "definition")?;
            Ok(DatabaseTreeNode {
                id: format!("index:{schema}.{table}.{name}"),
                name,
                kind: "index".to_string(),
                has_children: false,
                detail: Some(format!(
                    "unique={is_unique};columns={columns};definition={definition}"
                )),
            })
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

fn mysql_string_literal(value: &str) -> String {
    format!("'{}'", value.replace('\\', "\\\\").replace('\'', "''"))
}

fn mysql_string_by_index(row: &MySqlRow, index: usize) -> Result<String, String> {
    if let Ok(value) = row.try_get::<String, _>(index) {
        return Ok(value);
    }
    if let Ok(value) = row.try_get_unchecked::<String, _>(index) {
        return Ok(value);
    }
    if let Ok(bytes) = row.try_get_unchecked::<Vec<u8>, _>(index) {
        return Ok(String::from_utf8_lossy(&bytes).into_owned());
    }
    Err(format!(
        "failed to decode mysql metadata column at index {index}"
    ))
}

fn mysql_string_by_name(row: &MySqlRow, column_name: &str) -> Result<String, String> {
    if let Ok(value_ref) = row.try_get_raw(column_name) {
        if value_ref.is_null() {
            return Ok(String::new());
        }
    }
    if let Ok(value) = row.try_get::<String, _>(column_name) {
        return Ok(value);
    }
    if let Ok(value) = row.try_get_unchecked::<String, _>(column_name) {
        return Ok(value);
    }
    if let Ok(bytes) = row.try_get_unchecked::<Vec<u8>, _>(column_name) {
        return Ok(String::from_utf8_lossy(&bytes).into_owned());
    }
    Err(format!(
        "failed to decode mysql metadata column: {column_name}"
    ))
}
