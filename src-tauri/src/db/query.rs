use std::collections::{BTreeMap, BTreeSet};
use std::time::Instant;

use sqlx::mysql::{MySqlArguments, MySqlRow};
use sqlx::postgres::{PgArguments, PgRow};
use sqlx::{Column, Connection, MySql, MySqlConnection, PgConnection, Postgres, Row, TypeInfo, ValueRef};

use crate::db::connection::database_connection_url;
use crate::db::connection::DatabaseConnectionManager;
use crate::db::metadata::MetadataQuery;
use crate::models::database::{
    DatabaseCellValue, DatabaseQueryResult, DatabaseResultColumn, DatabaseTablePageResult,
    DatabaseTableUpdateResult, ExecuteDatabaseQueryRequest, LoadDatabaseTablePageRequest,
    UpdateDatabaseTableRowsRequest,
};
use crate::models::settings::DatabaseConnectionSettings;

const DEFAULT_QUERY_LIMIT: u32 = 200;
const DEFAULT_TABLE_PAGE_SIZE: u32 = 200;
const MAX_TABLE_PAGE_SIZE: u32 = 10_000;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NormalizedTablePageRequest {
    pub connection_id: String,
    pub database: String,
    pub table: String,
    pub page: u32,
    pub page_size: u32,
    pub sort_column: Option<String>,
    pub sort_direction: Option<String>,
    pub filter: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TablePageQueries {
    pub count_sql: String,
    pub page_sql: String,
}

#[derive(Debug, Clone, PartialEq)]
pub struct NormalizedTableUpdateRequest {
    pub connection_id: String,
    pub database: String,
    pub table: String,
    pub primary_key_columns: Vec<String>,
    pub rows: Vec<NormalizedTableUpdateRow>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct NormalizedTableUpdateRow {
    pub primary_key_values: BTreeMap<String, DatabaseCellValue>,
    pub changes: BTreeMap<String, DatabaseCellValue>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct TableUpdateQuery {
    pub sql: String,
    pub values: Vec<DatabaseCellValue>,
}

pub async fn execute_database_query(
    _manager: &DatabaseConnectionManager,
    connection: &DatabaseConnectionSettings,
    request: &ExecuteDatabaseQueryRequest,
) -> Result<DatabaseQueryResult, String> {
    let normalized_sql = request.sql.trim();
    if normalized_sql.is_empty() {
        return Err("sql is required".to_string());
    }

    let is_select = is_select_sql(normalized_sql);
    let limit = request
        .limit
        .unwrap_or(DEFAULT_QUERY_LIMIT)
        .clamp(1, 10_000);
    let sql = if is_select {
        apply_select_limit(normalized_sql, limit)?
    } else {
        normalized_sql.to_string()
    };
    let limited = is_select && sql != normalized_sql;

    match connection.kind.as_str() {
        "mysql" => execute_mysql_query(connection, &sql, is_select, limited).await,
        "postgresql" => execute_postgresql_query(connection, &sql, is_select, limited).await,
        kind => Err(format!("unsupported database connection kind: {kind}")),
    }
}

pub fn is_select_sql(sql: &str) -> bool {
    first_sql_keyword(sql).is_some_and(|keyword| keyword.eq_ignore_ascii_case("select"))
}

pub fn is_dangerous_sql(sql: &str) -> bool {
    match first_sql_keyword(sql) {
        Some(keyword) => matches!(
            keyword.to_ascii_lowercase().as_str(),
            "delete" | "drop" | "truncate" | "update" | "insert" | "alter" | "create" | "replace"
        ),
        None => true,
    }
}

pub fn apply_select_limit(sql: &str, limit: u32) -> Result<String, String> {
    let trimmed = sql.trim();
    if !is_select_sql(trimmed) {
        return Ok(trimmed.to_string());
    }
    if contains_limit_clause(trimmed) {
        return Ok(trimmed.to_string());
    }
    let without_semicolon = trimmed.trim_end_matches(';').trim_end();
    Ok(format!("{without_semicolon} LIMIT {limit}"))
}

pub fn quote_identifier(kind: &str, identifier: &str) -> Result<String, String> {
    match kind {
        "mysql" => Ok(format!("`{}`", identifier.replace('`', "``"))),
        "postgresql" => Ok(format!("\"{}\"", identifier.replace('"', "\"\""))),
        kind => Err(format!("unsupported database connection kind: {kind}")),
    }
}

pub fn primary_key_query_for_table(
    kind: &str,
    database: &str,
    table: &str,
) -> Result<MetadataQuery, String> {
    match kind {
        "mysql" => Ok(MetadataQuery {
            sql: "select column_name from information_schema.key_column_usage where table_schema = ? and table_name = ? and constraint_name = 'PRIMARY' order by ordinal_position".to_string(),
            binds: vec![database.to_string(), table.to_string()],
        }),
        "postgresql" => Ok(MetadataQuery {
            sql: "select kcu.column_name from information_schema.table_constraints tc join information_schema.key_column_usage kcu on tc.constraint_name = kcu.constraint_name and tc.table_schema = kcu.table_schema where tc.table_schema = $1 and tc.table_name = $2 and tc.constraint_type = 'PRIMARY KEY' order by kcu.ordinal_position".to_string(),
            binds: vec![database.to_string(), table.to_string()],
        }),
        kind => Err(format!("unsupported database connection kind: {kind}")),
    }
}

pub fn normalize_table_page_request(
    request: LoadDatabaseTablePageRequest,
) -> Result<NormalizedTablePageRequest, String> {
    let table = request.table.trim();
    if table.is_empty() {
        return Err("table is required".to_string());
    }
    let database = request.database.trim();
    if database.is_empty() {
        return Err("database is required".to_string());
    }
    let sort_direction = request
        .sort_direction
        .map(|direction| direction.trim().to_ascii_lowercase())
        .filter(|direction| !direction.is_empty());
    if let Some(direction) = sort_direction.as_deref() {
        if direction != "asc" && direction != "desc" {
            return Err(format!("unsupported sort direction: {direction}"));
        }
    }

    Ok(NormalizedTablePageRequest {
        connection_id: request.connection_id,
        database: database.to_string(),
        table: table.to_string(),
        page: request.page.unwrap_or(1).max(1),
        page_size: request
            .page_size
            .unwrap_or(DEFAULT_TABLE_PAGE_SIZE)
            .clamp(1, MAX_TABLE_PAGE_SIZE),
        sort_column: request
            .sort_column
            .map(|column| column.trim().to_string())
            .filter(|column| !column.is_empty()),
        sort_direction,
        filter: request
            .filter
            .map(|filter| filter.trim().to_string())
            .filter(|filter| !filter.is_empty()),
    })
}

pub fn build_table_page_queries(
    kind: &str,
    request: &NormalizedTablePageRequest,
) -> Result<TablePageQueries, String> {
    let table = table_page_table_identifier(kind, request)?;
    let where_clause = request
        .filter
        .as_ref()
        .map(|filter| format!(" WHERE {filter}"))
        .unwrap_or_default();
    let order_clause = match (&request.sort_column, &request.sort_direction) {
        (Some(column), Some(direction)) => {
            let column = quote_identifier(kind, column)?;
            format!(" ORDER BY {column} {}", direction.to_ascii_uppercase())
        }
        _ => String::new(),
    };
    let offset = (request.page - 1) as u64 * request.page_size as u64;

    Ok(TablePageQueries {
        count_sql: format!("SELECT COUNT(*) AS total FROM {table}{where_clause}"),
        page_sql: format!(
            "SELECT * FROM {table}{where_clause}{order_clause} LIMIT {} OFFSET {offset}",
            request.page_size
        ),
    })
}

pub fn normalize_table_update_request(
    request: UpdateDatabaseTableRowsRequest,
    actual_primary_key_columns: &[String],
) -> Result<NormalizedTableUpdateRequest, String> {
    let database = request.database.trim();
    if database.is_empty() {
        return Err("database is required".to_string());
    }
    let table = request.table.trim();
    if table.is_empty() {
        return Err("table is required".to_string());
    }
    if actual_primary_key_columns.is_empty() {
        return Err("table has no primary key".to_string());
    }
    if request.rows.is_empty() {
        return Err("rows are required".to_string());
    }

    let primary_key_set = actual_primary_key_columns
        .iter()
        .cloned()
        .collect::<BTreeSet<_>>();
    let mut rows = Vec::with_capacity(request.rows.len());
    for row in request.rows {
        if row.changes.is_empty() {
            return Err("row changes are required".to_string());
        }
        for key in row.changes.keys() {
            if primary_key_set.contains(key) {
                return Err(format!("primary key column cannot be updated: {key}"));
            }
        }
        for key in actual_primary_key_columns {
            if !row.primary_key_values.contains_key(key) {
                return Err(format!("primary key value is required: {key}"));
            }
        }
        rows.push(NormalizedTableUpdateRow {
            primary_key_values: row.primary_key_values,
            changes: row.changes,
        });
    }

    Ok(NormalizedTableUpdateRequest {
        connection_id: request.connection_id,
        database: database.to_string(),
        table: table.to_string(),
        primary_key_columns: actual_primary_key_columns.to_vec(),
        rows,
    })
}

pub fn build_table_update_queries(
    kind: &str,
    request: &NormalizedTableUpdateRequest,
) -> Result<Vec<TableUpdateQuery>, String> {
    let table = table_identifier(kind, &request.database, &request.table)?;
    request
        .rows
        .iter()
        .map(|row| {
            let mut values = Vec::new();
            let mut parameter_index = 1;
            let mut set_parts = Vec::new();
            for (column, value) in &row.changes {
                let placeholder = parameter_placeholder(kind, parameter_index)?;
                parameter_index += 1;
                set_parts.push(format!(
                    "{} = {placeholder}",
                    quote_identifier(kind, column)?
                ));
                values.push(value.clone());
            }
            let mut where_parts = Vec::new();
            for column in &request.primary_key_columns {
                let placeholder = parameter_placeholder(kind, parameter_index)?;
                parameter_index += 1;
                where_parts.push(format!(
                    "{} = {placeholder}",
                    quote_identifier(kind, column)?
                ));
                values.push(row.primary_key_values[column].clone());
            }
            Ok(TableUpdateQuery {
                sql: format!(
                    "UPDATE {table} SET {} WHERE {}",
                    set_parts.join(", "),
                    where_parts.join(" AND ")
                ),
                values,
            })
        })
        .collect()
}

fn table_identifier(kind: &str, database: &str, table: &str) -> Result<String, String> {
    match kind {
        "mysql" => quote_identifier(kind, table),
        "postgresql" => Ok(format!(
            "{}.{}",
            quote_identifier(kind, database)?,
            quote_identifier(kind, table)?
        )),
        kind => Err(format!("unsupported database connection kind: {kind}")),
    }
}

fn parameter_placeholder(kind: &str, index: usize) -> Result<String, String> {
    match kind {
        "mysql" => Ok("?".to_string()),
        "postgresql" => Ok(format!("${index}")),
        kind => Err(format!("unsupported database connection kind: {kind}")),
    }
}

fn table_page_table_identifier(
    kind: &str,
    request: &NormalizedTablePageRequest,
) -> Result<String, String> {
    match kind {
        "mysql" => quote_identifier(kind, &request.table),
        "postgresql" => Ok(format!(
            "{}.{}",
            quote_identifier(kind, &request.database)?,
            quote_identifier(kind, &request.table)?
        )),
        kind => Err(format!("unsupported database connection kind: {kind}")),
    }
}

pub async fn load_database_table_page(
    _manager: &DatabaseConnectionManager,
    connection: &DatabaseConnectionSettings,
    request: &LoadDatabaseTablePageRequest,
) -> Result<DatabaseTablePageResult, String> {
    let normalized = normalize_table_page_request(request.clone())?;
    let queries = build_table_page_queries(&connection.kind, &normalized)?;

    match connection.kind.as_str() {
        "mysql" => load_mysql_table_page(connection, &normalized, &queries).await,
        "postgresql" => load_postgresql_table_page(connection, &normalized, &queries).await,
        kind => Err(format!("unsupported database connection kind: {kind}")),
    }
}

pub async fn update_database_table_rows(
    _manager: &DatabaseConnectionManager,
    connection: &DatabaseConnectionSettings,
    request: &UpdateDatabaseTableRowsRequest,
) -> Result<DatabaseTableUpdateResult, String> {
    match connection.kind.as_str() {
        "mysql" => update_mysql_table_rows(connection, request).await,
        "postgresql" => update_postgresql_table_rows(connection, request).await,
        kind => Err(format!("unsupported database connection kind: {kind}")),
    }
}

async fn load_mysql_table_page(
    connection: &DatabaseConnectionSettings,
    request: &NormalizedTablePageRequest,
    queries: &TablePageQueries,
) -> Result<DatabaseTablePageResult, String> {
    let url = database_connection_url(&DatabaseConnectionSettings {
        database: Some(request.database.clone()),
        ..connection.clone()
    })?;
    let mut connection = MySqlConnection::connect(&url)
        .await
        .map_err(|error| error.to_string())?;
    let started_at = Instant::now();
    let count_row = sqlx::query(&queries.count_sql)
        .fetch_one(&mut connection)
        .await
        .map_err(|error| error.to_string())?;
    let total_rows = mysql_count_value(&count_row, "total")?;
    let primary_key_columns =
        load_mysql_primary_key_columns(&mut connection, &request.database, &request.table).await?;
    let editable = !primary_key_columns.is_empty();
    let rows = sqlx::query(&queries.page_sql)
        .fetch_all(&mut connection)
        .await
        .map_err(|error| error.to_string())?;
    let result = rows_to_mysql_result(rows, started_at.elapsed().as_millis(), false);
    connection
        .close()
        .await
        .map_err(|error| error.to_string())?;
    Ok(DatabaseTablePageResult {
        columns: result.columns,
        rows: result.rows,
        total_rows,
        page: request.page,
        page_size: request.page_size,
        duration_ms: started_at.elapsed().as_millis(),
        primary_key_columns,
        editable,
    })
}

async fn load_postgresql_table_page(
    connection: &DatabaseConnectionSettings,
    request: &NormalizedTablePageRequest,
    queries: &TablePageQueries,
) -> Result<DatabaseTablePageResult, String> {
    let url = database_connection_url(connection)?;
    let mut connection = PgConnection::connect(&url)
        .await
        .map_err(|error| error.to_string())?;
    let started_at = Instant::now();
    let count_row = sqlx::query(&queries.count_sql)
        .fetch_one(&mut connection)
        .await
        .map_err(|error| error.to_string())?;
    let total_rows = postgresql_count_value(&count_row, "total")?;
    let primary_key_columns =
        load_postgresql_primary_key_columns(&mut connection, &request.database, &request.table)
            .await?;
    let editable = !primary_key_columns.is_empty();
    let rows = sqlx::query(&queries.page_sql)
        .fetch_all(&mut connection)
        .await
        .map_err(|error| error.to_string())?;
    let result = rows_to_postgresql_result(rows, started_at.elapsed().as_millis(), false);
    connection
        .close()
        .await
        .map_err(|error| error.to_string())?;
    Ok(DatabaseTablePageResult {
        columns: result.columns,
        rows: result.rows,
        total_rows,
        page: request.page,
        page_size: request.page_size,
        duration_ms: started_at.elapsed().as_millis(),
        primary_key_columns,
        editable,
    })
}

async fn load_mysql_primary_key_columns(
    connection: &mut MySqlConnection,
    database: &str,
    table: &str,
) -> Result<Vec<String>, String> {
    let query = primary_key_query_for_table("mysql", database, table)?;
    let rows = sqlx::query(&query.sql)
        .bind(&query.binds[0])
        .bind(&query.binds[1])
        .fetch_all(connection)
        .await
        .map_err(|error| error.to_string())?;
    Ok(rows.into_iter().map(|row| row.get("column_name")).collect())
}

async fn load_postgresql_primary_key_columns(
    connection: &mut PgConnection,
    database: &str,
    table: &str,
) -> Result<Vec<String>, String> {
    let query = primary_key_query_for_table("postgresql", database, table)?;
    let rows = sqlx::query(&query.sql)
        .bind(&query.binds[0])
        .bind(&query.binds[1])
        .fetch_all(connection)
        .await
        .map_err(|error| error.to_string())?;
    Ok(rows.into_iter().map(|row| row.get("column_name")).collect())
}

async fn update_mysql_table_rows(
    connection: &DatabaseConnectionSettings,
    request: &UpdateDatabaseTableRowsRequest,
) -> Result<DatabaseTableUpdateResult, String> {
    let url = database_connection_url(&DatabaseConnectionSettings {
        database: Some(request.database.clone()),
        ..connection.clone()
    })?;
    let mut connection = MySqlConnection::connect(&url)
        .await
        .map_err(|error| error.to_string())?;
    let primary_key_columns =
        load_mysql_primary_key_columns(&mut connection, &request.database, &request.table).await?;
    let normalized = normalize_table_update_request(request.clone(), &primary_key_columns)?;
    let queries = build_table_update_queries("mysql", &normalized)?;
    let started_at = Instant::now();
    let mut updated_rows = 0;
    let mut updated_fields = 0;

    for (row, query) in normalized.rows.iter().zip(queries) {
        let mut sql = sqlx::query(&query.sql);
        for value in &query.values {
            sql = bind_mysql_value(sql, value);
        }
        let result = sql
            .execute(&mut connection)
            .await
            .map_err(|error| error.to_string())?;
        if result.rows_affected() != 1 {
            return Err(format!(
                "expected to update 1 row, updated {}",
                result.rows_affected()
            ));
        }
        updated_rows += 1;
        updated_fields += row.changes.len() as u64;
    }

    connection
        .close()
        .await
        .map_err(|error| error.to_string())?;
    Ok(DatabaseTableUpdateResult {
        updated_rows,
        updated_fields,
        duration_ms: started_at.elapsed().as_millis(),
    })
}

async fn update_postgresql_table_rows(
    connection: &DatabaseConnectionSettings,
    request: &UpdateDatabaseTableRowsRequest,
) -> Result<DatabaseTableUpdateResult, String> {
    let url = database_connection_url(connection)?;
    let mut connection = PgConnection::connect(&url)
        .await
        .map_err(|error| error.to_string())?;
    let primary_key_columns =
        load_postgresql_primary_key_columns(&mut connection, &request.database, &request.table)
            .await?;
    let normalized = normalize_table_update_request(request.clone(), &primary_key_columns)?;
    let queries = build_table_update_queries("postgresql", &normalized)?;
    let started_at = Instant::now();
    let mut updated_rows = 0;
    let mut updated_fields = 0;

    for (row, query) in normalized.rows.iter().zip(queries) {
        let mut sql = sqlx::query(&query.sql);
        for value in &query.values {
            sql = bind_postgresql_value(sql, value);
        }
        let result = sql
            .execute(&mut connection)
            .await
            .map_err(|error| error.to_string())?;
        if result.rows_affected() != 1 {
            return Err(format!(
                "expected to update 1 row, updated {}",
                result.rows_affected()
            ));
        }
        updated_rows += 1;
        updated_fields += row.changes.len() as u64;
    }

    connection
        .close()
        .await
        .map_err(|error| error.to_string())?;
    Ok(DatabaseTableUpdateResult {
        updated_rows,
        updated_fields,
        duration_ms: started_at.elapsed().as_millis(),
    })
}

fn bind_mysql_value<'q>(
    query: sqlx::query::Query<'q, MySql, MySqlArguments>,
    value: &'q DatabaseCellValue,
) -> sqlx::query::Query<'q, MySql, MySqlArguments> {
    match value {
        DatabaseCellValue::Null => query.bind(Option::<String>::None),
        DatabaseCellValue::Text { value } | DatabaseCellValue::Number { value } => {
            query.bind(value)
        }
        DatabaseCellValue::Bool { value } => query.bind(*value),
    }
}

fn bind_postgresql_value<'q>(
    query: sqlx::query::Query<'q, Postgres, PgArguments>,
    value: &'q DatabaseCellValue,
) -> sqlx::query::Query<'q, Postgres, PgArguments> {
    match value {
        DatabaseCellValue::Null => query.bind(Option::<String>::None),
        DatabaseCellValue::Text { value } | DatabaseCellValue::Number { value } => {
            query.bind(value)
        }
        DatabaseCellValue::Bool { value } => query.bind(*value),
    }
}

