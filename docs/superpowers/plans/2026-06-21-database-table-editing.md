# Database Table Editing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在数据库表数据浏览模式中支持有主键普通表的已有行单元格编辑、确认保存和只读保护。

**Architecture:** 后端扩展表分页响应，返回主键列和可编辑状态，并新增批量更新 command；前端在 `DatabaseTableBrowser` 中维护本地脏单元格、编辑输入和保存/放弃流程。无主键表和视图只读，保存请求只包含主键值和变更字段。

**Tech Stack:** Tauri v2、Rust、sqlx、React、TypeScript、Vitest、Testing Library。

---

## Files

- Modify: `src-tauri/src/models/database.rs`
  - 增加表分页响应字段、更新请求和更新响应类型。
- Modify: `src-tauri/src/db/query.rs`
  - 增加主键查询 SQL 构造、更新 SQL 构造、更新 command 核心逻辑。
- Modify: `src-tauri/src/commands/database.rs`
  - 暴露 `update_database_table_rows`。
- Modify: `src-tauri/src/lib.rs`
  - 注册新 command。
- Modify: `src-tauri/src/tests/database_query_tests.rs`
  - 覆盖主键查询、更新 SQL、拒绝无效更新。
- Modify: `src/features/database/databaseTypes.ts`
  - 同步表分页结果、更新请求/响应类型。
- Modify: `src/features/database/DatabaseTableBrowser.tsx`
  - 增加单元格编辑、脏状态、保存/放弃确认、只读提示。
- Modify: `src/features/database/DatabaseWorkspace.test.tsx`
  - 覆盖前端编辑和保存流程。
- Modify: `src/i18n/locales/zh-CN.ts`
  - 增加数据库编辑相关中文文案。
- Modify: `src/i18n/locales/en-US.ts`
  - 增加数据库编辑相关英文文案。
- Modify: `src/styles/globals.css`
  - 增加编辑单元格、脏单元格、编辑工具栏样式。
- Modify: `README.md`
  - 更新数据库功能说明。
- Modify: `docs/当前状态与下一步.md`
  - 更新当前状态和下一步。

---

### Task 1: 后端模型和 SQL 构造

**Files:**
- Modify: `src-tauri/src/models/database.rs`
- Modify: `src-tauri/src/db/query.rs`
- Modify: `src-tauri/src/tests/database_query_tests.rs`

- [ ] **Step 1: Write failing Rust tests for metadata and update SQL**

Add these imports in `src-tauri/src/tests/database_query_tests.rs`:

```rust
use std::collections::BTreeMap;
```

Extend the `crate::db::query` import:

```rust
use crate::db::query::{
    apply_select_limit, build_table_page_queries, build_table_update_queries,
    primary_key_query_for_table, is_dangerous_sql, mysql_prefers_numeric_decode,
    normalize_table_page_request, normalize_table_update_request, quote_identifier,
};
```

Extend the model import:

```rust
use crate::models::database::{
    DatabaseCellValue, DatabaseTableUpdateRow, LoadDatabaseTablePageRequest,
    UpdateDatabaseTableRowsRequest,
};
```

Add tests:

