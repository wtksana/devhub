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
pub struct LoadDatabaseTablePageRequest {
    pub connection_id: String,
    pub database: String,
    pub table: String,
    pub page: Option<u32>,
    pub page_size: Option<u32>,
    pub sort_column: Option<String>,
    pub sort_direction: Option<String>,
    pub filter: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct DatabaseSqlFile {
    pub name: String,
    pub content: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct DatabaseResultColumn {
    pub name: String,
    pub data_type: String,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum DatabaseCellValue {
    Null,
    Text { value: String },
    Number { value: String },
    Bool { value: bool },
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
}
