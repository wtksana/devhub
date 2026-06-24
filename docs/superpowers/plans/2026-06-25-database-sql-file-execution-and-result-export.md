# Database SQL File Execution And Result Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 支持选择本地 SQL 文件预览并确认执行，同时支持把当前数据库查询结果导出为 CSV 或批量 INSERT SQL 文件。

**Architecture:** 后端新增独立 `src-tauri/src/db/export.rs` 和 `src-tauri/src/db/sql_file.rs`，分别负责结果导出和 SQL 文件预览/执行，Tauri command 层只做配置加载、日志和调用编排。前端复用 `DatabaseWorkspace` 与 `DatabaseTableBrowser` 的现有结果状态，新增文件对话框封装、图标按钮、预览确认弹窗和导出菜单。

**Tech Stack:** Tauri 2、React、Vitest、Rust、sqlx、Tauri Dialog plugin、现有 `DatabaseCellValue` / `DatabaseResultColumn` 数据模型。

---

## File Structure

- Create: `src-tauri/src/db/export.rs`
  - 纯函数为主：CSV 生成、INSERT SQL 生成、文件写出、默认表名校验。
- Create: `src-tauri/src/db/sql_file.rs`
  - SQL 文件预览、危险关键词扫描、轻量 SQL splitter、顺序执行 SQL 文件。
- Modify: `src-tauri/src/db/mod.rs`
  - 导出新模块。
- Modify: `src-tauri/src/models/database.rs`
  - 新增 SQL 文件预览/执行和结果导出请求/响应模型。
- Modify: `src-tauri/src/commands/database.rs`
  - 新增 `preview_database_sql_file`、`execute_database_sql_file`、`export_database_result` command 和日志。
- Modify: `src-tauri/src/lib.rs`
  - 注册新 commands。
- Modify: `src/lib/fileDialog.ts`
  - 新增 `pickSqlFile()`、`pickDatabaseExportPath(defaultPath, extension)`。
- Add assets:
  - `src/assets/icons/tabler--file-import.svg`
  - `src/assets/icons/mdi--table-export.svg`
- Modify: `src/features/database/databaseTypes.ts`
  - 新增前端类型。
- Modify: `src/features/database/DatabaseWorkspace.tsx`
  - SQL 文件执行按钮、预览弹窗、自由查询结果导出。
- Modify: `src/features/database/DatabaseTableBrowser.tsx`
  - 表数据浏览结果导出按钮。
- Modify: `src/features/database/DatabaseDataGrid.tsx`
  - 暴露导出工具栏插槽或 footer 附加区域，避免复制两套表格逻辑。
- Modify: `src/i18n/locales/zh-CN.ts` and `src/i18n/locales/en-US.ts`
  - 新增文案。
- Modify tests:
  - `src/features/database/DatabaseWorkspace.test.tsx`
  - `src/features/database/DatabaseDataGrid.test.tsx` if needed; prefer existing workspace tests first.
  - Rust module tests in `src-tauri/src/db/export.rs` and `src-tauri/src/db/sql_file.rs`.

---

### Task 1: 后端导出模型与纯函数

**Files:**
- Modify: `src-tauri/src/models/database.rs`
- Create: `src-tauri/src/db/export.rs`
- Modify: `src-tauri/src/db/mod.rs`

- [ ] **Step 1: Write failing Rust tests for CSV and INSERT SQL export**