```rust
#[test]
fn builds_mysql_primary_key_query() {
    let query = primary_key_query_for_table("mysql", "app", "users").unwrap();

    assert!(query.sql.contains("information_schema.key_column_usage"));
    assert!(query.sql.contains("constraint_name = 'PRIMARY'"));
    assert_eq!(query.binds, vec!["app".to_string(), "users".to_string()]);
}

#[test]
fn builds_postgresql_primary_key_query() {
    let query = primary_key_query_for_table("postgresql", "public", "users").unwrap();

    assert!(query.sql.contains("information_schema.table_constraints"));
    assert!(query.sql.contains("PRIMARY KEY"));
    assert_eq!(query.binds, vec!["public".to_string(), "users".to_string()]);
}

#[test]
fn builds_mysql_table_update_query() {
    let request = table_update_request(
        "mysql-dev",
        "app",
        "users",
        vec!["id"],
        vec![("name", DatabaseCellValue::Text { value: "Alice".to_string() })],
        vec![("id", DatabaseCellValue::Number { value: "1".to_string() })],
    );
    let normalized = normalize_table_update_request(request, &["id".to_string()]).unwrap();
    let queries = build_table_update_queries("mysql", &normalized).unwrap();

    assert_eq!(queries[0].sql, "UPDATE `users` SET `name` = ? WHERE `id` = ?");
    assert_eq!(
        queries[0].values,
        vec![
            DatabaseCellValue::Text { value: "Alice".to_string() },
            DatabaseCellValue::Number { value: "1".to_string() },
        ]
    );
}

#[test]
fn builds_postgresql_table_update_query_with_composite_primary_key() {
    let request = table_update_request(
        "pg-dev",
        "public",
        "order_items",
        vec!["order_id", "item_id"],
        vec![("quantity", DatabaseCellValue::Number { value: "2".to_string() })],
        vec![
            ("order_id", DatabaseCellValue::Number { value: "10".to_string() }),
            ("item_id", DatabaseCellValue::Number { value: "3".to_string() }),
        ],
    );
    let normalized = normalize_table_update_request(
        request,
        &["order_id".to_string(), "item_id".to_string()],
    )
    .unwrap();
    let queries = build_table_update_queries("postgresql", &normalized).unwrap();

    assert_eq!(
        queries[0].sql,
        "UPDATE \"public\".\"order_items\" SET \"quantity\" = $1 WHERE \"order_id\" = $2 AND \"item_id\" = $3"
    );
}

#[test]
fn rejects_table_update_without_primary_key() {
    let request = table_update_request(
        "mysql-dev",
        "app",
        "users",
        vec![],
        vec![("name", DatabaseCellValue::Text { value: "Alice".to_string() })],
        vec![],
    );

    assert_eq!(
        normalize_table_update_request(request, &[]).unwrap_err(),
        "table has no primary key"
    );
}

#[test]
fn rejects_table_update_when_changes_include_primary_key() {
    let request = table_update_request(
        "mysql-dev",
        "app",
        "users",
        vec!["id"],
        vec![("id", DatabaseCellValue::Number { value: "2".to_string() })],
        vec![("id", DatabaseCellValue::Number { value: "1".to_string() })],
    );

    assert_eq!(
        normalize_table_update_request(request, &["id".to_string()]).unwrap_err(),
        "primary key column cannot be updated: id"
    );
}

#[test]
fn rejects_table_update_without_changes() {
    let request = table_update_request(
        "mysql-dev",
        "app",
        "users",
        vec!["id"],
        vec![],
        vec![("id", DatabaseCellValue::Number { value: "1".to_string() })],
    );

    assert_eq!(
        normalize_table_update_request(request, &["id".to_string()]).unwrap_err(),
        "row changes are required"
    );
}

fn table_update_request(
    connection_id: &str,
    database: &str,
    table: &str,
    primary_key_columns: Vec<&str>,
    changes: Vec<(&str, DatabaseCellValue)>,
    primary_key_values: Vec<(&str, DatabaseCellValue)>,
) -> UpdateDatabaseTableRowsRequest {
    UpdateDatabaseTableRowsRequest {
        connection_id: connection_id.to_string(),
        database: database.to_string(),
        table: table.to_string(),
        primary_key_columns: primary_key_columns.into_iter().map(str::to_string).collect(),
        rows: vec![DatabaseTableUpdateRow {
            primary_key_values: primary_key_values
                .into_iter()
                .map(|(key, value)| (key.to_string(), value))
                .collect::<BTreeMap<_, _>>(),
            changes: changes
                .into_iter()
                .map(|(key, value)| (key.to_string(), value))
                .collect::<BTreeMap<_, _>>(),
        }],
    }
}
```

- [ ] **Step 2: Run Rust test and verify failure**

Run:

```powershell
cargo test --manifest-path src-tauri/Cargo.toml database_query_tests
```

Expected: compile failure because `DatabaseTableUpdateRow`, `UpdateDatabaseTableRowsRequest`, `primary_key_query_for_table`, `normalize_table_update_request`, and `build_table_update_queries` do not exist.

- [ ] **Step 3: Add backend model types**

In `src-tauri/src/models/database.rs`, add:

```rust
use std::collections::BTreeMap;
```

Add fields to `DatabaseTablePageResult`:

```rust
pub primary_key_columns: Vec<String>,
pub editable: bool,
```

Add request and response structs:

```rust
#[derive(Debug, Clone, Deserialize, PartialEq)]
pub struct DatabaseTableUpdateRow {
    pub primary_key_values: BTreeMap<String, DatabaseCellValue>,
    pub changes: BTreeMap<String, DatabaseCellValue>,
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
```

Update `DatabaseCellValue` derive:

```rust
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum DatabaseCellValue {
    Null,
    Text { value: String },
    Number { value: String },
    Bool { value: bool },
}
```

