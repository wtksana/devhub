use std::time::Instant;

use sqlx::mysql::MySqlRow;
use sqlx::postgres::PgRow;
use sqlx::{Column, Connection, MySqlConnection, PgConnection, Row, TypeInfo, ValueRef};

use crate::db::connection::database_connection_url;
use crate::db::connection::DatabaseConnectionManager;
use crate::models::database::{
    DatabaseCellValue, DatabaseQueryResult, DatabaseResultColumn, DatabaseTablePageResult,
    ExecuteDatabaseQueryRequest, LoadDatabaseTablePageRequest,
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
    })
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