Add this module test content at the bottom of new `src-tauri/src/db/export.rs` after creating the file:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::database::{DatabaseCellValue, DatabaseResultColumn};

    fn columns() -> Vec<DatabaseResultColumn> {
        vec![
            DatabaseResultColumn {
                name: "id".to_string(),
                data_type: "INT".to_string(),
                nullable: None,
                has_default: None,
                generated: None,
            },
            DatabaseResultColumn {
                name: "name".to_string(),
                data_type: "VARCHAR".to_string(),
                nullable: None,
                has_default: None,
                generated: None,
            },
            DatabaseResultColumn {
                name: "active".to_string(),
                data_type: "BOOL".to_string(),
                nullable: None,
                has_default: None,
                generated: None,
            },
        ]
    }

    fn rows() -> Vec<Vec<DatabaseCellValue>> {
        vec![
            vec![
                DatabaseCellValue::Number { value: "1".to_string() },
                DatabaseCellValue::Text { value: "Alice, \"A\"".to_string() },
                DatabaseCellValue::Bool { value: true },
            ],
            vec![
                DatabaseCellValue::Number { value: "2".to_string() },
                DatabaseCellValue::Null,
                DatabaseCellValue::Bool { value: false },
            ],
        ]
    }

    #[test]
    fn exports_csv_with_header_and_escaped_values() {
        let csv = build_csv(&columns(), &rows()).expect("csv");

        assert_eq!(
            csv,
            "id,name,active\n1,\"Alice, \"\"A\"\"\",true\n2,,false\n"
        );
    }

    #[test]
    fn exports_mysql_insert_sql_with_escaped_values() {
        let sql = build_insert_sql("mysql", "users", &columns(), &rows()).expect("insert sql");

        assert_eq!(
            sql,
            "INSERT INTO `users` (`id`, `name`, `active`) VALUES\n  (1, 'Alice, ''A''', 1),\n  (2, NULL, 0);\n"
        );
    }

    #[test]
    fn exports_postgresql_insert_sql_with_bool_literals() {
        let sql = build_insert_sql("postgresql", "users", &columns(), &rows()).expect("insert sql");

        assert_eq!(
            sql,
            "INSERT INTO \"users\" (\"id\", \"name\", \"active\") VALUES\n  (1, 'Alice, ''A''', TRUE),\n  (2, NULL, FALSE);\n"
        );
    }
}
```

- [ ] **Step 2: Run the new Rust tests and verify they fail**

Run:

```powershell
cargo test --manifest-path src-tauri\Cargo.toml db::export
```

Expected: compilation fails because `src-tauri/src/db/export.rs`, `build_csv`, or `build_insert_sql` does not exist yet.

- [ ] **Step 3: Add database export request/response models**

In `src-tauri/src/models/database.rs`, add:

```rust
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
    pub columns: Vec<DatabaseResultColumn>,
    pub rows: Vec<Vec<DatabaseCellValue>>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct DatabaseResultExportResult {
    pub exported_rows: u64,
    pub duration_ms: u128,
}
```

Because `ExportDatabaseResultRequest` deserializes `DatabaseResultColumn`, update `DatabaseResultColumn` derive to include `Deserialize`:

```rust
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct DatabaseResultColumn {
```

- [ ] **Step 4: Implement export helper module**

Create `src-tauri/src/db/export.rs`:

```rust
use std::fs;
use std::path::Path;

use crate::db::query::quote_identifier;
use crate::models::database::{DatabaseCellValue, DatabaseResultColumn, DatabaseResultExportFormat};

const INSERT_BATCH_SIZE: usize = 500;

pub fn export_database_result(
    kind: &str,
    table: Option<&str>,
    path: &str,
    format: &DatabaseResultExportFormat,
    columns: &[DatabaseResultColumn],
    rows: &[Vec<DatabaseCellValue>],
) -> Result<u64, String> {
    let content = match format {
        DatabaseResultExportFormat::Csv => build_csv(columns, rows)?,
        DatabaseResultExportFormat::InsertSql => {
            let table = table
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .ok_or_else(|| "table name is required for INSERT SQL export".to_string())?;
            build_insert_sql(kind, table, columns, rows)?
        }
    };
    write_text_file(path, &content)?;
    Ok(rows.len() as u64)
}

pub fn build_csv(columns: &[DatabaseResultColumn], rows: &[Vec<DatabaseCellValue>]) -> Result<String, String> {
    if columns.is_empty() {
        return Err("columns are required".to_string());
    }
    let mut output = String::new();
    output.push_str(&columns.iter().map(|column| csv_escape(&column.name)).collect::<Vec<_>>().join(","));
    output.push('\n');
    for row in rows {
        let values = columns
            .iter()
            .enumerate()
            .map(|(index, _)| csv_escape(&cell_to_csv(row.get(index))))
            .collect::<Vec<_>>();
        output.push_str(&values.join(","));
        output.push('\n');
    }
    Ok(output)
}

pub fn build_insert_sql(
    kind: &str,
    table: &str,
    columns: &[DatabaseResultColumn],
    rows: &[Vec<DatabaseCellValue>],
) -> Result<String, String> {
    if columns.is_empty() {
        return Err("columns are required".to_string());
    }
    let quoted_table = quote_identifier(kind, table)?;
    let quoted_columns = columns
        .iter()
        .map(|column| quote_identifier(kind, &column.name))
        .collect::<Result<Vec<_>, _>>()?
        .join(", ");
    let mut output = String::new();

    for chunk in rows.chunks(INSERT_BATCH_SIZE) {
        if chunk.is_empty() {
            continue;
        }
        output.push_str(&format!("INSERT INTO {quoted_table} ({quoted_columns}) VALUES\n"));
        for (row_index, row) in chunk.iter().enumerate() {
            let values = columns
                .iter()
                .enumerate()
                .map(|(index, _)| cell_to_sql(kind, row.get(index)))
                .collect::<Vec<_>>()
                .join(", ");
            let suffix = if row_index + 1 == chunk.len() { ";\n" } else { "," };
            output.push_str(&format!("  ({values}){suffix}"));
            if row_index + 1 != chunk.len() {
                output.push('\n');
            }
        }
    }
    Ok(output)
}

fn write_text_file(path: &str, content: &str) -> Result<(), String> {
    let path = Path::new(path);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    fs::write(path, content).map_err(|error| error.to_string())
}

fn cell_to_csv(cell: Option<&DatabaseCellValue>) -> String {
    match cell {
        Some(DatabaseCellValue::Null) | None => String::new(),
        Some(DatabaseCellValue::Text { value }) | Some(DatabaseCellValue::Number { value }) => value.clone(),
        Some(DatabaseCellValue::Bool { value }) => value.to_string(),
    }
}

fn csv_escape(value: &str) -> String {
    if value.contains(',') || value.contains('"') || value.contains('\n') || value.contains('\r') {
        format!("\"{}\"", value.replace('"', "\"\""))
    } else {
        value.to_string()
    }
}

fn cell_to_sql(kind: &str, cell: Option<&DatabaseCellValue>) -> String {
    match cell {
        Some(DatabaseCellValue::Null) | None => "NULL".to_string(),
        Some(DatabaseCellValue::Number { value }) => value.clone(),
        Some(DatabaseCellValue::Text { value }) => format!("'{}'", value.replace('\'', "''")),
        Some(DatabaseCellValue::Bool { value }) => match (kind, value) {
            ("postgresql", true) => "TRUE".to_string(),
            ("postgresql", false) => "FALSE".to_string(),
            (_, true) => "1".to_string(),
            (_, false) => "0".to_string(),
        },
    }
}
```

Modify `src-tauri/src/db/mod.rs`:

```rust
pub mod export;
```

- [ ] **Step 5: Run export tests and verify they pass**

Run:

```powershell
cargo test --manifest-path src-tauri\Cargo.toml db::export
```

Expected: all `db::export` tests pass.

---

### Task 2: 后端 SQL 文件预览、拆分和执行

**Files:**
- Create: `src-tauri/src/db/sql_file.rs`
- Modify: `src-tauri/src/db/mod.rs`
- Modify: `src-tauri/src/models/database.rs`
- Modify: `src-tauri/src/db/query.rs`

- [ ] **Step 1: Write failing tests for SQL splitter and preview helpers**

Create `src-tauri/src/db/sql_file.rs` with this test module first:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn splits_sql_without_breaking_strings_or_comments() {
        let statements = split_sql_statements(
            "select ';' as semi; -- ignored ;\ninsert into t values ('a; b'); /* ignored ; */ update t set name = \"x;y\";",
        )
        .expect("statements");

        assert_eq!(statements, vec![
            "select ';' as semi",
            "insert into t values ('a; b')",
            "update t set name = \"x;y\"",
        ]);
    }

    #[test]
    fn previews_first_lines_and_detects_dangerous_keywords() {
        let path = std::env::temp_dir().join("devhub-preview-dangerous.sql");
        fs::write(&path, "select 1;\nupdate users set name = 'x';\nselect 2;").expect("write");

        let preview = preview_sql_file(path.to_str().expect("path")).expect("preview");

        assert_eq!(preview.file_name, "devhub-preview-dangerous.sql");
        assert!(preview.preview.contains("select 1;"));
        assert_eq!(preview.estimated_statement_count, 3);
        assert!(preview.dangerous);

        let _ = fs::remove_file(path);
    }
}
```

- [ ] **Step 2: Run tests and verify they fail**

Run:

```powershell
cargo test --manifest-path src-tauri\Cargo.toml db::sql_file
```

Expected: compile failure because SQL file models/helpers do not exist.

- [ ] **Step 3: Add SQL file models**

In `src-tauri/src/models/database.rs`, add:

```rust
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
```

- [ ] **Step 4: Add raw SQL execution helper in query module**

In `src-tauri/src/db/query.rs`, add:

```rust
pub async fn execute_database_statement(
    manager: &DatabaseConnectionManager,
    connection: &DatabaseConnectionSettings,
    database: &str,
    sql: &str,
) -> Result<u64, String> {
    match connection.kind.as_str() {
        "mysql" => {
            let DatabasePool::Mysql(pool) = manager.pool(connection, Some(database)).await? else {
                return Err("database pool kind mismatch".to_string());
            };
            let mut connection = pool.acquire().await.map_err(|error| error.to_string())?;
            sqlx::query(sql)
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
            sqlx::query(sql)
                .execute(&mut *connection)
                .await
                .map(|result| result.rows_affected())
                .map_err(|error| error.to_string())
        }
        kind => Err(format!("unsupported database connection kind: {kind}")),
    }
}
```

- [ ] **Step 5: Implement SQL file helpers**

Replace `src-tauri/src/db/sql_file.rs` contents above the tests with:

```rust
use std::fs;
use std::path::Path;
use std::time::Instant;

use crate::db::connection::DatabaseConnectionManager;
use crate::db::query;
use crate::models::database::{DatabaseSqlFileExecutionResult, DatabaseSqlFilePreview};
use crate::models::settings::DatabaseConnectionSettings;

const PREVIEW_MAX_LINES: usize = 200;
const PREVIEW_MAX_BYTES: usize = 64 * 1024;
const DANGEROUS_KEYWORDS: &[&str] = &["drop", "truncate", "delete", "update", "alter"];

pub fn preview_sql_file(path: &str) -> Result<DatabaseSqlFilePreview, String> {
    let metadata = fs::metadata(path).map_err(|error| error.to_string())?;
    let bytes = fs::read(path).map_err(|error| error.to_string())?;
    let preview_bytes = &bytes[..bytes.len().min(PREVIEW_MAX_BYTES)];
    let preview_text = String::from_utf8_lossy(preview_bytes);
    let preview = preview_text
        .lines()
        .take(PREVIEW_MAX_LINES)
        .collect::<Vec<_>>()
        .join("\n");
    let full_text = String::from_utf8_lossy(&bytes);
    let statements = split_sql_statements(&full_text)?;
    let dangerous = statements.iter().any(|statement| contains_dangerous_keyword(statement));
    let file_name = Path::new(path)
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or(path)
        .to_string();

    Ok(DatabaseSqlFilePreview {
        path: path.to_string(),
        file_name,
        size_bytes: metadata.len(),
        preview,
        estimated_statement_count: statements.len() as u64,
        dangerous,
    })
}

pub async fn execute_sql_file(
    manager: &DatabaseConnectionManager,
    connection: &DatabaseConnectionSettings,
    database: &str,
    path: &str,
) -> Result<DatabaseSqlFileExecutionResult, String> {
    let content = fs::read_to_string(path).map_err(|error| error.to_string())?;
    let statements = split_sql_statements(&content)?;
    let started_at = Instant::now();
    let mut affected_rows = 0;

    for (index, statement) in statements.iter().enumerate() {
        match query::execute_database_statement(manager, connection, database, statement).await {
            Ok(rows) => affected_rows += rows,
            Err(error) => {
                return Err(format!(
                    "statement {} failed: {}: {}",
                    index + 1,
                    statement_preview(statement),
                    error
                ));
            }
        }
    }

    Ok(DatabaseSqlFileExecutionResult {
        executed_statements: statements.len() as u64,
        affected_rows,
        duration_ms: started_at.elapsed().as_millis(),
        failed_statement_index: None,
        failed_statement_preview: None,
    })
}

pub fn split_sql_statements(sql: &str) -> Result<Vec<String>, String> {
    let mut statements = Vec::new();
    let mut current = String::new();
    let mut chars = sql.chars().peekable();
    let mut quote: Option<char> = None;
    let mut in_line_comment = false;
    let mut in_block_comment = false;

    while let Some(ch) = chars.next() {
        if in_line_comment {
            current.push(ch);
            if ch == '\n' {
                in_line_comment = false;
            }
            continue;
        }
        if in_block_comment {
            current.push(ch);
            if ch == '*' && chars.peek() == Some(&'/') {
                current.push('/');
                let _ = chars.next();
                in_block_comment = false;
            }
            continue;
        }
        if let Some(quote_char) = quote {
            current.push(ch);
            if ch == quote_char {
                if chars.peek() == Some(&quote_char) {
                    current.push(quote_char);
                    let _ = chars.next();
                } else {
                    quote = None;
                }
            }
            continue;
        }
        if ch == '-' && chars.peek() == Some(&'-') {
            current.push(ch);
            current.push('-');
            let _ = chars.next();
            in_line_comment = true;
            continue;
        }
        if ch == '/' && chars.peek() == Some(&'*') {
            current.push(ch);
            current.push('*');
            let _ = chars.next();
            in_block_comment = true;
            continue;
        }
        if matches!(ch, '\'' | '"' | '`') {
            quote = Some(ch);
            current.push(ch);
            continue;
        }
        if ch == ';' {
            let statement = current.trim();
            if !statement.is_empty() {
                statements.push(statement.to_string());
            }
            current.clear();
            continue;
        }
        current.push(ch);
    }

    if quote.is_some() || in_block_comment {
        return Err("unterminated SQL string or block comment".to_string());
    }
    let statement = current.trim();
    if !statement.is_empty() {
        statements.push(statement.to_string());
    }
    Ok(statements)
}