fn mysql_count_value(row: &MySqlRow, column_name: &str) -> Result<u64, String> {
    if let Ok(value) = row.try_get::<u64, _>(column_name) {
        return Ok(value);
    }
    if let Ok(value) = row.try_get::<i64, _>(column_name) {
        return u64::try_from(value).map_err(|error| error.to_string());
    }
    Err("failed to decode table row count".to_string())
}

fn postgresql_count_value(row: &PgRow, column_name: &str) -> Result<u64, String> {
    if let Ok(value) = row.try_get::<i64, _>(column_name) {
        return u64::try_from(value).map_err(|error| error.to_string());
    }
    Err("failed to decode table row count".to_string())
}

async fn execute_mysql_query(
    connection: &DatabaseConnectionSettings,
    sql: &str,
    is_select: bool,
    limited: bool,
) -> Result<DatabaseQueryResult, String> {
    let url = database_connection_url(connection)?;
    let mut connection = MySqlConnection::connect(&url)
        .await
        .map_err(|error| error.to_string())?;
    let started_at = Instant::now();
    let result = if is_select {
        let rows = sqlx::query(sql)
            .fetch_all(&mut connection)
            .await
            .map_err(|error| error.to_string())?;
        rows_to_mysql_result(rows, started_at.elapsed().as_millis(), limited)
    } else {
        let result = sqlx::query(sql)
            .execute(&mut connection)
            .await
            .map_err(|error| error.to_string())?;
        DatabaseQueryResult {
            columns: Vec::new(),
            rows: Vec::new(),
            affected_rows: result.rows_affected(),
            duration_ms: started_at.elapsed().as_millis(),
            limited: false,
        }
    };
    connection
        .close()
        .await
        .map_err(|error| error.to_string())?;
    Ok(result)
}

