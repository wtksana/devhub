# Database Table Browser Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现数据库 B 版第一批，只读表数据分页浏览、单列排序和简单筛选。

**Architecture:** 后端新增 `load_database_table_page` command，复用现有数据库连接、标识符引用和查询结果单元格转换。前端在 `DatabaseWorkspace` 中增加结果模式，双击表进入表浏览模式，自由 SQL 执行后回到普通查询结果模式。表浏览组件维护分页、排序和筛选状态。

**Tech Stack:** Tauri 2、Rust、sqlx、React、TypeScript、Vitest、cargo test。

---

## File Structure

- Modify `src-tauri/src/models/database.rs`
  - 增加表分页请求和响应类型。
- Modify `src-tauri/src/db/query.rs`
  - 增加表分页 SQL 构建、请求规范化和执行逻辑。
- Modify `src-tauri/src/commands/database.rs`
  - 暴露 `load_database_table_page` command。
- Modify `src-tauri/src/lib.rs`
  - 注册新 command。
- Modify `src-tauri/src/tests/database_query_tests.rs`
  - 覆盖 SQL 构建、分页边界和排序校验。
- Modify `src/features/database/databaseTypes.ts`
  - 增加前端表分页类型。
- Modify `src/features/database/DatabaseWorkspace.tsx`
  - 增加结果模式，双击表进入表浏览，执行自由 SQL 切回查询结果。
- Create `src/features/database/DatabaseTableBrowser.tsx`
  - 表浏览工具栏、分页、筛选、排序、数据表。
- Modify `src/features/database/DatabaseWorkspace.test.tsx`
  - 覆盖双击表、分页、排序、筛选和自由 SQL 切换。
- Modify `src/i18n/locales/zh-CN.ts`
  - 增加中文文案。
- Modify `src/i18n/locales/en-US.ts`
  - 增加英文文案。
- Modify `src/styles/globals.css`
  - 增加表浏览工具栏和可排序表头样式。
- Modify `README.md`
  - 记录数据库 B 版第一批能力。
- Modify `docs/当前状态与下一步.md`
  - 更新最近完成和下一步建议。

## Task 1: 后端模型和 SQL 构建

**Files:**
- Modify: `src-tauri/src/models/database.rs`
- Modify: `src-tauri/src/db/query.rs`
- Test: `src-tauri/src/tests/database_query_tests.rs`

- [ ] **Step 1: Write failing Rust tests**

Add to `src-tauri/src/tests/database_query_tests.rs`:

```rust
use crate::db::query::{
    apply_select_limit, build_table_page_queries, is_dangerous_sql, mysql_prefers_numeric_decode,
    normalize_table_page_request, quote_identifier,
};
use crate::models::database::LoadDatabaseTablePageRequest;
```

Add tests:

```rust
#[test]
fn builds_mysql_table_page_queries_with_sort_and_filter() {
    let request = LoadDatabaseTablePageRequest {
        connection_id: "mysql-dev".to_string(),
        database: "app".to_string(),
        table: "user`log".to_string(),
        page: Some(2),
        page_size: Some(50),
        sort_column: Some("created_at".to_string()),
        sort_direction: Some("desc".to_string()),
        filter: Some("status = 'SUCCESS'".to_string()),
    };
    let normalized = normalize_table_page_request(request).unwrap();
    let queries = build_table_page_queries("mysql", &normalized).unwrap();

    assert_eq!(
        queries.count_sql,
        "SELECT COUNT(*) AS total FROM `user``log` WHERE status = 'SUCCESS'"
    );
    assert_eq!(
        queries.page_sql,
        "SELECT * FROM `user``log` WHERE status = 'SUCCESS' ORDER BY `created_at` DESC LIMIT 50 OFFSET 50"
    );
}

#[test]
fn builds_postgresql_table_page_queries_without_optional_clauses() {
    let request = LoadDatabaseTablePageRequest {
        connection_id: "pg-dev".to_string(),
        database: "public".to_string(),
        table: "orders".to_string(),
        page: Some(1),
        page_size: Some(200),
        sort_column: None,
        sort_direction: None,
        filter: None,
    };
    let normalized = normalize_table_page_request(request).unwrap();
    let queries = build_table_page_queries("postgresql", &normalized).unwrap();

    assert_eq!(queries.count_sql, "SELECT COUNT(*) AS total FROM \"orders\"");
    assert_eq!(queries.page_sql, "SELECT * FROM \"orders\" LIMIT 200 OFFSET 0");
}