fn contains_dangerous_keyword(statement: &str) -> bool {
    statement
        .split(|ch: char| !ch.is_ascii_alphanumeric() && ch != '_')
        .any(|word| DANGEROUS_KEYWORDS.iter().any(|keyword| word.eq_ignore_ascii_case(keyword)))
}

fn statement_preview(statement: &str) -> String {
    let compact = statement.split_whitespace().collect::<Vec<_>>().join(" ");
    if compact.chars().count() <= 160 {
        compact
    } else {
        format!("{}...", compact.chars().take(160).collect::<String>())
    }
}
```

Modify `src-tauri/src/db/mod.rs`:

```rust
pub mod sql_file;
```

- [ ] **Step 6: Run SQL file tests and verify they pass**

Run:

```powershell
cargo test --manifest-path src-tauri\Cargo.toml db::sql_file
```

Expected: all `db::sql_file` tests pass.

---

### Task 3: Tauri commands and operation logging

**Files:**
- Modify: `src-tauri/src/commands/database.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Write command-level log target tests**

In the existing `#[cfg(test)] mod tests` in `src-tauri/src/commands/database.rs`, add:

```rust
#[test]
fn builds_database_file_targets() {
    assert_eq!(
        database_file_target("mysql-local", "app", "C:\\tmp\\seed.sql"),
        "mysql-local:app:seed.sql"
    );
    assert_eq!(
        database_export_target("mysql-local", "app", Some("users"), "C:\\tmp\\users.csv"),
        "mysql-local:app:users:users.csv"
    );
}
```