- [ ] **Step 4: Add SQL builders and normalization**

In `src-tauri/src/db/query.rs`, add imports:

```rust
use std::collections::{BTreeMap, BTreeSet};
```

Extend model import:

```rust
DatabaseCellValue, DatabaseQueryResult, DatabaseResultColumn, DatabaseTablePageResult,
DatabaseTableUpdateResult, ExecuteDatabaseQueryRequest, LoadDatabaseTablePageRequest,
UpdateDatabaseTableRowsRequest,
```

Add structs:

```rust
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
```

Add functions:

```rust
pub fn primary_key_query_for_table(kind: &str, database: &str, table: &str) -> Result<MetadataQuery, String> {
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

    let primary_key_set = actual_primary_key_columns.iter().cloned().collect::<BTreeSet<_>>();
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
                set_parts.push(format!("{} = {placeholder}", quote_identifier(kind, column)?));
                values.push(value.clone());
            }
            let mut where_parts = Vec::new();
            for column in &request.primary_key_columns {
                let placeholder = parameter_placeholder(kind, parameter_index)?;
                parameter_index += 1;
                where_parts.push(format!("{} = {placeholder}", quote_identifier(kind, column)?));
                values.push(row.primary_key_values[column].clone());
            }
            Ok(TableUpdateQuery {
                sql: format!("UPDATE {table} SET {} WHERE {}", set_parts.join(", "), where_parts.join(" AND ")),
                values,
            })
        })
        .collect()
}

fn table_identifier(kind: &str, database: &str, table: &str) -> Result<String, String> {
    match kind {
        "mysql" => quote_identifier(kind, table),
        "postgresql" => Ok(format!("{}.{}", quote_identifier(kind, database)?, quote_identifier(kind, table)?)),
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
```

Import `MetadataQuery`:

```rust
use crate::db::metadata::MetadataQuery;
```

- [ ] **Step 5: Run Rust test and verify pass**

Run:

```powershell
cargo test --manifest-path src-tauri/Cargo.toml database_query_tests
```

Expected: `database_query_tests` pass. If other compile errors reference missing `primary_key_columns` and `editable` initializers, add `primary_key_columns: Vec::new(), editable: false` to existing `DatabaseTablePageResult` test or construction sites.

---

### Task 2: 后端加载主键和更新命令

**Files:**
- Modify: `src-tauri/src/db/query.rs`
- Modify: `src-tauri/src/commands/database.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/src/tests/database_query_tests.rs`

- [ ] **Step 1: Write failing tests for table page edit metadata**

In `src-tauri/src/tests/database_query_tests.rs`, add:

```rust
#[test]
fn mysql_table_page_identifier_uses_table_only() {
    let request = LoadDatabaseTablePageRequest {
        connection_id: "mysql-dev".to_string(),
        database: "app".to_string(),
        table: "users".to_string(),
        page: Some(1),
        page_size: Some(200),
        sort_column: None,
        sort_direction: None,
        filter: None,
    };
    let normalized = normalize_table_page_request(request).unwrap();
    let queries = build_table_page_queries("mysql", &normalized).unwrap();

    assert!(queries.page_sql.starts_with("SELECT * FROM `users`"));
}
```

This test documents the existing MySQL table identifier behavior before extending page loading with edit metadata.

- [ ] **Step 2: Run Rust test**

Run:

```powershell
cargo test --manifest-path src-tauri/Cargo.toml database_query_tests
```

Expected: pass after Task 1. This is a guard test before changing table page internals.

- [ ] **Step 3: Load primary key metadata in table page result**

In `src-tauri/src/db/query.rs`, add async helpers:

```rust
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
```

In `load_mysql_table_page`, after connection opens and before constructing `DatabaseTablePageResult`, call:

```rust
let primary_key_columns = load_mysql_primary_key_columns(&mut connection, &request.database, &request.table).await?;
let editable = !primary_key_columns.is_empty();
```

Add fields to result:

```rust
primary_key_columns,
editable,
```

In `load_postgresql_table_page`, call PostgreSQL helper and add the same fields.

- [ ] **Step 4: Implement update command core**

In `src-tauri/src/db/query.rs`, add:

```rust
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
```

Add value bind helpers:

