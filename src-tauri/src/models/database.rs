use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct DatabaseTreeNode {
    pub id: String,
    pub name: String,
    pub kind: String,
    pub has_children: bool,
    pub detail: Option<String>,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
pub struct ListDatabaseObjectsRequest {
    pub connection_id: String,
    pub parent_kind: Option<String>,
    pub database: Option<String>,
    pub schema: Option<String>,
    pub table: Option<String>,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
pub struct ExecuteDatabaseQueryRequest {
    pub connection_id: String,
    pub database: Option<String>,
    pub sql: String,
    pub limit: Option<u32>,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
pub struct ListDatabaseSqlFilesRequest {
    pub connection_id: String,
    pub database: String,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
pub struct SaveDatabaseSqlFileRequest {
    pub connection_id: String,
    pub database: String,
    pub name: String,
    pub content: String,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
pub struct PreviewDatabaseSqlFileRequest {
    pub connection_id: String,
    pub database: String,
    pub path: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct DatabaseSqlFilePreview {
    pub path: String,
    pub file_name: String,
    pub size_bytes: u64,
    pub preview: String,
    pub estimated_statement_count: u64,
    pub dangerous: bool,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
pub struct ExecuteDatabaseSqlFileRequest {
    pub connection_id: String,
    pub database: String,
    pub path: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct DatabaseSqlFileExecutionResult {
    pub executed_statements: u64,
    pub affected_rows: u64,
    pub duration_ms: u128,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub failed_statement_index: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub failed_statement_preview: Option<String>,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
pub struct LoadDatabaseTablePageRequest {
    pub connection_id: String,
    pub database: String,
    pub table: String,
    pub page: Option<u32>,
    pub page_size: Option<u32>,
    pub sort_column: Option<String>,
    pub sort_direction: Option<String>,
    pub order_by: Option<String>,
    pub filter: Option<String>,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
pub struct GetDatabaseTableDdlRequest {
    pub connection_id: String,
    pub database: String,
    pub table: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct DatabaseTableDdlResult {
    pub ddl: String,
    pub duration_ms: u128,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct TableStructureColumnDefinition {
    pub name: String,
    pub data_type: String,
    pub nullable: bool,
    pub default_value: Option<String>,
    pub comment: Option<String>,
    pub extra: Option<String>,
    pub position: Option<TableStructureColumnPosition>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum TableStructureColumnPosition {
    First,
    After { column: String },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct TableStructureIndexDefinition {
    pub name: String,
    pub columns: Vec<String>,
    pub unique: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum TableStructureOperation {
    RenameTable {
        new_name: String,
    },
    AddColumn {
        column: TableStructureColumnDefinition,
    },
    ModifyColumn {
        original_name: String,
        column: TableStructureColumnDefinition,
    },
    DropColumn {
        name: String,
    },
    AddIndex {
        index: TableStructureIndexDefinition,
    },
    DropIndex {
        name: String,
    },
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
pub struct UpdateDatabaseTableStructureRequest {
    pub connection_id: String,
    pub database: String,
    pub table: String,
    pub operations: Vec<TableStructureOperation>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct DatabaseTableStructureUpdateResult {
    pub ddl: String,
    pub duration_ms: u128,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct DatabaseSqlFile {
    pub name: String,
    pub content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct DatabaseResultColumn {
    pub name: String,
    pub data_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub nullable: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub has_default: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub generated: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum DatabaseCellValue {
    Null,
    Text { value: String },
    Number { value: String },
    Bool { value: bool },
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum DatabaseResultExportFormat {
    Csv,
    InsertSql,
}

#[derive(Debug, Clone, Deserialize, PartialEq)]
pub struct ExportDatabaseResultRequest {
    pub connection_id: String,
    pub database: String,
    pub table: Option<String>,
    pub path: String,
    pub format: DatabaseResultExportFormat,
    #[serde(default = "default_true")]
    pub include_header: bool,
    pub columns: Vec<DatabaseResultColumn>,
    pub rows: Vec<Vec<DatabaseCellValue>>,
}

fn default_true() -> bool {
    true
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct DatabaseResultExportResult {
    pub exported_rows: u64,
    pub duration_ms: u128,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct DatabaseQueryResult {
    pub columns: Vec<DatabaseResultColumn>,
    pub rows: Vec<Vec<DatabaseCellValue>>,
    pub affected_rows: u64,
    pub duration_ms: u128,
    pub limited: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct DatabaseTablePageResult {
    pub columns: Vec<DatabaseResultColumn>,
    pub rows: Vec<Vec<DatabaseCellValue>>,
    pub total_rows: u64,
    pub page: u32,
    pub page_size: u32,
    pub duration_ms: u128,
    pub primary_key_columns: Vec<String>,
    pub editable: bool,
}

#[derive(Debug, Clone, Deserialize, PartialEq)]
pub struct DatabaseTableUpdateRow {
    pub primary_key_values: BTreeMap<String, DatabaseCellValue>,
    pub changes: BTreeMap<String, DatabaseCellValue>,
}

#[derive(Debug, Clone, Deserialize, PartialEq)]
pub struct DatabaseTableInsertRow {
    pub values: BTreeMap<String, DatabaseCellValue>,
}

#[derive(Debug, Clone, Deserialize, PartialEq)]
pub struct InsertDatabaseTableRowsRequest {
    pub connection_id: String,
    pub database: String,
    pub table: String,
    pub rows: Vec<DatabaseTableInsertRow>,
}

#[derive(Debug, Clone, Deserialize, PartialEq)]
pub struct DatabaseTableDeleteRow {
    pub primary_key_values: BTreeMap<String, DatabaseCellValue>,
}

#[derive(Debug, Clone, Deserialize, PartialEq)]
pub struct DeleteDatabaseTableRowsRequest {
    pub connection_id: String,
    pub database: String,
    pub table: String,
    pub primary_key_columns: Vec<String>,
    pub rows: Vec<DatabaseTableDeleteRow>,
}

#[derive(Debug, Clone, Deserialize, PartialEq)]
pub struct UpdateDatabaseTableRowsRequest {
    pub connection_id: String,
    pub database: String,
    pub table: String,
    pub primary_key_columns: Vec<String>,
    pub rows: Vec<DatabaseTableUpdateRow>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct DatabaseTableUpdateResult {
    pub updated_rows: u64,
    pub updated_fields: u64,
    pub duration_ms: u128,
}
