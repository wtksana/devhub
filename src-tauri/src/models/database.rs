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