```rust
fn bind_mysql_value<'q>(
    query: sqlx::query::Query<'q, sqlx::MySql, sqlx::mysql::MySqlArguments>,
    value: &'q DatabaseCellValue,
) -> sqlx::query::Query<'q, sqlx::MySql, sqlx::mysql::MySqlArguments> {
    match value {
        DatabaseCellValue::Null => query.bind(Option::<String>::None),
        DatabaseCellValue::Text { value } | DatabaseCellValue::Number { value } => query.bind(value),
        DatabaseCellValue::Bool { value } => query.bind(*value),
    }
}

fn bind_postgresql_value<'q>(
    query: sqlx::query::Query<'q, sqlx::Postgres, sqlx::postgres::PgArguments>,
    value: &'q DatabaseCellValue,
) -> sqlx::query::Query<'q, sqlx::Postgres, sqlx::postgres::PgArguments> {
    match value {
        DatabaseCellValue::Null => query.bind(Option::<String>::None),
        DatabaseCellValue::Text { value } | DatabaseCellValue::Number { value } => query.bind(value),
        DatabaseCellValue::Bool { value } => query.bind(*value),
    }
}
```

Add update functions:

```rust
async fn update_mysql_table_rows(
    connection: &DatabaseConnectionSettings,
    request: &UpdateDatabaseTableRowsRequest,
) -> Result<DatabaseTableUpdateResult, String> {
    let url = database_connection_url(&DatabaseConnectionSettings {
        database: Some(request.database.clone()),
        ..connection.clone()
    })?;
    let mut connection = MySqlConnection::connect(&url).await.map_err(|error| error.to_string())?;
    let primary_key_columns = load_mysql_primary_key_columns(&mut connection, &request.database, &request.table).await?;
    let normalized = normalize_table_update_request(request.clone(), &primary_key_columns)?;
    let queries = build_table_update_queries("mysql", &normalized)?;
    let started_at = Instant::now();
    let mut updated_rows = 0;
    let mut updated_fields = 0;
    for query in queries {
        let mut sql = sqlx::query(&query.sql);
        for value in &query.values {
            sql = bind_mysql_value(sql, value);
        }
        let result = sql.execute(&mut connection).await.map_err(|error| error.to_string())?;
        if result.rows_affected() != 1 {
            return Err(format!("expected to update 1 row, updated {}", result.rows_affected()));
        }
        updated_rows += 1;
        updated_fields += normalized.rows[(updated_rows - 1) as usize].changes.len() as u64;
    }
    connection.close().await.map_err(|error| error.to_string())?;
    Ok(DatabaseTableUpdateResult { updated_rows, updated_fields, duration_ms: started_at.elapsed().as_millis() })
}
```

Add `update_postgresql_table_rows` analogously using `PgConnection`, `load_postgresql_primary_key_columns`, `build_table_update_queries("postgresql", ...)`, and `bind_postgresql_value`.

- [ ] **Step 5: Wire Tauri command**

In `src-tauri/src/commands/database.rs`, import:

```rust
UpdateDatabaseTableRowsRequest, DatabaseTableUpdateResult,
```

Add command:

```rust
#[tauri::command]
pub async fn update_database_table_rows(
    database_manager: State<'_, DatabaseConnectionManager>,
    settings_store: State<'_, SettingsStore>,
    request: UpdateDatabaseTableRowsRequest,
) -> Result<DatabaseTableUpdateResult, String> {
    let connection = database_connection(&settings_store, &request.connection_id)?;
    query::update_database_table_rows(database_manager.inner(), &connection, &request).await
}
```

In `src-tauri/src/lib.rs`, register:

```rust
commands::database::update_database_table_rows,
```

- [ ] **Step 6: Run Rust tests**

Run:

```powershell
cargo test --manifest-path src-tauri/Cargo.toml database_query_tests
```

Expected: pass.

---

### Task 3: 前端类型、文案和只读状态

**Files:**
- Modify: `src/features/database/databaseTypes.ts`
- Modify: `src/features/database/DatabaseWorkspace.test.tsx`
- Modify: `src/features/database/DatabaseTableBrowser.tsx`
- Modify: `src/i18n/locales/zh-CN.ts`
- Modify: `src/i18n/locales/en-US.ts`
- Modify: `src/styles/globals.css`

- [ ] **Step 1: Write failing frontend tests for editable metadata**

In mocked `load_database_table_page` responses inside `src/features/database/DatabaseWorkspace.test.tsx`, add:

```ts
primary_key_columns: ["id"],
editable: true,
```

Add test:

```ts
it("shows readonly reason when table page has no primary key", async () => {
  callBackendMock.mockImplementation((command, payload) => {
    if (command === "list_database_objects") {
      const request = (payload as { request: { parent_kind?: string } }).request;
      if (!request.parent_kind) {
        return Promise.resolve([{ id: "database:app", name: "app", kind: "database", has_children: true }]);
      }
      return Promise.resolve([{ id: "table:app.logs", name: "logs", kind: "table", has_children: true }]);
    }
    if (command === "load_database_table_page") {
      return Promise.resolve({
        columns: [{ name: "message", data_type: "VARCHAR" }],
        rows: [[{ kind: "text", value: "hello" }]],
        total_rows: 1,
        page: 1,
        page_size: 200,
        duration_ms: 9,
        primary_key_columns: [],
        editable: false,
      });
    }
    return Promise.resolve([]);
  });

  renderDatabaseWorkspace("app");
  await userEvent.dblClick(await screen.findByText("logs"));

  expect(await screen.findByText("当前表没有主键，表数据只读。")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "保存更改" })).toBeDisabled();
});
```

- [ ] **Step 2: Run frontend test and verify failure**

Run:

```powershell
pnpm test -- src/features/database/DatabaseWorkspace.test.tsx
```

Expected: fail because `primary_key_columns`, `editable`, and readonly UI are not implemented.

- [ ] **Step 3: Update TypeScript types**

In `src/features/database/databaseTypes.ts`, update `DatabaseTablePageResult`:

```ts
export interface DatabaseTablePageResult {
  columns: Array<{
    name: string;
    data_type: string;
  }>;
  rows: DatabaseCellValue[][];
  total_rows: number;
  page: number;
  page_size: number;
  duration_ms: number;
  primary_key_columns: string[];
  editable: boolean;
}
```

Add:

```ts
export interface DatabaseTableUpdateRow {
  primary_key_values: Record<string, DatabaseCellValue>;
  changes: Record<string, DatabaseCellValue>;
}

export interface UpdateDatabaseTableRowsRequest {
  connection_id: string;
  database: string;
  table: string;
  primary_key_columns: string[];
  rows: DatabaseTableUpdateRow[];
}

export interface DatabaseTableUpdateResult {
  updated_rows: number;
  updated_fields: number;
  duration_ms: number;
}
```

- [ ] **Step 4: Add i18n strings**

In `src/i18n/locales/zh-CN.ts`, add:

```ts
"database.save_changes": "保存更改",
"database.discard_changes": "放弃更改",
"database.unsaved_changes": "未保存 {rows} 行 / {fields} 字段",
"database.readonly_no_primary_key": "当前表没有主键，表数据只读。",
"database.readonly_view": "视图暂不支持编辑。",
"database.confirm_save_changes": "确认保存更改",
"database.confirm_save_changes_message": "确认保存 {rows} 行 {fields} 个字段的更改？",
"database.confirm_discard_changes": "确认放弃更改",
"database.confirm_discard_changes_message": "当前有未保存更改，确认放弃？",
"database.confirm_discard_before_action": "当前有未保存更改，继续操作会放弃这些更改。",
```

In `src/i18n/locales/en-US.ts`, add equivalent English strings:

```ts
"database.save_changes": "Save changes",
"database.discard_changes": "Discard changes",
"database.unsaved_changes": "Unsaved {rows} rows / {fields} fields",
"database.readonly_no_primary_key": "This table has no primary key, so table data is read-only.",
"database.readonly_view": "Views are not editable yet.",
"database.confirm_save_changes": "Confirm save changes",
"database.confirm_save_changes_message": "Save changes to {rows} rows and {fields} fields?",
"database.confirm_discard_changes": "Confirm discard changes",
"database.confirm_discard_changes_message": "There are unsaved changes. Discard them?",
"database.confirm_discard_before_action": "There are unsaved changes. Continuing will discard them.",
```

- [ ] **Step 5: Add readonly toolbar UI**

In `DatabaseTableBrowser.tsx`, render after total rows:

```tsx
<button type="button" disabled>
  {t("database.save_changes")}
</button>
<button type="button" disabled>
  {t("database.discard_changes")}
</button>
{result && !result.editable ? (
  <span className="database-table-browser__readonly">
    {t("database.readonly_no_primary_key")}
  </span>
) : null}
```

This task only introduces visible disabled controls and readonly reason; editing behavior comes later.

- [ ] **Step 6: Add minimal styles**

In `src/styles/globals.css`, add:

```css
.database-table-browser__readonly {
  color: var(--muted);
}
```

- [ ] **Step 7: Run frontend test**

Run:

```powershell
pnpm test -- src/features/database/DatabaseWorkspace.test.tsx
```

Expected: pass.