async fn execute_postgresql_query(
    connection: &DatabaseConnectionSettings,
    sql: &str,
    is_select: bool,
    limited: bool,
) -> Result<DatabaseQueryResult, String> {
    let url = database_connection_url(connection)?;
    let mut connection = PgConnection::connect(&url)
        .await
        .map_err(|error| error.to_string())?;
    let started_at = Instant::now();
    let result = if is_select {
        let rows = sqlx::query(sql)
            .fetch_all(&mut connection)
            .await
            .map_err(|error| error.to_string())?;
        rows_to_postgresql_result(rows, started_at.elapsed().as_millis(), limited)
    } else {
        let result = sqlx::query(sql)
            .execute(&mut connection)
            .await
            .map_err(|error| error.to_string())?;
        DatabaseQueryResult {
            columns: Vec::new(),
            rows: Vec::new(),
            affected_rows: result.rows_affected(),
            duration_ms: started_at.elapsed().as_millis(),
            limited: false,
        }
    };
    connection
        .close()
        .await
        .map_err(|error| error.to_string())?;
    Ok(result)
}

fn rows_to_mysql_result(
    rows: Vec<MySqlRow>,
    duration_ms: u128,
    limited: bool,
) -> DatabaseQueryResult {
    let columns = rows
        .first()
        .map(|row| {
            row.columns()
                .iter()
                .map(|column| DatabaseResultColumn {
                    name: column.name().to_string(),
                    data_type: column.type_info().name().to_string(),
                })
                .collect()
        })
        .unwrap_or_default();
    let result_rows = rows
        .iter()
        .map(|row| {
            row.columns()
                .iter()
                .map(|column| mysql_cell_value(row, column.name(), column.type_info().name()))
                .collect()
        })
        .collect::<Vec<_>>();

    DatabaseQueryResult {
        columns,
        rows: result_rows,
        affected_rows: 0,
        duration_ms,
        limited,
    }
}