#[test]
fn normalizes_table_page_request_bounds() {
    let request = LoadDatabaseTablePageRequest {
        connection_id: "mysql-dev".to_string(),
        database: "app".to_string(),
        table: "users".to_string(),
        page: Some(0),
        page_size: Some(20_000),
        sort_column: None,
        sort_direction: None,
        filter: Some("   ".to_string()),
    };
    let normalized = normalize_table_page_request(request).unwrap();

    assert_eq!(normalized.page, 1);
    assert_eq!(normalized.page_size, 10_000);
    assert_eq!(normalized.filter, None);
}

#[test]
fn rejects_invalid_table_page_sort_direction() {
    let request = LoadDatabaseTablePageRequest {
        connection_id: "mysql-dev".to_string(),
        database: "app".to_string(),
        table: "users".to_string(),
        page: Some(1),
        page_size: Some(200),
        sort_column: Some("id".to_string()),
        sort_direction: Some("sideways".to_string()),
        filter: None,
    };

    assert_eq!(
        normalize_table_page_request(request).unwrap_err(),
        "unsupported sort direction: sideways"
    );
}
```

- [ ] **Step 2: Run failing Rust tests**

Run:

```powershell
cargo test --manifest-path src-tauri/Cargo.toml database_query_tests
```

Expected: fail because `LoadDatabaseTablePageRequest`, `normalize_table_page_request`, and `build_table_page_queries` do not exist.

- [ ] **Step 3: Add Rust models**

Add to `src-tauri/src/models/database.rs`:

```rust
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

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct DatabaseTablePageResult {
    pub columns: Vec<DatabaseResultColumn>,
    pub rows: Vec<Vec<DatabaseCellValue>>,
    pub total_rows: u64,
    pub page: u32,
    pub page_size: u32,
    pub duration_ms: u128,
}
```

- [ ] **Step 4: Add query helper implementation**

Add imports in `src-tauri/src/db/query.rs`:

```rust
DatabaseTablePageResult, LoadDatabaseTablePageRequest,
```

Add constants and types:

```rust
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
```

Add functions:

```rust
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
    let table = quote_identifier(kind, &request.table)?;
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
```

- [ ] **Step 5: Run Rust tests**

Run:

```powershell
cargo test --manifest-path src-tauri/Cargo.toml database_query_tests
```

Expected: pass.

## Task 2: 后端表分页 command

**Files:**
- Modify: `src-tauri/src/db/query.rs`
- Modify: `src-tauri/src/commands/database.rs`
- Modify: `src-tauri/src/lib.rs`
- Test: `src-tauri/src/tests/database_query_tests.rs`

- [ ] **Step 1: Add command and execution implementation**

In `src-tauri/src/db/query.rs`, add:

```rust
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
```

Add MySQL and PostgreSQL helpers that:

- open one connection with `database_connection_url`;
- run `USE <database>` for MySQL when needed by adding database to URL already handled by selected connection database in current architecture, so query SQL only uses table name;
- execute count query with `sqlx::query(&queries.count_sql).fetch_one`;
- read `total` as `i64` then `u64`;
- execute page query with `fetch_all`;
- convert rows using existing `rows_to_mysql_result` / `rows_to_postgresql_result`;
- close connection;
- return `DatabaseTablePageResult`.

Concrete shape:

```rust
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
```

Add analogous `load_postgresql_table_page`.

- [ ] **Step 2: Register Tauri command**

In `src-tauri/src/commands/database.rs`, import:

```rust
DatabaseTablePageResult, LoadDatabaseTablePageRequest,
```

Add command:

```rust
#[tauri::command]
pub async fn load_database_table_page(
    settings_store: State<'_, SettingsStore>,
    database_manager: State<'_, DatabaseConnectionManager>,
    request: LoadDatabaseTablePageRequest,
) -> Result<DatabaseTablePageResult, String> {
    let connection = load_database_connection(settings_store.inner(), &request.connection_id)?;
    query::load_database_table_page(database_manager.inner(), &connection, &request).await
}
```

In `src-tauri/src/lib.rs`, add:

```rust
commands::database::load_database_table_page,
```

- [ ] **Step 3: Run Rust tests and check**

Run:

```powershell
cargo test --manifest-path src-tauri/Cargo.toml database_query_tests
cargo check --manifest-path src-tauri/Cargo.toml
```

Expected: pass.

## Task 3: 前端类型和表浏览组件

**Files:**
- Modify: `src/features/database/databaseTypes.ts`
- Create: `src/features/database/DatabaseTableBrowser.tsx`
- Modify: `src/i18n/locales/zh-CN.ts`
- Modify: `src/i18n/locales/en-US.ts`
- Modify: `src/styles/globals.css`
- Test: `src/features/database/DatabaseWorkspace.test.tsx`

- [ ] **Step 1: Add TypeScript types**

Add to `src/features/database/databaseTypes.ts`:

```ts
export type DatabaseSortDirection = "asc" | "desc";

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
}