---

### Task 4: 单元格编辑和本地脏状态

**Files:**
- Modify: `src/features/database/DatabaseWorkspace.test.tsx`
- Modify: `src/features/database/DatabaseTableBrowser.tsx`
- Modify: `src/styles/globals.css`

- [ ] **Step 1: Write failing edit-state test**

Add test:

```ts
it("edits non-primary-key cells locally and marks unsaved changes", async () => {
  callBackendMock.mockImplementation((command, payload) => {
    if (command === "list_database_objects") {
      const request = (payload as { request: { parent_kind?: string } }).request;
      if (!request.parent_kind) {
        return Promise.resolve([{ id: "database:app", name: "app", kind: "database", has_children: true }]);
      }
      return Promise.resolve([{ id: "table:app.users", name: "users", kind: "table", has_children: true }]);
    }
    if (command === "load_database_table_page") {
      return Promise.resolve({
        columns: [
          { name: "id", data_type: "INT" },
          { name: "name", data_type: "VARCHAR" },
        ],
        rows: [[{ kind: "number", value: "1" }, { kind: "text", value: "Alice" }]],
        total_rows: 1,
        page: 1,
        page_size: 200,
        duration_ms: 9,
        primary_key_columns: ["id"],
        editable: true,
      });
    }
    return Promise.resolve([]);
  });

  renderDatabaseWorkspace("app");
  await userEvent.dblClick(await screen.findByText("users"));
  await screen.findByLabelText("表数据");

  await userEvent.dblClick(screen.getByText("Alice"));
  const editor = screen.getByLabelText("编辑 name");
  await userEvent.clear(editor);
  await userEvent.type(editor, "Bob{Enter}");

  expect(screen.getByText("未保存 1 行 / 1 字段")).toBeInTheDocument();
  expect(screen.getByText("Bob").closest("td")).toHaveClass("database-table-browser__cell--dirty");
  await userEvent.dblClick(screen.getByText("1"));
  expect(screen.queryByLabelText("编辑 id")).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run frontend test and verify failure**

Run:

```powershell
pnpm test -- src/features/database/DatabaseWorkspace.test.tsx
```

Expected: fail because cells are not editable.

- [ ] **Step 3: Implement local edit state**

In `DatabaseTableBrowser.tsx`, add state:

```ts
type CellKey = `${number}:${string}`;
type DirtyRows = Record<number, Record<string, DatabaseCellValue>>;
type EditingCell = { rowIndex: number; columnName: string; value: string } | null;

const [dirtyRows, setDirtyRows] = useState<DirtyRows>({});
const [editingCell, setEditingCell] = useState<EditingCell>(null);
```

Add helpers:

```ts
function cellKey(rowIndex: number, columnName: string): CellKey {
  return `${rowIndex}:${columnName}`;
}

function cellText(cell: DatabaseCellValue) {
  if (cell.kind === "null") return "NULL";
  if (cell.kind === "bool") return String(cell.value);
  return cell.value;
}

function isPrimaryKeyColumn(columnName: string) {
  return result?.primary_key_columns.includes(columnName) ?? false;
}

function editableCell(columnName: string) {
  return Boolean(result?.editable && !isPrimaryKeyColumn(columnName));
}

function displayedCell(rowIndex: number, columnName: string, original: DatabaseCellValue) {
  return dirtyRows[rowIndex]?.[columnName] ?? original;
}

function commitEditingCell() {
  if (!editingCell || !result) return;
  setDirtyRows((current) => ({
    ...current,
    [editingCell.rowIndex]: {
      ...(current[editingCell.rowIndex] ?? {}),
      [editingCell.columnName]: { kind: "text", value: editingCell.value },
    },
  }));
  setEditingCell(null);
}
```

In table body rendering, replace cell `<td>` body with:

```tsx
const column = result.columns[cellIndex];
const displayed = displayedCell(rowIndex, column.name, cell);
const isDirty = Boolean(dirtyRows[rowIndex]?.[column.name]);
const isEditing = editingCell?.rowIndex === rowIndex && editingCell.columnName === column.name;
return (
  <td
    key={cellIndex}
    className={isDirty ? "database-table-browser__cell--dirty" : undefined}
    onDoubleClick={() => {
      if (!editableCell(column.name)) return;
      setEditingCell({ rowIndex, columnName: column.name, value: cellText(displayed) });
    }}
  >
    {isEditing ? (
      <input
        aria-label={`编辑 ${column.name}`}
        autoFocus
        value={editingCell.value}
        onBlur={commitEditingCell}
        onChange={(event) => setEditingCell({ ...editingCell, value: event.target.value })}
        onKeyDown={(event) => {
          if (event.key === "Enter") commitEditingCell();
          if (event.key === "Escape") setEditingCell(null);
        }}
      />
    ) : formatCellValue(displayed)}
  </td>
);
```

Add derived count:

```ts
const dirtyRowCount = Object.keys(dirtyRows).length;
const dirtyFieldCount = Object.values(dirtyRows).reduce((total, row) => total + Object.keys(row).length, 0);
```

Render unsaved text when `dirtyFieldCount > 0`.

- [ ] **Step 4: Add dirty styles**

In `src/styles/globals.css`, add:

```css
.database-table-browser__cell--dirty {
  background: color-mix(in srgb, var(--accent) 14%, transparent);
}