- [ ] **Step 2: Run command tests and verify failure**

Run:

```powershell
cargo test --manifest-path src-tauri\Cargo.toml commands::database::tests::builds_database_file_targets
```

Expected: compile failure because helper functions do not exist.

- [ ] **Step 3: Import new models and helpers**

In `src-tauri/src/commands/database.rs`, extend imports:

```rust
use crate::db::{export as database_export, sql_file};
```

Add imported models:

```rust
DatabaseResultExportResult, DatabaseSqlFileExecutionResult, DatabaseSqlFilePreview,
ExecuteDatabaseSqlFileRequest, ExportDatabaseResultRequest, PreviewDatabaseSqlFileRequest,
```

- [ ] **Step 4: Add commands**

In `src-tauri/src/commands/database.rs`, add:

```rust
#[tauri::command]
pub fn preview_database_sql_file(
    settings_store: State<'_, SettingsStore>,
    logger: State<'_, AppLogger>,
    request: PreviewDatabaseSqlFileRequest,
) -> Result<DatabaseSqlFilePreview, String> {
    let started_at = std::time::Instant::now();
    let target = database_file_target(&request.connection_id, &request.database, &request.path);
    let result = sql_file::preview_sql_file(&request.path);
    log_database_result(
        settings_store.inner(),
        logger.inner(),
        "preview_database_sql_file",
        target,
        started_at,
        &result,
        Some(database_file_metadata(&request.database, &request.path)),
    );
    result
}

#[tauri::command]
pub async fn execute_database_sql_file(
    settings_store: State<'_, SettingsStore>,
    database_manager: State<'_, DatabaseConnectionManager>,
    logger: State<'_, AppLogger>,
    request: ExecuteDatabaseSqlFileRequest,
) -> Result<DatabaseSqlFileExecutionResult, String> {
    let started_at = std::time::Instant::now();
    let target = database_file_target(&request.connection_id, &request.database, &request.path);
    let connection = load_database_connection(settings_store.inner(), &request.connection_id)?;
    let result = sql_file::execute_sql_file(database_manager.inner(), &connection, &request.database, &request.path).await;
    log_database_result(
        settings_store.inner(),
        logger.inner(),
        "execute_database_sql_file",
        target,
        started_at,
        &result,
        Some(database_file_metadata(&request.database, &request.path)),
    );
    result
}

#[tauri::command]
pub fn export_database_result(
    settings_store: State<'_, SettingsStore>,
    logger: State<'_, AppLogger>,
    request: ExportDatabaseResultRequest,
) -> Result<DatabaseResultExportResult, String> {
    let started_at = std::time::Instant::now();
    let target = database_export_target(
        &request.connection_id,
        &request.database,
        request.table.as_deref(),
        &request.path,
    );
    let connection = load_database_connection(settings_store.inner(), &request.connection_id)?;
    let row_count = database_export::export_database_result(
        &connection.kind,
        request.table.as_deref(),
        &request.path,
        &request.format,
        &request.columns,
        &request.rows,
    );
    let result = row_count.map(|exported_rows| DatabaseResultExportResult {
        exported_rows,
        duration_ms: started_at.elapsed().as_millis(),
    });
    log_database_result(
        settings_store.inner(),
        logger.inner(),
        "export_database_result",
        target,
        started_at,
        &result,
        Some(database_export_metadata(&request.database, request.table.as_deref(), &request.path, request.rows.len() as i64)),
    );
    result
}
```

- [ ] **Step 5: Add command helper functions**

In `src-tauri/src/commands/database.rs`, near existing target helpers, add:

```rust
fn database_file_target(connection_id: &str, database: &str, path: &str) -> String {
    format!("{connection_id}:{database}:{}", file_name(path))
}

fn database_export_target(connection_id: &str, database: &str, table: Option<&str>, path: &str) -> String {
    match table {
        Some(table) if !table.is_empty() => format!("{connection_id}:{database}:{table}:{}", file_name(path)),
        _ => format!("{connection_id}:{database}:{}", file_name(path)),
    }
}

fn database_file_metadata(database: &str, path: &str) -> serde_json::Map<String, serde_json::Value> {
    metadata([
        ("database", metadata_string(database.to_string())),
        ("file", metadata_string(file_name(path))),
    ])
}

fn database_export_metadata(database: &str, table: Option<&str>, path: &str, row_count: i64) -> serde_json::Map<String, serde_json::Value> {
    let mut items = vec![
        ("database", metadata_string(database.to_string())),
        ("file", metadata_string(file_name(path))),
        ("row_count", metadata_number(row_count)),
    ];
    if let Some(table) = table.filter(|value| !value.is_empty()) {
        items.push(("table", metadata_string(table.to_string())));
    }
    metadata(items)
}

fn file_name(path: &str) -> String {
    std::path::Path::new(path)
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or(path)
        .to_string()
}
```

- [ ] **Step 6: Register commands**

In `src-tauri/src/lib.rs`, add to `invoke_handler`:

```rust
commands::database::preview_database_sql_file,
commands::database::execute_database_sql_file,
commands::database::export_database_result,
```

- [ ] **Step 7: Run backend command tests**