fn rows_to_postgresql_result(
    rows: Vec<PgRow>,
    duration_ms: u128,
    limited: bool,
) -> DatabaseQueryResult {
    let columns = rows
        .first()
        .map(|row| {
            row.columns()
                .iter()
                .map(|column| DatabaseResultColumn {
                    name: column.name().to_string(),
                    data_type: column.type_info().name().to_string(),
                })
                .collect()
        })
        .unwrap_or_default();
    let result_rows = rows
        .iter()
        .map(|row| {
            row.columns()
                .iter()
                .map(|column| postgresql_cell_value(row, column.name()))
                .collect()
        })
        .collect::<Vec<_>>();

    DatabaseQueryResult {
        columns,
        rows: result_rows,
        affected_rows: 0,
        duration_ms,
        limited,
    }
}

fn mysql_cell_value(row: &MySqlRow, column_name: &str, type_name: &str) -> DatabaseCellValue {
    if let Ok(value_ref) = row.try_get_raw(column_name) {
        if value_ref.is_null() {
            return DatabaseCellValue::Null;
        }
    }

    if mysql_prefers_bool_decode(type_name) {
        if let Ok(value) = row.try_get::<bool, _>(column_name) {
            return DatabaseCellValue::Bool { value };
        }
    }
    if mysql_prefers_numeric_decode(type_name) {
        if let Some(value) = mysql_number_cell_value(row, column_name) {
            return value;
        }
    }
    if let Ok(value) = row.try_get::<String, _>(column_name) {
        return DatabaseCellValue::Text { value };
    }
    if let Some(value) = mysql_number_cell_value(row, column_name) {
        return value;
    }
    if let Ok(value) = row.try_get::<bool, _>(column_name) {
        return DatabaseCellValue::Bool { value };
    }
    DatabaseCellValue::Text {
        value: "<unsupported>".to_string(),
    }
}