.database-table-browser td input {
  width: 100%;
  min-width: 120px;
  height: 28px;
  padding: 0 6px;
  font: inherit;
}
```

- [ ] **Step 5: Run frontend test**

Run:

```powershell
pnpm test -- src/features/database/DatabaseWorkspace.test.tsx
```

Expected: pass.

---

### Task 5: 保存、放弃和切换前确认

**Files:**
- Modify: `src/features/database/DatabaseWorkspace.test.tsx`
- Modify: `src/features/database/DatabaseTableBrowser.tsx`
- Modify: `src/styles/globals.css`

- [ ] **Step 1: Write failing save/discard test**

Add test:

```ts
it("confirms and saves edited table cells", async () => {
  callBackendMock.mockImplementation((command, payload) => {
    if (command === "list_database_objects") {
      const request = (payload as { request: { parent_kind?: string } }).request;
      if (!request.parent_kind) {
        return Promise.resolve([{ id: "database:app", name: "app", kind: "database", has_children: true }]);
      }
      return Promise.resolve([{ id: "table:app.users", name: "users", kind: "table", has_children: true }]);
    }
    if (command === "load_database_table_page") {
      return Promise.resolve({
        columns: [
          { name: "id", data_type: "INT" },
          { name: "name", data_type: "VARCHAR" },
        ],
        rows: [[{ kind: "number", value: "1" }, { kind: "text", value: "Alice" }]],
        total_rows: 1,
        page: 1,
        page_size: 200,
        duration_ms: 9,
        primary_key_columns: ["id"],
        editable: true,
      });
    }
    if (command === "update_database_table_rows") {
      return Promise.resolve({ updated_rows: 1, updated_fields: 1, duration_ms: 6 });
    }
    return Promise.resolve([]);
  });

  renderDatabaseWorkspace("app");
  await userEvent.dblClick(await screen.findByText("users"));
  await userEvent.dblClick(await screen.findByText("Alice"));
  await userEvent.clear(screen.getByLabelText("编辑 name"));
  await userEvent.type(screen.getByLabelText("编辑 name"), "Bob{Enter}");

  await userEvent.click(screen.getByRole("button", { name: "保存更改" }));
  expect(screen.getByText("确认保存 1 行 1 个字段的更改？")).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "确认" }));

  await waitFor(() => {
    expect(callBackendMock).toHaveBeenCalledWith("update_database_table_rows", {
      request: {
        connection_id: "mysql-dev",
        database: "app",
        table: "users",
        primary_key_columns: ["id"],
        rows: [{
          primary_key_values: { id: { kind: "number", value: "1" } },
          changes: { name: { kind: "text", value: "Bob" } },
        }],
      },
    });
  });
});
```

- [ ] **Step 2: Run frontend test and verify failure**

Run:

```powershell
pnpm test -- src/features/database/DatabaseWorkspace.test.tsx
```

Expected: fail because save flow is not implemented.

- [ ] **Step 3: Implement save request construction**

In `DatabaseTableBrowser.tsx`, add state:

```ts
const [confirmDialog, setConfirmDialog] = useState<"save" | "discard" | null>(null);
const [isSaving, setIsSaving] = useState(false);
```

Add function:

```ts
function buildUpdateRows() {
  if (!result) return [];
  return Object.entries(dirtyRows).map(([rowIndexText, changes]) => {
    const rowIndex = Number(rowIndexText);
    const row = result.rows[rowIndex];
    const primary_key_values = Object.fromEntries(
      result.primary_key_columns.map((columnName) => {
        const index = result.columns.findIndex((column) => column.name === columnName);
        return [columnName, row[index]];
      }),
    );
    return { primary_key_values, changes };
  });
}
```

Add save function:

```ts
async function saveChanges() {
  if (!result || dirtyFieldCount === 0) return;
  setIsSaving(true);
  setError(null);
  try {
    await callBackend<DatabaseTableUpdateResult>("update_database_table_rows", {
      request: {
        connection_id: connectionId,
        database: target.database,
        table: target.table,
        primary_key_columns: result.primary_key_columns,
        rows: buildUpdateRows(),
      },
    });
    setDirtyRows({});
    setConfirmDialog(null);
    await loadPage();
  } catch (caught) {
    setError(caught instanceof Error ? caught.message : String(caught));
  } finally {
    setIsSaving(false);
  }
}
```

Enable toolbar buttons:

```tsx
<button type="button" disabled={dirtyFieldCount === 0 || isSaving} onClick={() => setConfirmDialog("save")}>
  {t("database.save_changes")}