export interface DatabaseTableBrowserTarget {
  database: string;
  table: string;
}
```

- [ ] **Step 2: Create component**

Create `src/features/database/DatabaseTableBrowser.tsx` with:

```tsx
import { useEffect, useState } from "react";
import { callBackend } from "../../lib/tauri";
import { useI18n } from "../../i18n/useI18n";
import type { DatabaseCellValue, DatabaseSortDirection, DatabaseTableBrowserTarget, DatabaseTablePageResult } from "./databaseTypes";

const DEFAULT_PAGE_SIZE = 200;

interface DatabaseTableBrowserProps {
  connectionId: string;
  target: DatabaseTableBrowserTarget;
}

export function DatabaseTableBrowser({ connectionId, target }: DatabaseTableBrowserProps) {
  const { t } = useI18n();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(String(DEFAULT_PAGE_SIZE));
  const [sortColumn, setSortColumn] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<DatabaseSortDirection | null>(null);
  const [filterInput, setFilterInput] = useState("");
  const [filter, setFilter] = useState("");
  const [result, setResult] = useState<DatabaseTablePageResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    setPage(1);
    setSortColumn(null);
    setSortDirection(null);
    setFilterInput("");
    setFilter("");
  }, [target.database, target.table]);

  useEffect(() => {
    void loadPage();
  }, [connectionId, target.database, target.table, page, pageSize, sortColumn, sortDirection, filter]);

  async function loadPage() {
    setIsLoading(true);
    setError(null);
    try {
      const nextResult = await callBackend<DatabaseTablePageResult>("load_database_table_page", {
        request: {
          connection_id: connectionId,
          database: target.database,
          table: target.table,
          page,
          page_size: normalizePageSize(pageSize),
          sort_column: sortColumn,
          sort_direction: sortDirection,
          filter: filter || null,
        },
      });
      setResult(nextResult);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setIsLoading(false);
    }
  }

  function applyFilter() {
    setPage(1);
    setFilter(filterInput.trim());
  }

  function toggleSort(columnName: string) {
    if (sortColumn !== columnName) {
      setSortColumn(columnName);
      setSortDirection("asc");
      setPage(1);
      return;
    }
    if (sortDirection === "asc") {
      setSortDirection("desc");
      setPage(1);
      return;
    }
    setSortColumn(null);
    setSortDirection(null);
    setPage(1);
  }

  const totalPages = result ? Math.max(1, Math.ceil(result.total_rows / result.page_size)) : 1;
  const canGoPrevious = page > 1 && !isLoading;
  const canGoNext = Boolean(result && page < totalPages && !isLoading);

  return (
    <section className="database-table-browser" aria-label={t("database.table_browser")}>
      <header className="database-table-browser__toolbar">
        <span>{t("database.table_label", { table: target.table })}</span>
        <button type="button" disabled={!canGoPrevious} onClick={() => setPage((current) => Math.max(1, current - 1))}>
          {t("database.previous_page")}
        </button>
        <label>
          <span>{t("database.page")}</span>
          <input
            aria-label={t("database.page")}
            type="number"
            min="1"
            value={page}
            onChange={(event) => setPage(normalizePage(event.target.value))}
          />
        </label>
        <button type="button" disabled={!canGoNext} onClick={() => setPage((current) => current + 1)}>
          {t("database.next_page")}
        </button>
        <label>
          <span>{t("database.page_size")}</span>
          <input
            aria-label={t("database.page_size")}
            type="number"
            min="1"
            max="10000"
            value={pageSize}
            onBlur={() => setPageSize(String(normalizePageSize(pageSize)))}
            onChange={(event) => {
              setPage(1);
              setPageSize(event.target.value);
            }}
          />
        </label>
        <span>{result ? t("database.total_rows", { total: result.total_rows }) : t("database.total_rows", { total: 0 })}</span>
        <label className="database-table-browser__filter">
          <span>{t("database.filter")}</span>
          <input
            aria-label={t("database.filter")}
            value={filterInput}
            placeholder={t("database.filter_placeholder")}
            onBlur={applyFilter}
            onChange={(event) => setFilterInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") applyFilter();
            }}
          />
        </label>
        <button type="button" disabled={isLoading} onClick={() => void loadPage()}>
          {isLoading ? t("database.loading") : t("database.refresh")}
        </button>
      </header>
      {error ? <p className="database-table-browser__error" role="alert">{error}</p> : null}
      {result ? (
        <div className="database-result__table-wrap">
          <table>
            <thead>
              <tr>
                {result.columns.map((column) => (
                  <th key={column.name} scope="col" aria-label={`${column.name} ${column.data_type}`}>
                    <button type="button" onClick={() => toggleSort(column.name)}>
                      <span>{column.name}</span>
                      <small>{column.data_type}</small>
                      {sortColumn === column.name && sortDirection ? <span>{sortDirection === "asc" ? "↑" : "↓"}</span> : null}
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {result.rows.length > 0 ? result.rows.map((row, rowIndex) => (
                <tr key={rowIndex}>
                  {row.map((cell, cellIndex) => (
                    <td key={cellIndex}>{formatCellValue(cell)}</td>
                  ))}
                </tr>
              )) : (
                <tr>
                  <td colSpan={result.columns.length}>{t("database.query_result_empty")}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="database-workspace__empty">{t("database.loading")}</div>
      )}
    </section>
  );
}

function normalizePage(value: string) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return 1;
  return parsed;
}

function normalizePageSize(value: string) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return DEFAULT_PAGE_SIZE;
  return Math.min(parsed, 10_000);
}

function formatCellValue(cell: DatabaseCellValue) {
  if (cell.kind === "null") return "NULL";
  if (cell.kind === "bool") return String(cell.value);
  return cell.value;
}
```

- [ ] **Step 3: Add i18n keys**

Add zh-CN database keys:

```ts
table_browser: "表数据",
table_label: "表 {table}",
previous_page: "上一页",
next_page: "下一页",
page: "页码",
page_size: "每页",
total_rows: "共 {total} 条",
filter: "筛选",
filter_placeholder: "SQL 条件，如 status = 'SUCCESS'",
refresh: "刷新",
loading: "加载中",
```

Add en-US equivalents.

- [ ] **Step 4: Add CSS**

Add to `src/styles/globals.css`:

```css
.database-table-browser {
  display: grid;
  grid-template-rows: auto auto minmax(0, 1fr);
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  border: 1px solid var(--border-subtle);
  background: var(--panel);
}

.database-table-browser__toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  min-width: 0;
  padding: 8px 10px;
  border-bottom: 1px solid var(--border-subtle);
  color: var(--muted);
}