fn mysql_number_cell_value(row: &MySqlRow, column_name: &str) -> Option<DatabaseCellValue> {
    if let Ok(value) = row.try_get::<i64, _>(column_name) {
        return Some(DatabaseCellValue::Number {
            value: value.to_string(),
        });
    }
    if let Ok(value) = row.try_get::<u64, _>(column_name) {
        return Some(DatabaseCellValue::Number {
            value: value.to_string(),
        });
    }
    if let Ok(value) = row.try_get::<f64, _>(column_name) {
        return Some(DatabaseCellValue::Number {
            value: value.to_string(),
        });
    }
    None
}

pub(crate) fn mysql_prefers_numeric_decode(type_name: &str) -> bool {
    matches!(
        type_name.to_ascii_uppercase().as_str(),
        "TINYINT"
            | "SMALLINT"
            | "MEDIUMINT"
            | "INT"
            | "INTEGER"
            | "BIGINT"
            | "FLOAT"
            | "DOUBLE"
            | "REAL"
            | "DECIMAL"
            | "NUMERIC"
            | "YEAR"
    )
}

fn mysql_prefers_bool_decode(type_name: &str) -> bool {
    matches!(type_name.to_ascii_uppercase().as_str(), "BOOL" | "BOOLEAN")
}

fn postgresql_cell_value(row: &PgRow, column_name: &str) -> DatabaseCellValue {
    if let Ok(value_ref) = row.try_get_raw(column_name) {
        if value_ref.is_null() {
            return DatabaseCellValue::Null;
        }
    }
    if let Ok(value) = row.try_get::<bool, _>(column_name) {
        return DatabaseCellValue::Bool { value };
    }
    if let Ok(value) = row.try_get::<i64, _>(column_name) {
        return DatabaseCellValue::Number {
            value: value.to_string(),
        };
    }
    if let Ok(value) = row.try_get::<f64, _>(column_name) {
        return DatabaseCellValue::Number {
            value: value.to_string(),
        };
    }
    if let Ok(value) = row.try_get::<String, _>(column_name) {
        return DatabaseCellValue::Text { value };
    }
    DatabaseCellValue::Text {
        value: "<unsupported>".to_string(),
    }
}

fn contains_limit_clause(sql: &str) -> bool {
    sql.split(|character: char| !character.is_ascii_alphanumeric() && character != '_')
        .any(|token| token.eq_ignore_ascii_case("limit"))
}

fn first_sql_keyword(sql: &str) -> Option<&str> {
    let mut remaining = sql.trim_start();
    loop {
        if remaining.starts_with("--") {
            let Some(newline_index) = remaining.find('\n') else {
                return None;
            };
            remaining = remaining[newline_index + 1..].trim_start();
            continue;
        }
        if remaining.starts_with("/*") {
            let Some(end_index) = remaining.find("*/") else {
                return None;
            };
            remaining = remaining[end_index + 2..].trim_start();
            continue;
        }
        return remaining
            .split(|character: char| !character.is_ascii_alphabetic())
            .find(|token| !token.is_empty());
    }
}