Run:

```powershell
cargo test --manifest-path src-tauri\Cargo.toml commands::database::tests::builds_database_file_targets
cargo test --manifest-path src-tauri\Cargo.toml db::export db::sql_file
```

Expected: target helper and db module tests pass.

---

### Task 4: 前端文件对话框、类型和图标资产

**Files:**
- Modify: `src/lib/fileDialog.ts`
- Modify: `src/features/database/databaseTypes.ts`
- Create: `src/assets/icons/tabler--file-import.svg`
- Create: `src/assets/icons/mdi--table-export.svg`

- [ ] **Step 1: Add file dialog helpers**

In `src/lib/fileDialog.ts`, add:

```ts
export async function pickSqlFile() {
  const selected = await open({
    multiple: false,
    directory: false,
    filters: [{ name: "SQL", extensions: ["sql"] }],
  });
  return typeof selected === "string" ? selected : null;
}

export async function pickDatabaseExportPath(defaultPath: string, extension: "csv" | "sql") {
  const selected = await save({
    defaultPath,
    filters: [{ name: extension.toUpperCase(), extensions: [extension] }],
  });
  return typeof selected === "string" ? selected : null;
}
```

- [ ] **Step 2: Add frontend database types**

In `src/features/database/databaseTypes.ts`, add:

```ts
export interface DatabaseSqlFilePreview {
  path: string;
  file_name: string;
  size_bytes: number;
  preview: string;
  estimated_statement_count: number;
  dangerous: boolean;
}

export interface DatabaseSqlFileExecutionResult {
  executed_statements: number;
  affected_rows: number;
  duration_ms: number;
  failed_statement_index?: number | null;
  failed_statement_preview?: string | null;
}

export type DatabaseResultExportFormat = "csv" | "insert_sql";

export interface DatabaseResultExportResult {
  exported_rows: number;
  duration_ms: number;
}
```

- [ ] **Step 3: Add SVG icon assets**

Create `src/assets/icons/tabler--file-import.svg` with Iconify `tabler:file-import` SVG using `currentColor`.

Create `src/assets/icons/mdi--table-export.svg` with Iconify `mdi:table-export` SVG using `currentColor`.

If network is unavailable, use these exact SVG contents:

`src/assets/icons/tabler--file-import.svg`:

```svg
<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14 3v4a1 1 0 0 0 1 1h4M5 13V5a2 2 0 0 1 2-2h7l5 5v5M12 21v-8m-3 3l3-3l3 3m-6 5h6"/></svg>
```

`src/assets/icons/mdi--table-export.svg`:

```svg
<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path fill="currentColor" d="M21 3H3c-1.11 0-2 .89-2 2v12a2 2 0 0 0 2 2h8v-2H3v-4h8v-2H3V7h18v4h-4v2h4v4h-4v2h4a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2m-6 9l-4 4h3v6h2v-6h3z"/></svg>
```

- [ ] **Step 4: Run a focused frontend type check through tests**

Run:

```powershell
pnpm test -- src/features/database/DatabaseWorkspace.test.tsx -t "toggles the SQL editor visibility"
```

Expected: existing test still passes.

---

### Task 5: SQL 文件执行 UI

**Files:**
- Modify: `src/features/database/DatabaseWorkspace.tsx`
- Modify: `src/features/database/DatabaseWorkspace.test.tsx`
- Modify: `src/i18n/locales/zh-CN.ts`
- Modify: `src/i18n/locales/en-US.ts`

- [ ] **Step 1: Write failing UI test for SQL file preview and execution**

In `src/features/database/DatabaseWorkspace.test.tsx`, extend `vi.mock("../../lib/fileDialog"...` or add one if absent:

```ts
vi.mock("../../lib/fileDialog", () => ({
  pickSqlFile: vi.fn(),
  pickDatabaseExportPath: vi.fn(),
}));
```

Import mocks:

```ts
import { pickSqlFile, pickDatabaseExportPath } from "../../lib/fileDialog";
const pickSqlFileMock = vi.mocked(pickSqlFile);
const pickDatabaseExportPathMock = vi.mocked(pickDatabaseExportPath);
```

Add test:

```ts
it("previews and executes a selected SQL file", async () => {
  pickSqlFileMock.mockResolvedValue("C:\\tmp\\seed.sql");
  callBackendMock.mockImplementation((command) => {
    if (command === "preview_database_sql_file") {
      return Promise.resolve({
        path: "C:\\tmp\\seed.sql",
        file_name: "seed.sql",
        size_bytes: 42,
        preview: "insert into users(id, name) values (1, 'Alice');",
        estimated_statement_count: 1,
        dangerous: true,
      });
    }
    if (command === "execute_database_sql_file") {
      return Promise.resolve({
        executed_statements: 1,
        affected_rows: 1,
        duration_ms: 12,
      });
    }
    if (command === "list_database_sql_files") {
      return Promise.resolve([{ name: "default", content: "" }]);
    }
    return Promise.resolve([]);
  });

  renderDatabaseWorkspace("app");

  await userEvent.click(await screen.findByRole("button", { name: "执行 SQL 文件" }));

  expect(pickSqlFileMock).toHaveBeenCalledTimes(1);
  expect(callBackendMock).toHaveBeenCalledWith("preview_database_sql_file", {
    request: {
      connection_id: "mysql-dev",
      database: "app",
      path: "C:\\tmp\\seed.sql",
    },
  });
  const dialog = await screen.findByRole("dialog", { name: "执行 SQL 文件" });
  expect(dialog).toHaveTextContent("seed.sql");
  expect(dialog).toHaveTextContent("42 B");
  expect(dialog).toHaveTextContent("1");
  expect(dialog).toHaveTextContent("insert into users");
  expect(dialog).toHaveTextContent("检测到危险 SQL 关键词");

  await userEvent.click(within(dialog).getByRole("button", { name: "执行" }));

  expect(callBackendMock).toHaveBeenCalledWith("execute_database_sql_file", {
    request: {
      connection_id: "mysql-dev",
      database: "app",
      path: "C:\\tmp\\seed.sql",
    },
  });
  expect(await screen.findByText("执行完成：1 条语句，影响 1 行，耗时 12 ms")).toBeInTheDocument();
});
```

- [ ] **Step 2: Run test and verify failure**

Run:

```powershell
pnpm test -- src/features/database/DatabaseWorkspace.test.tsx -t "previews and executes a selected SQL file"
```

Expected: fails because button/dialog are missing.

- [ ] **Step 3: Add i18n keys**

In `src/i18n/locales/zh-CN.ts`, add:

```ts
"database.execute_sql_file": "执行 SQL 文件",
"database.sql_file_execute": "执行",
"database.sql_file_preview_size": "{{size}} B",
"database.sql_file_preview_statements": "{{count}} 条语句",
"database.sql_file_dangerous": "检测到危险 SQL 关键词",
"database.sql_file_execute_hint": "执行前请确认已选择正确数据库。",
"database.sql_file_execute_summary": "执行完成：{{statements}} 条语句，影响 {{affected}} 行，耗时 {{duration}} ms",
```

In `src/i18n/locales/en-US.ts`, add equivalent English keys.

- [ ] **Step 4: Implement SQL file button and dialog**

In `src/features/database/DatabaseWorkspace.tsx`:

Add imports:

```ts
import ExecuteSqlFileIcon from "../../assets/icons/tabler--file-import.svg?react";
import { pickSqlFile } from "../../lib/fileDialog";
import type { DatabaseSqlFileExecutionResult, DatabaseSqlFilePreview } from "./databaseTypes";
```

Add state:

```ts
const [sqlFilePreview, setSqlFilePreview] = useState<DatabaseSqlFilePreview | null>(null);
const [sqlFileMessage, setSqlFileMessage] = useState("");
const [isSqlFileExecuting, setIsSqlFileExecuting] = useState(false);
```

Add functions:

```ts
async function openSqlFilePreview() {
  if (!currentDatabase) {
    setError(t("database.database_required"));
    return;
  }
  const path = await pickSqlFile();
  if (!path) return;
  try {
    const preview = await callBackend<DatabaseSqlFilePreview>("preview_database_sql_file", {
      request: { connection_id: connectionId, database: currentDatabase, path },
    });
    setSqlFilePreview(preview);
  } catch (caught) {
    setError(caught instanceof Error ? caught.message : String(caught));
  }
}

async function executeSqlFile() {
  if (!sqlFilePreview || !currentDatabase) return;
  setIsSqlFileExecuting(true);
  try {
    const execution = await callBackend<DatabaseSqlFileExecutionResult>("execute_database_sql_file", {
      request: { connection_id: connectionId, database: currentDatabase, path: sqlFilePreview.path },
    });
    setSqlFilePreview(null);
    setSqlFileMessage(t("database.sql_file_execute_summary", {
      statements: execution.executed_statements,
      affected: execution.affected_rows,
      duration: execution.duration_ms,
    }));
  } catch (caught) {
    setError(caught instanceof Error ? caught.message : String(caught));
  } finally {
    setIsSqlFileExecuting(false);
  }
}
```

Add button in the SQL editor toolbar before Monaco support:

```tsx
<button
  type="button"
  className="database-icon-button"
  aria-label={t("database.execute_sql_file")}
  title={t("database.execute_sql_file")}
  onClick={() => void openSqlFilePreview()}
>
  <AppIcon icon={ExecuteSqlFileIcon} decorative />
</button>
```

Render `sqlFileMessage` near the error message:

```tsx
{sqlFileMessage ? <p className="database-query-panel__status" role="status">{sqlFileMessage}</p> : null}
```

Render dialog near other dialogs:

```tsx
{sqlFilePreview ? (
  <div className="connection-dialog__backdrop">
    <div className="connection-dialog database-dialog database-sql-file-execute-dialog" role="dialog" aria-modal="true" aria-label={t("database.execute_sql_file")}>
      <header className="database-dialog__header">
        <h2>{t("database.execute_sql_file")}</h2>
      </header>
      <div className="database-sql-file-execute-dialog__body">
        <p>{sqlFilePreview.file_name}</p>
        <p>{t("database.sql_file_preview_size", { size: sqlFilePreview.size_bytes })}</p>
        <p>{t("database.sql_file_preview_statements", { count: sqlFilePreview.estimated_statement_count })}</p>
        <p>{t("database.sql_file_execute_hint")}</p>
        {sqlFilePreview.dangerous ? <p role="alert">{t("database.sql_file_dangerous")}</p> : null}
        <pre>{sqlFilePreview.preview}</pre>
      </div>
      <div className="database-dialog__actions">
        <button type="button" onClick={() => setSqlFilePreview(null)}>{t("database.cancel")}</button>
        <button type="button" className="sftp-dialog__danger-button" disabled={isSqlFileExecuting} onClick={() => void executeSqlFile()}>
          {t("database.sql_file_execute")}
        </button>
      </div>
    </div>
  </div>
) : null}
```

- [ ] **Step 5: Run SQL file UI test**

Run:

```powershell
pnpm test -- src/features/database/DatabaseWorkspace.test.tsx -t "previews and executes a selected SQL file"
```

Expected: test passes.

---

### Task 6: 查询结果导出 UI

**Files:**
- Modify: `src/features/database/DatabaseWorkspace.tsx`
- Modify: `src/features/database/DatabaseTableBrowser.tsx`
- Modify: `src/features/database/DatabaseDataGrid.tsx`
- Modify: `src/features/database/DatabaseWorkspace.test.tsx`
- Modify: `src/i18n/locales/zh-CN.ts`
- Modify: `src/i18n/locales/en-US.ts`

- [ ] **Step 1: Write failing tests for CSV export and INSERT SQL table-name prompt**

Add tests in `src/features/database/DatabaseWorkspace.test.tsx`:

```ts
it("exports the current query result to CSV", async () => {
  pickDatabaseExportPathMock.mockResolvedValue("C:\\tmp\\app.users.20260625093000.csv");
  callBackendMock.mockImplementation((command) => {
    if (command === "execute_database_query") {
      return Promise.resolve({
        columns: [{ name: "id", data_type: "INT" }, { name: "name", data_type: "VARCHAR" }],
        rows: [[{ kind: "number", value: "1" }, { kind: "text", value: "Alice" }]],
        affected_rows: 0,
        duration_ms: 8,
        limited: false,
      });
    }
    if (command === "export_database_result") {
      return Promise.resolve({ exported_rows: 1, duration_ms: 3 });
    }
    if (command === "list_database_sql_files") {
      return Promise.resolve([{ name: "default", content: "" }]);
    }
    return Promise.resolve([]);
  });

  renderDatabaseWorkspace("app");
  const editor = await screen.findByLabelText("SQL 编辑器");
  await userEvent.type(editor, "select id, name from users");
  setSelectedSqlText("select id, name from users");
  await executeSelectedSqlFromContextMenu(editor);

  await userEvent.click(await screen.findByRole("button", { name: "导出" }));
  await userEvent.click(screen.getByRole("menuitem", { name: "导出为 CSV" }));

  expect(pickDatabaseExportPathMock).toHaveBeenCalledWith(expect.stringMatching(/app\\.result\\.\\d{14}\\.csv/), "csv");
  expect(callBackendMock).toHaveBeenCalledWith("export_database_result", {
    request: {
      connection_id: "mysql-dev",
      database: "app",
      table: null,
      path: "C:\\tmp\\app.users.20260625093000.csv",
      format: "csv",
      columns: [{ name: "id", data_type: "INT" }, { name: "name", data_type: "VARCHAR" }],
      rows: [[{ kind: "number", value: "1" }, { kind: "text", value: "Alice" }]],
    },
  });
  expect(await screen.findByText("已导出 1 行，耗时 3 ms")).toBeInTheDocument();
});

it("asks for a target table when exporting free query result as INSERT SQL", async () => {
  pickDatabaseExportPathMock.mockResolvedValue("C:\\tmp\\app.users.20260625093000.sql");
  callBackendMock.mockImplementation((command) => {
    if (command === "execute_database_query") {
      return Promise.resolve({
        columns: [{ name: "id", data_type: "INT" }],
        rows: [[{ kind: "number", value: "1" }]],
        affected_rows: 0,
        duration_ms: 8,
        limited: false,
      });
    }
    if (command === "export_database_result") {
      return Promise.resolve({ exported_rows: 1, duration_ms: 3 });
    }
    if (command === "list_database_sql_files") {
      return Promise.resolve([{ name: "default", content: "" }]);
    }
    return Promise.resolve([]);
  });

  renderDatabaseWorkspace("app");
  const editor = await screen.findByLabelText("SQL 编辑器");
  await userEvent.type(editor, "select id from users");
  setSelectedSqlText("select id from users");
  await executeSelectedSqlFromContextMenu(editor);

  await userEvent.click(await screen.findByRole("button", { name: "导出" }));
  await userEvent.click(screen.getByRole("menuitem", { name: "导出为 INSERT SQL" }));

  const dialog = await screen.findByRole("dialog", { name: "导出 INSERT SQL" });
  await userEvent.type(within(dialog).getByLabelText("目标表名"), "users");
  await userEvent.click(within(dialog).getByRole("button", { name: "导出" }));

  expect(callBackendMock).toHaveBeenCalledWith("export_database_result", expect.objectContaining({
    request: expect.objectContaining({
      table: "users",
      format: "insert_sql",
    }),
  }));
});
```

- [ ] **Step 2: Run export UI tests and verify failure**

Run:

```powershell
pnpm test -- src/features/database/DatabaseWorkspace.test.tsx -t "exports the current query result|asks for a target table"
```

Expected: fails because export UI does not exist.

- [ ] **Step 3: Add i18n keys**

Add zh-CN:

```ts
"database.export": "导出",
"database.export_csv": "导出为 CSV",
"database.export_insert_sql": "导出为 INSERT SQL",
"database.export_insert_sql_title": "导出 INSERT SQL",
"database.export_target_table": "目标表名",
"database.export_complete": "已导出 {{rows}} 行，耗时 {{duration}} ms",
```

Add equivalent en-US keys.

- [ ] **Step 4: Extend DatabaseDataGrid with toolbar actions**

In `src/features/database/DatabaseDataGrid.tsx`, add prop:

```ts
toolbarActions?: ReactNode;
```

Include in props destructuring and render near table shell top:

```tsx
{toolbarActions ? <div className="database-table-browser__grid-actions">{toolbarActions}</div> : null}
```

Keep existing footer unchanged.

- [ ] **Step 5: Implement export state and helper functions in DatabaseWorkspace**

In `src/features/database/DatabaseWorkspace.tsx`:

Import:

```ts
import ExportIcon from "../../assets/icons/mdi--table-export.svg?react";
import { pickDatabaseExportPath } from "../../lib/fileDialog";
import type { DatabaseResultExportFormat, DatabaseResultExportResult } from "./databaseTypes";
```

Add state:

```ts
const [exportMenu, setExportMenu] = useState<ContextMenuState | null>(null);
const [exportMessage, setExportMessage] = useState("");
const [insertExportTableName, setInsertExportTableName] = useState("");
const [pendingInsertExport, setPendingInsertExport] = useState<{ columns: DatabaseResultColumn[]; rows: DatabaseCellValue[][] } | null>(null);
```

Add helper:

```ts
function defaultExportName(table: string | null, extension: "csv" | "sql") {
  const database = currentDatabase || "database";
  const target = table?.trim() || "result";
  const timestamp = new Date().toISOString().replace(/\D/g, "").slice(0, 14);
  return `${database}.${target}.${timestamp}.${extension}`;
}
```

Add export function:

```ts
async function exportResult(format: DatabaseResultExportFormat, columns: DatabaseResultColumn[], rows: DatabaseCellValue[][], table: string | null) {
  if (format === "insert_sql" && !table) {
    setPendingInsertExport({ columns, rows });
    setInsertExportTableName("");
    return;
  }
  const extension = format === "csv" ? "csv" : "sql";
  const path = await pickDatabaseExportPath(defaultExportName(table, extension), extension);
  if (!path) return;
  const exported = await callBackend<DatabaseResultExportResult>("export_database_result", {
    request: {
      connection_id: connectionId,
      database: currentDatabase,
      table,
      path,
      format,
      columns,
      rows,
    },
  });
  setExportMessage(t("database.export_complete", { rows: exported.exported_rows, duration: exported.duration_ms }));
}
```

Add `openExportMenu`:

```ts
function openExportMenu(event: React.MouseEvent, columns: DatabaseResultColumn[], rows: DatabaseCellValue[][], table: string | null) {
  event.preventDefault();
  setExportMenu({
    x: event.clientX,
    y: event.clientY,
    items: [
      { label: t("database.export_csv"), onSelect: () => void exportResult("csv", columns, rows, table) },
      { label: t("database.export_insert_sql"), onSelect: () => void exportResult("insert_sql", columns, rows, table) },
    ],
  });
}
```