</button>
<button type="button" disabled={dirtyFieldCount === 0 || isSaving} onClick={() => setConfirmDialog("discard")}>
  {t("database.discard_changes")}
</button>
```

Render confirm dialogs using existing `connection-dialog__backdrop` / `database-dialog` classes. Buttons should be `取消` and `确认`.

- [ ] **Step 4: Guard paging/sort/filter/refresh**

Add helper:

```ts
function runAfterDiscardConfirmation(action: () => void) {
  if (dirtyFieldCount === 0) {
    action();
    return;
  }
  setPendingAction(() => action);
  setConfirmDialog("discard");
}
```

Add state:

```ts
const [pendingAction, setPendingAction] = useState<(() => void) | null>(null);
```

Wrap these actions with `runAfterDiscardConfirmation`:

- `applyFilter`
- `applyPageInput`
- `applyPageSizeInput`
- `toggleSort`
- `goToPage`
- refresh button

When discard confirm is accepted:

```ts
setDirtyRows({});
setConfirmDialog(null);
const action = pendingAction;
setPendingAction(null);
action?.();
```

- [ ] **Step 5: Run frontend test**

Run:

```powershell
pnpm test -- src/features/database/DatabaseWorkspace.test.tsx
```

Expected: pass.

---

### Task 6: Full verification and docs

**Files:**
- Modify: `README.md`
- Modify: `docs/当前状态与下一步.md`

- [ ] **Step 1: Update README**

In `README.md`, update the database section bullet that describes table browsing to mention:

```markdown
- 双击表或视图会打开表数据浏览模式；有主键的普通表支持编辑已有行并确认保存，无主键表和视图保持只读。
```

- [ ] **Step 2: Update current status doc**

In `docs/当前状态与下一步.md`, update database status with:

```markdown
- 表数据浏览模式支持有主键普通表的已有行单元格编辑，保存前确认，保存后刷新当前页；无主键表和视图只读。
```

- [ ] **Step 3: Run full frontend verification**

Run:

```powershell
pnpm test
pnpm exec tsc --noEmit
```

Expected: all tests pass and TypeScript has exit code 0.

- [ ] **Step 4: Run Rust verification**

Run:

```powershell
cargo test --manifest-path src-tauri/Cargo.toml
```

Expected: all Rust tests pass.

- [ ] **Step 5: Run diff check**

Run:

```powershell
git diff --check
```

Expected: no output and exit code 0.

- [ ] **Step 6: Commit implementation**

Run:

```powershell
git status --short
git add src-tauri/src/models/database.rs src-tauri/src/db/query.rs src-tauri/src/commands/database.rs src-tauri/src/lib.rs src-tauri/src/tests/database_query_tests.rs src/features/database/databaseTypes.ts src/features/database/DatabaseTableBrowser.tsx src/features/database/DatabaseWorkspace.test.tsx src/i18n/locales/zh-CN.ts src/i18n/locales/en-US.ts src/styles/globals.css README.md docs/当前状态与下一步.md
git commit -m "feat(database): 支持表数据编辑"
```

Expected: commit succeeds.

---

## Self-Review

- Spec coverage: 主键识别、无主键只读、视图只读、单元格编辑、保存确认、保存后刷新、分页/排序/筛选前确认、MySQL/PostgreSQL 更新 SQL、测试和文档均有任务覆盖。
- Vague-step scan: no deferred implementation steps or incomplete sections.
- Type consistency: Rust `UpdateDatabaseTableRowsRequest` / TS `UpdateDatabaseTableRowsRequest` / command `update_database_table_rows` naming is consistent across tasks.