.database-table-browser__toolbar label {
  display: inline-flex;
  gap: 6px;
  align-items: center;
}

.database-table-browser__toolbar input[type="number"] {
  width: 72px;
}

.database-table-browser__filter {
  margin-left: auto;
}

.database-table-browser__filter input {
  width: 260px;
}

.database-table-browser__error {
  margin: 0;
  padding: 8px 10px;
  color: var(--danger);
  border-bottom: 1px solid var(--border-subtle);
}

.database-table-browser th button {
  display: inline-flex;
  gap: 6px;
  align-items: center;
  width: 100%;
  padding: 0;
  border: 0;
  color: inherit;
  background: transparent;
  font: inherit;
  text-align: left;
}
```

## Task 4: Wire table browser into workspace

**Files:**
- Modify: `src/features/database/DatabaseWorkspace.tsx`
- Test: `src/features/database/DatabaseWorkspace.test.tsx`

- [ ] **Step 1: Add failing frontend tests**

Add tests to `DatabaseWorkspace.test.tsx`:

```tsx
it("opens a table browser when double clicking a table without replacing SQL content", async () => {
  callBackendMock.mockImplementation((command, payload) => {
    if (command === "list_database_objects") {
      const request = (payload as { request: { parent_kind?: string } }).request;
      if (!request.parent_kind) {
        return Promise.resolve([{ id: "database:app", name: "app", kind: "database", has_children: true }]);
      }
      return Promise.resolve([{ id: "table:app.users", name: "users", kind: "table", has_children: true }]);
    }
    if (command === "list_database_sql_files") {
      return Promise.resolve([{ name: "default", content: "select 1" }]);
    }
    if (command === "load_database_table_page") {
      return Promise.resolve({
        columns: [{ name: "id", data_type: "INT" }],
        rows: [[{ kind: "number", value: "1" }]],
        total_rows: 501,
        page: 1,
        page_size: 200,
        duration_ms: 9,
      });
    }
    return Promise.resolve([]);
  });

  renderDatabaseWorkspace("app");

  expect(await screen.findByLabelText("SQL 编辑器")).toHaveValue("select 1");
  await userEvent.dblClick(await screen.findByText("users"));

  expect(screen.getByLabelText("SQL 编辑器")).toHaveValue("select 1");
  expect(await screen.findByLabelText("表数据")).toBeInTheDocument();
  expect(screen.getByText("表 users")).toBeInTheDocument();
  expect(screen.getByText("共 501 条")).toBeInTheDocument();
  expect(callBackendMock).toHaveBeenCalledWith("load_database_table_page", {
    request: {
      connection_id: "mysql-dev",
      database: "app",
      table: "users",
      page: 1,
      page_size: 200,
      sort_column: null,
      sort_direction: null,
      filter: null,
    },
  });
});
```

Add tests for next page, sort and filter using `load_database_table_page` mock.

- [ ] **Step 2: Modify workspace state**

In `DatabaseWorkspace.tsx`, import:

```tsx
import { DatabaseTableBrowser } from "./DatabaseTableBrowser";
import type { DatabaseTableBrowserTarget } from "./databaseTypes";
```

Add state:

```tsx
const [tableBrowserTarget, setTableBrowserTarget] = useState<DatabaseTableBrowserTarget | null>(null);
```

Change `executeSql` success:

```tsx
setResult(nextResult);
setTableBrowserTarget(null);
```

Change `openTable`:

```tsx
function openTable(node: DatabaseTreeNode) {
  if (!currentDatabase) return;
  setResult(null);
  setError(null);
  setTableBrowserTarget({ database: currentDatabase, table: node.name });
}
```

Change content render:

```tsx
{tableBrowserTarget ? (
  <DatabaseTableBrowser connectionId={connectionId} target={tableBrowserTarget} />
) : result ? (
  <DatabaseResultView result={result} />
) : (
  <div className="database-workspace__empty" aria-label={t("database.query_result")}>{t("database.empty_query_result")}</div>
)}
```

- [ ] **Step 3: Run frontend tests**

Run:

```powershell
pnpm vitest run --environment jsdom src/features/database/DatabaseWorkspace.test.tsx
pnpm exec tsc --noEmit
```

Expected: pass.

## Task 5: Docs and final verification

**Files:**
- Modify: `README.md`
- Modify: `docs/当前状态与下一步.md`

- [ ] **Step 1: Update docs**

In `README.md` database section, add:

```md
- 双击表或视图会打开只读表数据浏览模式，支持分页、单列排序和简单 SQL 条件筛选。
```

In `docs/当前状态与下一步.md` 最近完成, add the same capability.

- [ ] **Step 2: Run full verification**

Run:

```powershell
pnpm test
cargo test --manifest-path src-tauri/Cargo.toml
pnpm exec tsc --noEmit
git diff --check
```

Expected:

- frontend tests pass;
- Rust tests pass;
- TypeScript passes;
- diff check prints no output.

- [ ] **Step 3: Commit**

Run:

```powershell
git add README.md docs/当前状态与下一步.md src-tauri/src/models/database.rs src-tauri/src/db/query.rs src-tauri/src/commands/database.rs src-tauri/src/lib.rs src-tauri/src/tests/database_query_tests.rs src/features/database src/i18n/locales/zh-CN.ts src/i18n/locales/en-US.ts src/styles/globals.css
git commit -m "feat(database): 支持表数据分页浏览"
```

## Self-Review

- Spec coverage: 双击表、分页、排序、筛选、不覆盖 SQL 文件、自由 SQL 切回普通结果都有任务覆盖。
- Placeholder scan: 无 TBD/TODO/待定。
- Type consistency: 后端 request/result 与前端 `DatabaseTablePageResult` 字段保持 snake_case；前端 Tauri request 使用 snake_case。
