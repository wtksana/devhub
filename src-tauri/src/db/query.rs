use std::collections::{BTreeMap, BTreeSet};
use std::time::Instant;

use sqlx::mysql::{MySqlArguments, MySqlRow};
use sqlx::postgres::{PgArguments, PgRow};
use sqlx::types::chrono::{DateTime, FixedOffset, NaiveDate, NaiveDateTime, NaiveTime, Utc};
use sqlx::types::BigDecimal;
use sqlx::{Column, MySql, MySqlConnection, PgConnection, Postgres, Row, TypeInfo, ValueRef};

use crate::db::connection::{DatabaseConnectionManager, DatabasePool};
use crate::db::metadata::MetadataQuery;
use crate::models::database::{
    DatabaseCellValue, DatabaseQueryResult, DatabaseResultColumn, DatabaseTableDdlResult,
    DatabaseTablePageResult, DatabaseTableStructureUpdateResult, DatabaseTableUpdateResult,
    DeleteDatabaseTableRowsRequest, ExecuteDatabaseQueryRequest, GetDatabaseTableDdlRequest,
    InsertDatabaseTableRowsRequest, LoadDatabaseTablePageRequest, TableStructureColumnDefinition,
    TableStructureColumnPosition, TableStructureOperation, UpdateDatabaseTableRowsRequest,
    UpdateDatabaseTableStructureRequest,
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
    pub order_by: Option<String>,
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
pub struct NormalizedTableInsertRequest {
    pub connection_id: String,
    pub database: String,
    pub table: String,
    pub rows: Vec<NormalizedTableInsertRow>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct NormalizedTableInsertRow {
    pub values: BTreeMap<String, DatabaseCellValue>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct NormalizedTableDeleteRequest {
    pub connection_id: String,
    pub database: String,
    pub table: String,
    pub primary_key_columns: Vec<String>,
    pub rows: Vec<NormalizedTableDeleteRow>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct NormalizedTableDeleteRow {
    pub primary_key_values: BTreeMap<String, DatabaseCellValue>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct TableUpdateQuery {
    pub sql: String,
    pub values: Vec<DatabaseCellValue>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct MysqlColumnMetadata {
    column: DatabaseResultColumn,
}

pub async fn execute_database_query(
    manager: &DatabaseConnectionManager,
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
        "mysql" => {
            let database = request.database.as_deref();
            let DatabasePool::Mysql(pool) = manager.pool(connection, database).await? else {
                return Err("database pool kind mismatch".to_string());
            };
            execute_mysql_query(&pool, &sql, is_select, limited).await
        }
        "postgresql" => {
            let DatabasePool::Postgresql(pool) = manager.pool(connection, None).await? else {
                return Err("database pool kind mismatch".to_string());
            };
            execute_postgresql_query(&pool, &sql, is_select, limited).await
        }
        kind => Err(format!("unsupported database connection kind: {kind}")),
    }
}

pub async fn execute_database_statement(
    manager: &DatabaseConnectionManager,
    connection: &DatabaseConnectionSettings,
    database: &str,
    sql: &str,
) -> Result<u64, String> {
    let normalized_sql = sql.trim();
    if normalized_sql.is_empty() {
        return Ok(0);
    }

    match connection.kind.as_str() {
        "mysql" => {
            let DatabasePool::Mysql(pool) = manager.pool(connection, Some(database)).await? else {
                return Err("database pool kind mismatch".to_string());
            };
            let mut connection = pool.acquire().await.map_err(|error| error.to_string())?;
            sqlx::query(normalized_sql)
                .execute(&mut *connection)
                .await
                .map(|result| result.rows_affected())
                .map_err(|error| error.to_string())
        }
        "postgresql" => {
            let DatabasePool::Postgresql(pool) = manager.pool(connection, None).await? else {
                return Err("database pool kind mismatch".to_string());
            };
            let mut connection = pool.acquire().await.map_err(|error| error.to_string())?;
            sqlx::query(normalized_sql)
                .execute(&mut *connection)
                .await
                .map(|result| result.rows_affected())
                .map_err(|error| error.to_string())
        }
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

pub fn mysql_table_ddl_query(table: &str) -> Result<String, String> {
    Ok(format!(
        "SHOW CREATE TABLE {}",
        quote_identifier("mysql", table)?
    ))
}

pub fn mysql_table_column_metadata_query(database: &str, table: &str) -> Result<MetadataQuery, String> {
    Ok(MetadataQuery {
        sql: "select column_name, data_type, is_nullable, column_default, extra from information_schema.columns where table_schema = ? and table_name = ? order by ordinal_position".to_string(),
        binds: vec![database.to_string(), table.to_string()],
    })
}

pub fn mysql_table_ddl_from_values(
    indexed_value: Result<String, String>,
    named_value: Result<String, String>,
) -> Result<String, String> {
    indexed_value.or(named_value)
}

pub fn build_table_structure_ddl(
    kind: &str,
    table: &str,
    operations: &[TableStructureOperation],
) -> Result<String, String> {
    if operations.is_empty() {
        return Err("no table structure changes".to_string());
    }
    match kind {
        "mysql" => build_mysql_table_structure_ddl(table, operations),
        "postgresql" => Err("postgresql table structure editing is not supported yet".to_string()),
        kind => Err(format!("unsupported database connection kind: {kind}")),
    }
}

fn build_mysql_table_structure_ddl(
    table: &str,
    operations: &[TableStructureOperation],
) -> Result<String, String> {
    let mut current_table = table.trim().to_string();
    let mut statements = Vec::new();
    let mut column_operations = Vec::new();
    let mut index_operations = Vec::new();

    for operation in operations {
        match operation {
            TableStructureOperation::RenameTable { new_name } => {
                let new_name = new_name.trim();
                if new_name.is_empty() {
                    return Err("new table name is required".to_string());
                }
                statements.push(format!(
                    "RENAME TABLE {} TO {};",
                    quote_identifier("mysql", &current_table)?,
                    quote_identifier("mysql", new_name)?
                ));
                current_table = new_name.to_string();
            }
            TableStructureOperation::AddColumn { column } => column_operations.push(format!(
                "ADD COLUMN {}{}",
                mysql_column_definition(column)?,
                mysql_column_position_clause(column)?
            )),
            TableStructureOperation::ModifyColumn {
                original_name,
                column,
            } => {
                let original = original_name.trim();
                if original.is_empty() {
                    return Err("original column name is required".to_string());
                }
                column_operations.push(format!(
                    "CHANGE COLUMN {} {}{}",
                    quote_identifier("mysql", original)?,
                    mysql_column_definition(column)?,
                    mysql_column_position_clause(column)?
                ));
            }
            TableStructureOperation::DropColumn { name } => {
                let name = name.trim();
                if name.is_empty() {
                    return Err("column name is required".to_string());
                }
                column_operations.push(format!(
                    "DROP COLUMN {}",
                    quote_identifier("mysql", name)?
                ));
            }
            TableStructureOperation::AddIndex { index } => {
                index_operations.push(mysql_add_index_clause(index)?);
            }
            TableStructureOperation::DropIndex { name } => {
                let name = name.trim();
                if name.is_empty() {
                    return Err("index name is required".to_string());
                }
                index_operations.push(format!("DROP INDEX {}", quote_identifier("mysql", name)?));
            }
        }
    }

    column_operations.extend(index_operations);
    if !column_operations.is_empty() {
        statements.push(format!(
            "ALTER TABLE {}\n  {};",
            quote_identifier("mysql", &current_table)?,
            column_operations.join(",\n  ")
        ));
    }

    if statements.is_empty() {
        return Err("no table structure changes".to_string());
    }
    Ok(statements.join("\n"))
}

fn mysql_add_index_clause(index: &crate::models::database::TableStructureIndexDefinition) -> Result<String, String> {
    let name = index.name.trim();
    if name.is_empty() {
        return Err("index name is required".to_string());
    }
    let columns = index
        .columns
        .iter()
        .map(|column| column.trim())
        .filter(|column| !column.is_empty())
        .map(|column| quote_identifier("mysql", column))
        .collect::<Result<Vec<String>, String>>()?;
    if columns.is_empty() {
        return Err("index columns are required".to_string());
    }
    Ok(format!(
        "ADD {}INDEX {} ({})",
        if index.unique { "UNIQUE " } else { "" },
        quote_identifier("mysql", name)?,
        columns.join(", ")
    ))
}

fn mysql_column_definition(column: &TableStructureColumnDefinition) -> Result<String, String> {
    let name = column.name.trim();
    if name.is_empty() {
        return Err("column name is required".to_string());
    }
    let data_type = column.data_type.trim();
    if data_type.is_empty() {
        return Err("column type is required".to_string());
    }
    let mut definition = format!(
        "{} {} {}",
        quote_identifier("mysql", name)?,
        data_type,
        if column.nullable { "NULL" } else { "NOT NULL" }
    );
    if let Some(default_value) = mysql_column_default_clause(column) {
        definition.push_str(&default_value);
    }
    if let Some(extra) = column.extra.as_deref().map(str::trim).filter(|value| !value.is_empty()) {
        definition.push(' ');
        definition.push_str(&extra.to_ascii_uppercase());
    }
    if let Some(comment) = column.comment.as_deref().map(str::trim).filter(|value| !value.is_empty()) {
        definition.push_str(" COMMENT ");
        definition.push_str(&mysql_string_literal(comment));
    }
    Ok(definition)
}

fn mysql_column_position_clause(column: &TableStructureColumnDefinition) -> Result<String, String> {
    match &column.position {
        None => Ok(String::new()),
        Some(TableStructureColumnPosition::First) => Ok(" FIRST".to_string()),
        Some(TableStructureColumnPosition::After { column }) => {
            let column = column.trim();
            if column.is_empty() {
                return Err("column position target is required".to_string());
            }
            Ok(format!(" AFTER {}", quote_identifier("mysql", column)?))
        }
    }
}

fn mysql_column_default_clause(column: &TableStructureColumnDefinition) -> Option<String> {
    let default_value = column.default_value.as_deref()?.trim();
    if default_value.is_empty() {
        return None;
    }
    if default_value.eq_ignore_ascii_case("null") {
        return Some(" DEFAULT NULL".to_string());
    }
    if is_mysql_default_expression(default_value) {
        return Some(format!(" DEFAULT {default_value}"));
    }
    if is_mysql_quoted_string_literal(default_value) {
        return Some(format!(" DEFAULT {default_value}"));
    }
    Some(format!(" DEFAULT {}", mysql_string_literal(default_value)))
}

fn is_mysql_quoted_string_literal(value: &str) -> bool {
    if value.len() < 2 || !value.starts_with('\'') || !value.ends_with('\'') {
        return false;
    }
    let mut chars = value[1..value.len() - 1].chars().peekable();
    while let Some(current) = chars.next() {
        if current == '\'' && chars.next() != Some('\'') {
            return false;
        }
    }
    true
}

fn is_mysql_default_expression(value: &str) -> bool {
    let upper = value.to_ascii_uppercase();
    matches!(
        upper.as_str(),
        "CURRENT_TIMESTAMP" | "CURRENT_TIMESTAMP()" | "CURRENT_DATE" | "CURRENT_DATE()" | "CURRENT_TIME" | "CURRENT_TIME()"
    ) || value.parse::<i64>().is_ok()
        || value.parse::<f64>().is_ok()
}

fn mysql_string_literal(value: &str) -> String {
    format!("'{}'", value.replace('\\', "\\\\").replace('\'', "''"))
}

pub fn postgresql_table_ddl_query(schema: &str, table: &str) -> Result<MetadataQuery, String> {
    Ok(MetadataQuery {
        sql: format!(
            "select format(
                'create table {}.%s (' || chr(10) || %s || chr(10) || ');',
                quote_ident(c.table_name),
                string_agg(
                    format('  %s %s%s',
                        quote_ident(c.column_name),
                        c.data_type,
                        case when c.is_nullable = 'NO' then ' not null' else '' end
                    ),
                    ',' || chr(10)
                    order by c.ordinal_position
                )
            ) as ddl
            from information_schema.columns c
            where c.table_schema = $1 and c.table_name = $2
            group by c.table_name",
            quote_identifier("postgresql", schema)?,
        ),
        binds: vec![schema.to_string(), table.to_string()],
    })
}

pub fn postgresql_index_query_for_table(schema: &str, table: &str) -> Result<MetadataQuery, String> {
    Ok(MetadataQuery {
        sql: "select indexdef from pg_indexes where schemaname = $1 and tablename = $2 order by indexname".to_string(),
        binds: vec![schema.to_string(), table.to_string()],
    })
}

pub fn append_postgresql_indexes_to_ddl(ddl: &str, indexes: Vec<String>) -> String {
    let mut script = ddl.trim_end_matches(';').trim_end().to_string();
    script.push(';');
    if !indexes.is_empty() {
        script.push_str("\n\n");
    }
    for (index_position, index) in indexes.into_iter().enumerate() {
        if index_position > 0 {
            script.push('\n');
        }
        script.push_str(index.trim_end_matches(';').trim_end());
        script.push(';');
    }
    script
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
        order_by: request
            .order_by
            .map(|order_by| order_by.trim().to_string())
            .filter(|order_by| !order_by.is_empty()),
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
    let order_clause = if let Some(order_by) = &request.order_by {
        format!(" ORDER BY {order_by}")
    } else {
        match (&request.sort_column, &request.sort_direction) {
            (Some(column), Some(direction)) => {
                let column = quote_identifier(kind, column)?;
                format!(" ORDER BY {column} {}", direction.to_ascii_uppercase())
            }
            _ => String::new(),
        }
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

pub fn normalize_table_insert_request(
    request: InsertDatabaseTableRowsRequest,
) -> Result<NormalizedTableInsertRequest, String> {
    let database = request.database.trim();
    if database.is_empty() {
        return Err("database is required".to_string());
    }
    let table = request.table.trim();
    if table.is_empty() {
        return Err("table is required".to_string());
    }
    if request.rows.is_empty() {
        return Err("rows are required".to_string());
    }
    let mut rows = Vec::with_capacity(request.rows.len());
    for row in request.rows {
        rows.push(NormalizedTableInsertRow { values: row.values });
    }

    Ok(NormalizedTableInsertRequest {
        connection_id: request.connection_id,
        database: database.to_string(),
        table: table.to_string(),
        rows,
    })
}

pub fn build_table_insert_queries(
    kind: &str,
    request: &NormalizedTableInsertRequest,
) -> Result<Vec<TableUpdateQuery>, String> {
    let table = table_identifier(kind, &request.database, &request.table)?;
    request
        .rows
        .iter()
        .map(|row| {
            if row.values.is_empty() {
                return Ok(TableUpdateQuery {
                    sql: match kind {
                        "mysql" => format!("INSERT INTO {table} () VALUES ()"),
                        "postgresql" => format!("INSERT INTO {table} DEFAULT VALUES"),
                        kind => return Err(format!("unsupported database connection kind: {kind}")),
                    },
                    values: Vec::new(),
                });
            }
            let columns = row
                .values
                .keys()
                .map(|column| quote_identifier(kind, column))
                .collect::<Result<Vec<_>, _>>()?;
            let values = row.values.values().cloned().collect::<Vec<_>>();
            let placeholders = (1..=values.len())
                .map(|index| parameter_placeholder(kind, index))
                .collect::<Result<Vec<_>, _>>()?;
            Ok(TableUpdateQuery {
                sql: format!(
                    "INSERT INTO {table} ({}) VALUES ({})",
                    columns.join(", "),
                    placeholders.join(", ")
                ),
                values,
            })
        })
        .collect()
}

pub fn normalize_table_delete_request(
    request: DeleteDatabaseTableRowsRequest,
    actual_primary_key_columns: &[String],
) -> Result<NormalizedTableDeleteRequest, String> {
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
    let mut rows = Vec::with_capacity(request.rows.len());
    for row in request.rows {
        for key in actual_primary_key_columns {
            if !row.primary_key_values.contains_key(key) {
                return Err(format!("primary key value is required: {key}"));
            }
        }
        rows.push(NormalizedTableDeleteRow {
            primary_key_values: row.primary_key_values,
        });
    }

    Ok(NormalizedTableDeleteRequest {
        connection_id: request.connection_id,
        database: database.to_string(),
        table: table.to_string(),
        primary_key_columns: actual_primary_key_columns.to_vec(),
        rows,
    })
}

pub fn build_table_delete_queries(
    kind: &str,
    request: &NormalizedTableDeleteRequest,
) -> Result<Vec<TableUpdateQuery>, String> {
    let table = table_identifier(kind, &request.database, &request.table)?;
    request
        .rows
        .iter()
        .map(|row| {
            let mut values = Vec::new();
            let mut where_parts = Vec::new();
            for (index, column) in request.primary_key_columns.iter().enumerate() {
                where_parts.push(format!(
                    "{} = {}",
                    quote_identifier(kind, column)?,
                    parameter_placeholder(kind, index + 1)?
                ));
                values.push(row.primary_key_values[column].clone());
            }
            Ok(TableUpdateQuery {
                sql: format!("DELETE FROM {table} WHERE {}", where_parts.join(" AND ")),
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
    manager: &DatabaseConnectionManager,
    connection: &DatabaseConnectionSettings,
    request: &LoadDatabaseTablePageRequest,
) -> Result<DatabaseTablePageResult, String> {
    let normalized = normalize_table_page_request(request.clone())?;
    let queries = build_table_page_queries(&connection.kind, &normalized)?;

    match connection.kind.as_str() {
        "mysql" => {
            let DatabasePool::Mysql(pool) = manager.pool(connection, Some(&normalized.database)).await? else {
                return Err("database pool kind mismatch".to_string());
            };
            load_mysql_table_page(&pool, &normalized, &queries).await
        }
        "postgresql" => {
            let DatabasePool::Postgresql(pool) = manager.pool(connection, None).await? else {
                return Err("database pool kind mismatch".to_string());
            };
            load_postgresql_table_page(&pool, &normalized, &queries).await
        }
        kind => Err(format!("unsupported database connection kind: {kind}")),
    }
}

pub async fn update_database_table_rows(
    manager: &DatabaseConnectionManager,
    connection: &DatabaseConnectionSettings,
    request: &UpdateDatabaseTableRowsRequest,
) -> Result<DatabaseTableUpdateResult, String> {
    match connection.kind.as_str() {
        "mysql" => {
            let DatabasePool::Mysql(pool) = manager.pool(connection, Some(&request.database)).await? else {
                return Err("database pool kind mismatch".to_string());
            };
            update_mysql_table_rows(&pool, request).await
        }
        "postgresql" => {
            let DatabasePool::Postgresql(pool) = manager.pool(connection, None).await? else {
                return Err("database pool kind mismatch".to_string());
            };
            update_postgresql_table_rows(&pool, request).await
        }
        kind => Err(format!("unsupported database connection kind: {kind}")),
    }
}

pub async fn insert_database_table_rows(
    manager: &DatabaseConnectionManager,
    connection: &DatabaseConnectionSettings,
    request: &InsertDatabaseTableRowsRequest,
) -> Result<DatabaseTableUpdateResult, String> {
    match connection.kind.as_str() {
        "mysql" => {
            let DatabasePool::Mysql(pool) = manager.pool(connection, Some(&request.database)).await? else {
                return Err("database pool kind mismatch".to_string());
            };
            insert_mysql_table_rows(&pool, request).await
        }
        "postgresql" => Err("postgresql table insert is not supported yet".to_string()),
        kind => Err(format!("unsupported database connection kind: {kind}")),
    }
}

pub async fn delete_database_table_rows(
    manager: &DatabaseConnectionManager,
    connection: &DatabaseConnectionSettings,
    request: &DeleteDatabaseTableRowsRequest,
) -> Result<DatabaseTableUpdateResult, String> {
    match connection.kind.as_str() {
        "mysql" => {
            let DatabasePool::Mysql(pool) = manager.pool(connection, Some(&request.database)).await? else {
                return Err("database pool kind mismatch".to_string());
            };
            delete_mysql_table_rows(&pool, request).await
        }
        "postgresql" => Err("postgresql table delete is not supported yet".to_string()),
        kind => Err(format!("unsupported database connection kind: {kind}")),
    }
}

pub async fn get_database_table_ddl(
    manager: &DatabaseConnectionManager,
    connection: &DatabaseConnectionSettings,
    request: &GetDatabaseTableDdlRequest,
) -> Result<DatabaseTableDdlResult, String> {
    let database = request.database.trim();
    if database.is_empty() {
        return Err("database is required".to_string());
    }
    let table = request.table.trim();
    if table.is_empty() {
        return Err("table is required".to_string());
    }

    match connection.kind.as_str() {
        "mysql" => {
            let DatabasePool::Mysql(pool) = manager.pool(connection, Some(database)).await? else {
                return Err("database pool kind mismatch".to_string());
            };
            get_mysql_table_ddl(&pool, table).await
        }
        "postgresql" => {
            let DatabasePool::Postgresql(pool) = manager.pool(connection, None).await? else {
                return Err("database pool kind mismatch".to_string());
            };
            get_postgresql_table_ddl(&pool, database, table).await
        }
        kind => Err(format!("unsupported database connection kind: {kind}")),
    }
}

pub async fn preview_database_table_structure(
    connection: &DatabaseConnectionSettings,
    request: &UpdateDatabaseTableStructureRequest,
) -> Result<DatabaseTableStructureUpdateResult, String> {
    let started_at = Instant::now();
    let ddl = build_table_structure_ddl(&connection.kind, request.table.trim(), &request.operations)?;
    Ok(DatabaseTableStructureUpdateResult {
        ddl,
        duration_ms: started_at.elapsed().as_millis(),
    })
}

pub async fn update_database_table_structure(
    manager: &DatabaseConnectionManager,
    connection: &DatabaseConnectionSettings,
    request: &UpdateDatabaseTableStructureRequest,
) -> Result<DatabaseTableStructureUpdateResult, String> {
    let database = request.database.trim();
    if database.is_empty() {
        return Err("database is required".to_string());
    }
    let table = request.table.trim();
    if table.is_empty() {
        return Err("table is required".to_string());
    }
    let started_at = Instant::now();
    let ddl = build_table_structure_ddl(&connection.kind, table, &request.operations)?;
    match connection.kind.as_str() {
        "mysql" => {
            let DatabasePool::Mysql(pool) = manager.pool(connection, Some(database)).await? else {
                return Err("database pool kind mismatch".to_string());
            };
            let mut connection = pool.acquire().await.map_err(|error| error.to_string())?;
            sqlx::query(&ddl)
                .execute(&mut *connection)
                .await
                .map_err(|error| error.to_string())?;
        }
        "postgresql" => return Err("postgresql table structure editing is not supported yet".to_string()),
        kind => return Err(format!("unsupported database connection kind: {kind}")),
    }

    Ok(DatabaseTableStructureUpdateResult {
        ddl,
        duration_ms: started_at.elapsed().as_millis(),
    })
}

async fn get_mysql_table_ddl(
    pool: &sqlx::MySqlPool,
    table: &str,
) -> Result<DatabaseTableDdlResult, String> {
    let mut connection = pool.acquire().await.map_err(|error| error.to_string())?;
    let started_at = Instant::now();
    let row = sqlx::query(&mysql_table_ddl_query(table)?)
        .fetch_one(&mut *connection)
        .await
        .map_err(|error| error.to_string())?;
    let ddl = mysql_table_ddl_from_values(
        row.try_get::<String, _>(1)
            .map_err(|error| error.to_string()),
        row.try_get::<String, _>("Create Table")
            .map_err(|error| error.to_string()),
    )?;

    Ok(DatabaseTableDdlResult {
        ddl,
        duration_ms: started_at.elapsed().as_millis(),
    })
}

async fn get_postgresql_table_ddl(
    pool: &sqlx::PgPool,
    schema: &str,
    table: &str,
) -> Result<DatabaseTableDdlResult, String> {
    let mut connection = pool.acquire().await.map_err(|error| error.to_string())?;
    let started_at = Instant::now();
    let ddl_query = postgresql_table_ddl_query(schema, table)?;
    let ddl_row = sqlx::query(&ddl_query.sql)
        .bind(&ddl_query.binds[0])
        .bind(&ddl_query.binds[1])
        .fetch_one(&mut *connection)
        .await
        .map_err(|error| error.to_string())?;
    let ddl: String = ddl_row.try_get("ddl").map_err(|error| error.to_string())?;

    let index_query = postgresql_index_query_for_table(schema, table)?;
    let index_rows = sqlx::query(&index_query.sql)
        .bind(&index_query.binds[0])
        .bind(&index_query.binds[1])
        .fetch_all(&mut *connection)
        .await
        .map_err(|error| error.to_string())?;
    let indexes = index_rows
        .into_iter()
        .map(|row| row.try_get("indexdef").map_err(|error| error.to_string()))
        .collect::<Result<Vec<String>, String>>()?;

    Ok(DatabaseTableDdlResult {
        ddl: append_postgresql_indexes_to_ddl(&ddl, indexes),
        duration_ms: started_at.elapsed().as_millis(),
    })
}

async fn load_mysql_table_page(
    pool: &sqlx::MySqlPool,
    request: &NormalizedTablePageRequest,
    queries: &TablePageQueries,
) -> Result<DatabaseTablePageResult, String> {
    let mut connection = pool.acquire().await.map_err(|error| error.to_string())?;
    let started_at = Instant::now();
    let count_row = sqlx::query(&queries.count_sql)
        .fetch_one(&mut *connection)
        .await
        .map_err(|error| error.to_string())?;
    let total_rows = mysql_count_value(&count_row, "total")?;
    let primary_key_columns =
        load_mysql_primary_key_columns(&mut connection, &request.database, &request.table).await?;
    let editable = !primary_key_columns.is_empty();
    let column_metadata =
        load_mysql_table_column_metadata(&mut connection, &request.database, &request.table).await?;
    let rows = sqlx::query(&queries.page_sql)
        .fetch_all(&mut *connection)
        .await
        .map_err(|error| error.to_string())?;
    let result = rows_to_mysql_result(rows, started_at.elapsed().as_millis(), false);
    let columns = merge_mysql_result_columns(result.columns, column_metadata);
    Ok(DatabaseTablePageResult {
        columns,
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
    pool: &sqlx::PgPool,
    request: &NormalizedTablePageRequest,
    queries: &TablePageQueries,
) -> Result<DatabaseTablePageResult, String> {
    let mut connection = pool.acquire().await.map_err(|error| error.to_string())?;
    let started_at = Instant::now();
    let count_row = sqlx::query(&queries.count_sql)
        .fetch_one(&mut *connection)
        .await
        .map_err(|error| error.to_string())?;
    let total_rows = postgresql_count_value(&count_row, "total")?;
    let primary_key_columns =
        load_postgresql_primary_key_columns(&mut connection, &request.database, &request.table)
            .await?;
    let editable = !primary_key_columns.is_empty();
    let rows = sqlx::query(&queries.page_sql)
        .fetch_all(&mut *connection)
        .await
        .map_err(|error| error.to_string())?;
    let result = rows_to_postgresql_result(rows, started_at.elapsed().as_millis(), false);
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

async fn load_mysql_table_column_metadata(
    connection: &mut MySqlConnection,
    database: &str,
    table: &str,
) -> Result<Vec<MysqlColumnMetadata>, String> {
    let query = mysql_table_column_metadata_query(database, table)?;
    let rows = sqlx::query(&query.sql)
        .bind(&query.binds[0])
        .bind(&query.binds[1])
        .fetch_all(connection)
        .await
        .map_err(|error| error.to_string())?;
    Ok(rows
        .into_iter()
        .map(|row| {
            let extra = row
                .try_get::<String, _>("extra")
                .unwrap_or_default()
                .to_ascii_lowercase();
            MysqlColumnMetadata {
                column: DatabaseResultColumn {
                    name: row.get("column_name"),
                    data_type: row.get("data_type"),
                    nullable: Some(row.get::<String, _>("is_nullable").eq_ignore_ascii_case("YES")),
                    has_default: Some(row.try_get_raw("column_default").is_ok_and(|value| !value.is_null())),
                    generated: Some(extra.contains("auto_increment") || extra.contains("generated")),
                },
            }
        })
        .collect())
}

fn merge_mysql_result_columns(
    result_columns: Vec<DatabaseResultColumn>,
    metadata: Vec<MysqlColumnMetadata>,
) -> Vec<DatabaseResultColumn> {
    if result_columns.is_empty() {
        return metadata.into_iter().map(|metadata| metadata.column).collect();
    }
    let metadata_by_name = metadata
        .into_iter()
        .map(|metadata| (metadata.column.name.clone(), metadata.column))
        .collect::<BTreeMap<_, _>>();
    result_columns
        .into_iter()
        .map(|column| {
            metadata_by_name
                .get(&column.name)
                .cloned()
                .unwrap_or(column)
        })
        .collect()
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
    pool: &sqlx::MySqlPool,
    request: &UpdateDatabaseTableRowsRequest,
) -> Result<DatabaseTableUpdateResult, String> {
    let mut connection = pool.acquire().await.map_err(|error| error.to_string())?;
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
            .execute(&mut *connection)
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

    Ok(DatabaseTableUpdateResult {
        updated_rows,
        updated_fields,
        duration_ms: started_at.elapsed().as_millis(),
    })
}

async fn insert_mysql_table_rows(
    pool: &sqlx::MySqlPool,
    request: &InsertDatabaseTableRowsRequest,
) -> Result<DatabaseTableUpdateResult, String> {
    let mut connection = pool.acquire().await.map_err(|error| error.to_string())?;
    let normalized = normalize_table_insert_request(request.clone())?;
    let queries = build_table_insert_queries("mysql", &normalized)?;
    let started_at = Instant::now();
    let mut updated_rows = 0;
    let mut updated_fields = 0;

    for (row, query) in normalized.rows.iter().zip(queries) {
        let mut sql = sqlx::query(&query.sql);
        for value in &query.values {
            sql = bind_mysql_value(sql, value);
        }
        let result = sql
            .execute(&mut *connection)
            .await
            .map_err(|error| error.to_string())?;
        if result.rows_affected() != 1 {
            return Err(format!(
                "expected to insert 1 row, inserted {}",
                result.rows_affected()
            ));
        }
        updated_rows += 1;
        updated_fields += row.values.len() as u64;
    }

    Ok(DatabaseTableUpdateResult {
        updated_rows,
        updated_fields,
        duration_ms: started_at.elapsed().as_millis(),
    })
}

async fn delete_mysql_table_rows(
    pool: &sqlx::MySqlPool,
    request: &DeleteDatabaseTableRowsRequest,
) -> Result<DatabaseTableUpdateResult, String> {
    let mut connection = pool.acquire().await.map_err(|error| error.to_string())?;
    let primary_key_columns =
        load_mysql_primary_key_columns(&mut connection, &request.database, &request.table).await?;
    let normalized = normalize_table_delete_request(request.clone(), &primary_key_columns)?;
    let queries = build_table_delete_queries("mysql", &normalized)?;
    let started_at = Instant::now();
    let mut updated_rows = 0;

    for query in queries {
        let mut sql = sqlx::query(&query.sql);
        for value in &query.values {
            sql = bind_mysql_value(sql, value);
        }
        let result = sql
            .execute(&mut *connection)
            .await
            .map_err(|error| error.to_string())?;
        if result.rows_affected() != 1 {
            return Err(format!(
                "expected to delete 1 row, deleted {}",
                result.rows_affected()
            ));
        }
        updated_rows += 1;
    }

    Ok(DatabaseTableUpdateResult {
        updated_rows,
        updated_fields: 0,
        duration_ms: started_at.elapsed().as_millis(),
    })
}

async fn update_postgresql_table_rows(
    pool: &sqlx::PgPool,
    request: &UpdateDatabaseTableRowsRequest,
) -> Result<DatabaseTableUpdateResult, String> {
    let mut connection = pool.acquire().await.map_err(|error| error.to_string())?;
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
            .execute(&mut *connection)
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
    pool: &sqlx::MySqlPool,
    sql: &str,
    is_select: bool,
    limited: bool,
) -> Result<DatabaseQueryResult, String> {
    let mut connection = pool.acquire().await.map_err(|error| error.to_string())?;
    let started_at = Instant::now();
    let result = if is_select {
        let rows = sqlx::query(sql)
            .fetch_all(&mut *connection)
            .await
            .map_err(|error| error.to_string())?;
        rows_to_mysql_result(rows, started_at.elapsed().as_millis(), limited)
    } else {
        let result = sqlx::query(sql)
            .execute(&mut *connection)
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
    Ok(result)
}

async fn execute_postgresql_query(
    pool: &sqlx::PgPool,
    sql: &str,
    is_select: bool,
    limited: bool,
) -> Result<DatabaseQueryResult, String> {
    let mut connection = pool.acquire().await.map_err(|error| error.to_string())?;
    let started_at = Instant::now();
    let result = if is_select {
        let rows = sqlx::query(sql)
            .fetch_all(&mut *connection)
            .await
            .map_err(|error| error.to_string())?;
        rows_to_postgresql_result(rows, started_at.elapsed().as_millis(), limited)
    } else {
        let result = sqlx::query(sql)
            .execute(&mut *connection)
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
                    nullable: None,
                    has_default: None,
                    generated: None,
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
                    nullable: None,
                    has_default: None,
                    generated: None,
                })
                .collect()
        })
        .unwrap_or_default();
    let result_rows = rows
        .iter()
        .map(|row| {
            row.columns()
                .iter()
                .map(|column| postgresql_cell_value(row, column.name(), column.type_info().name()))
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
    if mysql_prefers_text_decode(type_name) {
        if let Ok(value) = row.try_get::<BigDecimal, _>(column_name) {
            return DatabaseCellValue::Number {
                value: value.to_string(),
            };
        }
        if let Ok(value) = row.try_get::<String, _>(column_name) {
            return DatabaseCellValue::Number { value };
        }
    }
    if mysql_prefers_numeric_decode(type_name) {
        if let Some(value) = mysql_number_cell_value(row, column_name) {
            return value;
        }
    }
    if mysql_prefers_datetime_decode(type_name) {
        if let Some(value) = mysql_datetime_cell_value(row, column_name, type_name) {
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

fn mysql_datetime_cell_value(
    row: &MySqlRow,
    column_name: &str,
    type_name: &str,
) -> Option<DatabaseCellValue> {
    match type_name.to_ascii_uppercase().as_str() {
        "DATE" => row
            .try_get::<NaiveDate, _>(column_name)
            .ok()
            .map(|value| DatabaseCellValue::Text {
                value: value.to_string(),
            }),
        "TIME" => row
            .try_get::<NaiveTime, _>(column_name)
            .ok()
            .map(|value| DatabaseCellValue::Text {
                value: value.to_string(),
            }),
        "DATETIME" | "TIMESTAMP" => row
            .try_get::<NaiveDateTime, _>(column_name)
            .ok()
            .map(|value| DatabaseCellValue::Text {
                value: value.to_string(),
            }),
        _ => None,
    }
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

pub(crate) fn mysql_prefers_text_decode(type_name: &str) -> bool {
    matches!(
        type_name.to_ascii_uppercase().as_str(),
        "DECIMAL" | "NEWDECIMAL" | "NUMERIC"
    )
}

pub(crate) fn mysql_prefers_datetime_decode(type_name: &str) -> bool {
    matches!(
        type_name.to_ascii_uppercase().as_str(),
        "DATE" | "DATETIME" | "TIMESTAMP" | "TIME"
    )
}

fn mysql_prefers_bool_decode(type_name: &str) -> bool {
    matches!(type_name.to_ascii_uppercase().as_str(), "BOOL" | "BOOLEAN")
}

fn postgresql_cell_value(row: &PgRow, column_name: &str, type_name: &str) -> DatabaseCellValue {
    if let Ok(value_ref) = row.try_get_raw(column_name) {
        if value_ref.is_null() {
            return DatabaseCellValue::Null;
        }
    }
    if postgresql_prefers_datetime_decode(type_name) {
        if let Some(value) = postgresql_datetime_cell_value(row, column_name, type_name) {
            return value;
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

fn postgresql_datetime_cell_value(
    row: &PgRow,
    column_name: &str,
    type_name: &str,
) -> Option<DatabaseCellValue> {
    match type_name.to_ascii_uppercase().as_str() {
        "DATE" => row
            .try_get::<NaiveDate, _>(column_name)
            .ok()
            .map(|value| DatabaseCellValue::Text {
                value: value.to_string(),
            }),
        "TIME" | "TIME WITHOUT TIME ZONE" => row
            .try_get::<NaiveTime, _>(column_name)
            .ok()
            .map(|value| DatabaseCellValue::Text {
                value: value.to_string(),
            }),
        "TIMESTAMP" | "TIMESTAMP WITHOUT TIME ZONE" => row
            .try_get::<NaiveDateTime, _>(column_name)
            .ok()
            .map(|value| DatabaseCellValue::Text {
                value: value.to_string(),
            }),
        "TIMESTAMPTZ" | "TIMESTAMP WITH TIME ZONE" => {
            if let Ok(value) = row.try_get::<DateTime<Utc>, _>(column_name) {
                return Some(DatabaseCellValue::Text {
                    value: value.to_string(),
                });
            }
            row.try_get::<DateTime<FixedOffset>, _>(column_name)
                .ok()
                .map(|value| DatabaseCellValue::Text {
                    value: value.to_string(),
                })
        }
        _ => None,
    }
}

pub(crate) fn postgresql_prefers_datetime_decode(type_name: &str) -> bool {
    matches!(
        type_name.to_ascii_uppercase().as_str(),
        "DATE"
            | "TIME"
            | "TIME WITHOUT TIME ZONE"
            | "TIMESTAMP"
            | "TIMESTAMP WITHOUT TIME ZONE"
            | "TIMESTAMPTZ"
            | "TIMESTAMP WITH TIME ZONE"
    )
}

fn contains_limit_clause(sql: &str) -> bool {
    sql.split(|character: char| !character.is_ascii_alphanumeric() && character != '_')
        .any(|token| token.eq_ignore_ascii_case("limit"))
}

fn first_sql_keyword(sql: &str) -> Option<&str> {
    let mut remaining = sql.trim_start();
    loop {
        if remaining.starts_with("--") {
            let newline_index = remaining.find('\n')?;
            remaining = remaining[newline_index + 1..].trim_start();
            continue;
        }
        if remaining.starts_with("/*") {
            let end_index = remaining.find("*/")?;
            remaining = remaining[end_index + 2..].trim_start();
            continue;
        }
        return remaining
            .split(|character: char| !character.is_ascii_alphabetic())
            .find(|token| !token.is_empty());
    }
}