Pass export props to `DatabaseResultView`:

```tsx
<DatabaseResultView result={result} exportMessage={exportMessage} onExport={openExportMenu} />
```

Render `ContextMenu menu={exportMenu}`.

Render pending table dialog:

```tsx
{pendingInsertExport ? (
  <div className="connection-dialog__backdrop">
    <div className="connection-dialog database-dialog" role="dialog" aria-modal="true" aria-label={t("database.export_insert_sql_title")}>
      <header className="database-dialog__header"><h2>{t("database.export_insert_sql_title")}</h2></header>
      <label>
        <span>{t("database.export_target_table")}</span>
        <input aria-label={t("database.export_target_table")} value={insertExportTableName} onChange={(event) => setInsertExportTableName(event.target.value)} />
      </label>
      <div className="database-dialog__actions">
        <button type="button" onClick={() => setPendingInsertExport(null)}>{t("database.cancel")}</button>
        <button type="button" disabled={!insertExportTableName.trim()} onClick={() => {
          const pending = pendingInsertExport;
          setPendingInsertExport(null);
          void exportResult("insert_sql", pending.columns, pending.rows, insertExportTableName.trim());
        }}>{t("database.export")}</button>
      </div>
    </div>
  </div>
) : null}
```

- [ ] **Step 6: Update DatabaseResultView signature**

Change:

```ts
function DatabaseResultView({ result }: { result: DatabaseQueryResult }) {
```

to:

```ts
function DatabaseResultView({
  result,
  exportMessage,
  onExport,
}: {
  result: DatabaseQueryResult;
  exportMessage: string;
  onExport: (event: React.MouseEvent, columns: DatabaseResultColumn[], rows: DatabaseCellValue[][], table: string | null) => void;
}) {
```

Render export button when `result.columns.length > 0`:

```tsx
<button type="button" className="database-icon-button" aria-label={t("database.export")} title={t("database.export")} onClick={(event) => onExport(event, result.columns, result.rows, null)}>
  <AppIcon icon={ExportIcon} decorative />
</button>
{exportMessage ? <p role="status">{exportMessage}</p> : null}
```

- [ ] **Step 7: Add table browser export**

In `DatabaseTableBrowser`, add props:

```ts
onExport?: (event: React.MouseEvent, columns: DatabaseResultColumn[], rows: DatabaseCellValue[][], table: string) => void;
exportMessage?: string;
```

Pass from `DatabaseWorkspace`:

```tsx
<DatabaseTableBrowser
  connectionId={connectionId}
  target={tableBrowserTarget}
  exportMessage={exportMessage}
  onExport={(event, columns, rows, table) => openExportMenu(event, columns, rows, table)}
/>
```

In `DatabaseTableBrowser`, pass `toolbarActions` to `DatabaseDataGrid`:

```tsx
toolbarActions={result ? (
  <>
    <button type="button" className="database-icon-button" aria-label={t("database.export")} title={t("database.export")} onClick={(event) => onExport?.(event, result.columns, displayedRows(), target.table)}>
      <AppIcon icon={ExportIcon} decorative />
    </button>
    {exportMessage ? <span role="status">{exportMessage}</span> : null}
  </>
) : null}
```

Import `ExportIcon` and `AppIcon` if not already available.

- [ ] **Step 8: Run export UI tests**

Run:

```powershell
pnpm test -- src/features/database/DatabaseWorkspace.test.tsx -t "exports the current query result|asks for a target table"
```

Expected: both tests pass.

---

### Task 7: Full verification and docs update

**Files:**
- Modify: `docs/当前状态与下一步.md`
- Modify: `docs/testing/manual-mvp-checklist.md`
- Modify: `README.md`

- [ ] **Step 1: Update docs**

Update docs to mention:

- 数据库支持执行本地 SQL 文件，执行前预览确认。
- 数据库查询结果支持导出 CSV 或 INSERT SQL。
- 第一版不支持 CSV 导入和整库导出。

- [ ] **Step 2: Run full focused frontend tests**

Run:

```powershell
pnpm test -- src/features/database/DatabaseWorkspace.test.tsx
```

Expected: all database workspace tests pass.

- [ ] **Step 3: Run backend tests**

Run:

```powershell
cargo test --manifest-path src-tauri\Cargo.toml db::export db::sql_file commands::database::tests::builds_database_file_targets
```

Expected: export, SQL file, and command helper tests pass.

- [ ] **Step 4: Run docs/style check**

Run:

```powershell
git diff --check
```

Expected: no whitespace errors.

- [ ] **Step 5: Commit implementation**

Run:

```powershell
git status --short
git add -- src-tauri\src\models\database.rs src-tauri\src\db\mod.rs src-tauri\src\db\export.rs src-tauri\src\db\sql_file.rs src-tauri\src\db\query.rs src-tauri\src\commands\database.rs src-tauri\src\lib.rs src\lib\fileDialog.ts src\assets\icons\tabler--file-import.svg src\assets\icons\mdi--table-export.svg src\features\database\databaseTypes.ts src\features\database\DatabaseWorkspace.tsx src\features\database\DatabaseTableBrowser.tsx src\features\database\DatabaseDataGrid.tsx src\features\database\DatabaseWorkspace.test.tsx src\i18n\locales\zh-CN.ts src\i18n\locales\en-US.ts README.md docs\当前状态与下一步.md docs\testing\manual-mvp-checklist.md docs\superpowers\plans\2026-06-25-database-sql-file-execution-and-result-export.md
git commit -m "feat(database): 支持 SQL 文件执行和结果导出"
```

Expected: commit succeeds with only planned files staged.

---

## Self-Review

- Spec coverage:
  - SQL 文件选择、预览、危险提示、确认执行：Task 2、Task 3、Task 5。
  - 当前查询结果导出 CSV / INSERT SQL：Task 1、Task 3、Task 6。
  - 默认文件名：Task 6。
  - 指定图标：Task 4、Task 5、Task 6。
  - 日志：Task 3。
  - 文档：Task 7。
- Placeholder scan: no TBD/TODO placeholders.
- Scope check: plan intentionally excludes CSV import, full database export, progress/cancel, and SQL dump.
