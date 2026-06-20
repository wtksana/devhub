# 数据库管理 A 版 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现数据库管理 A 版：MySQL / PostgreSQL 直连、连接管理、对象树、SQL 执行、结果表格和查询历史。

**Architecture:** 复用现有连接面板、工作区标签和 Tauri 命令模式。数据库连接配置进入 `settings.json`，Rust 后端负责连接测试、对象树元数据、SQL 执行和 SQLite 查询历史；React 前端负责连接编辑、数据库工作区、对象树、SQL 编辑器、结果表格和历史面板。

**Tech Stack:** Tauri 2、Rust、React、TypeScript、Vitest、Cargo test、rusqlite、建议新增 sqlx 的 MySQL/PostgreSQL runtime 能力。

---

## 文件结构

### 后端

- Modify: `src-tauri/Cargo.toml`
  - 增加数据库驱动依赖，优先 `sqlx`，开启 `runtime-tokio-rustls`、`mysql`、`postgres`。
- Modify: `src-tauri/src/lib.rs`
  - 注册 `DatabaseConnectionManager` 和数据库 Tauri commands。
- Modify: `src-tauri/src/commands/mod.rs`
  - 导出 `database` 命令模块。
- Create: `src-tauri/src/models/database.rs`
  - 数据库命令请求/响应模型。
- Modify: `src-tauri/src/models/mod.rs`
  - 导出 `database` 模型模块。
- Modify: `src-tauri/src/models/settings.rs`
  - 新增 MySQL / PostgreSQL 连接配置类型，并加入 `ConnectionSettings`。
- Create: `src-tauri/src/db/mod.rs`
  - 导出数据库连接、元数据、SQL 执行和历史子模块。
- Create: `src-tauri/src/db/connection.rs`
  - 连接 URL 构造、连接管理器、连接测试。
- Create: `src-tauri/src/db/metadata.rs`
  - MySQL / PostgreSQL 对象树元数据查询。
- Create: `src-tauri/src/db/query.rs`
  - SQL 限制、危险语句识别、执行 SQL 和结果归一化。
- Create: `src-tauri/src/db/history.rs`
  - SQLite 查询历史库、表初始化、写入、查询和裁剪。
- Create: `src-tauri/src/commands/database.rs`
  - Tauri command 边界。
- Test: `src-tauri/src/tests/database_settings_tests.rs`
- Test: `src-tauri/src/tests/database_query_tests.rs`
- Test: `src-tauri/src/tests/database_history_tests.rs`

### 前端

- Modify: `src/features/settings/settingsTypes.ts`
  - 新增数据库连接类型。
- Modify: `src/features/connections/ConnectionDialog.tsx`
  - 添加 MySQL / PostgreSQL 表单和测试连接。
- Modify: `src/features/connections/ConnectionList.tsx`
  - 数据库连接展示、双击打开、右键菜单。
- Modify: `src/app/AppShell.tsx`
  - 新增数据库工作区标签类型。
- Create: `src/features/database/databaseTypes.ts`
  - 前端数据库模型。
- Create: `src/features/database/DatabaseWorkspace.tsx`
  - 数据库工作区总组件。
- Create: `src/features/database/DatabaseObjectTree.tsx`
  - 对象树。
- Create: `src/features/database/SqlEditor.tsx`
  - SQL 输入、限制工具栏、执行按钮。
- Create: `src/features/database/QueryResultTable.tsx`
  - 查询结果表格。
- Create: `src/features/database/QueryHistoryPanel.tsx`
  - 查询历史面板。
- Test: `src/features/connections/ConnectionDialog.test.tsx`
- Test: `src/features/connections/ConnectionList.test.tsx`
- Test: `src/features/database/DatabaseWorkspace.test.tsx`
- Test: `src/app/AppShell.test.tsx`
- Modify: `src/i18n/locales/zh-CN.ts`
- Modify: `src/i18n/locales/en-US.ts`
- Modify: `src/styles/globals.css`

### 文档

- Modify: `README.md`
- Modify: `docs/当前状态与下一步.md`
- Modify: `docs/superpowers/specs/2026-06-20-database-management-a-design.md` if implementation decisions require minor clarification.

---

## Task 1: 后端连接配置模型

**Files:**
- Modify: `src-tauri/src/models/settings.rs`
- Test: `src-tauri/src/tests/database_settings_tests.rs`
- Modify: `src-tauri/src/tests/mod.rs`

- [ ] **Step 1: 写失败测试**

新增测试覆盖 MySQL / PostgreSQL 连接反序列化、序列化和 `ConnectionSettings::id()`。

```rust
#[test]
fn parses_mysql_connection_settings() {
    let json = r#"{
      "kind": "mysql",
      "id": "mysql-dev",
      "name": "开发 MySQL",
      "group": "开发环境",
      "host": "127.0.0.1",
      "port": 3306,
      "username": "root",
      "password": "secret",
      "database": "app"
    }"#;

    let connection: ConnectionSettings = serde_json::from_str(json).unwrap();

    assert_eq!(connection.id(), "mysql-dev");
    assert!(matches!(connection, ConnectionSettings::Mysql(_)));
}

#[test]
fn parses_postgresql_connection_settings() {
    let json = r#"{
      "kind": "postgresql",
      "id": "pg-dev",
      "name": "开发 PostgreSQL",
      "host": "127.0.0.1",
      "port": 5432,
      "username": "postgres",
      "password": "secret",
      "database": "app"
    }"#;

    let connection: ConnectionSettings = serde_json::from_str(json).unwrap();

    assert_eq!(connection.id(), "pg-dev");
    assert!(matches!(connection, ConnectionSettings::Postgresql(_)));
}
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```powershell
cargo test database_settings_tests
```

Expected: `ConnectionSettings::Mysql` / `Postgresql` 不存在导致编译失败。

- [ ] **Step 3: 实现模型**

在 `settings.rs` 增加：

```rust
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DatabaseConnectionSettings {
    pub kind: String,
    pub id: String,
    pub name: String,
    pub group: Option<String>,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub password: String,
    pub database: Option<String>,
}
```

为 MySQL / PostgreSQL 分别实现或用同一 struct 结合 `kind` 校验。`ConnectionSettings` 增加：

```rust
Mysql(DatabaseConnectionSettings),
Postgresql(DatabaseConnectionSettings),
```

`id()` 覆盖新增分支。

- [ ] **Step 4: 运行测试确认通过**

Run:

```powershell
cargo test database_settings_tests
```

Expected: tests pass.

- [ ] **Step 5: 提交**

```powershell
git add src-tauri/src/models/settings.rs src-tauri/src/tests/database_settings_tests.rs src-tauri/src/tests/mod.rs
git commit -m "feat(database): 添加数据库连接配置模型"
```

---

## Task 2: 前端连接类型和连接编辑器

**Files:**
- Modify: `src/features/settings/settingsTypes.ts`
- Modify: `src/features/connections/ConnectionDialog.tsx`
- Test: `src/features/connections/ConnectionDialog.test.tsx`
- Modify: `src/i18n/locales/zh-CN.ts`
- Modify: `src/i18n/locales/en-US.ts`

- [ ] **Step 1: 写失败测试**

在 `ConnectionDialog.test.tsx` 增加：

```tsx
it("saves a mysql connection with username and password", async () => {
  const onSave = vi.fn();
  render(<ConnectionDialog open connectionGroups={[]} onClose={vi.fn()} onSave={onSave} />);

  await userEvent.selectOptions(screen.getByLabelText("连接类型"), "mysql");
  await userEvent.type(screen.getByLabelText("名称"), "开发 MySQL");
  await userEvent.type(screen.getByLabelText("主机"), "127.0.0.1");
  await userEvent.clear(screen.getByLabelText("端口"));
  await userEvent.type(screen.getByLabelText("端口"), "3306");
  await userEvent.type(screen.getByLabelText("用户名"), "root");
  await userEvent.type(screen.getByLabelText("密码"), "secret");
  await userEvent.type(screen.getByLabelText("默认数据库"), "app");
  await userEvent.click(screen.getByRole("button", { name: "保存" }));

  expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
    kind: "mysql",
    name: "开发 MySQL",
    host: "127.0.0.1",
    port: 3306,
    username: "root",
    password: "secret",
    database: "app",
  }));
});
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```powershell
.\node_modules\.bin\vitest.cmd run --config C:\Dev\devhub\vite.config.ts --environment jsdom src\features\connections\ConnectionDialog.test.tsx
```

Expected: 连接类型没有 `mysql` 导致失败。

- [ ] **Step 3: 实现类型**

在 `settingsTypes.ts` 增加：

```ts
export interface DatabaseConnectionSettings {
  kind: "mysql" | "postgresql";
  id: string;
  name: string;
  group?: string;
  host: string;
  port: number;
  username: string;
  password: string;
  database?: string;
}

export type ConnectionSettings = SshConnectionSettings | RedisConnectionSettings | DatabaseConnectionSettings;
```

- [ ] **Step 4: 实现表单**

在 `ConnectionDialog.tsx` 中：

- 连接类型选择项增加 MySQL / PostgreSQL。
- MySQL 默认端口 3306。
- PostgreSQL 默认端口 5432。
- 字段为名称、分组、主机、端口、用户名、密码、默认数据库。
- 数据库类型保存时生成 `kind`、`id`、`name`、`group`、`host`、`port`、`username`、`password`、`database`。

- [ ] **Step 5: 运行测试确认通过**

Run:

```powershell
.\node_modules\.bin\vitest.cmd run --config C:\Dev\devhub\vite.config.ts --environment jsdom src\features\connections\ConnectionDialog.test.tsx
```

Expected: tests pass.

- [ ] **Step 6: 提交**

```powershell
git add src/features/settings/settingsTypes.ts src/features/connections/ConnectionDialog.tsx src/features/connections/ConnectionDialog.test.tsx src/i18n/locales/zh-CN.ts src/i18n/locales/en-US.ts
git commit -m "feat(database): 支持编辑数据库连接"
```

---

## Task 3: 后端数据库连接和测试连接命令

**Files:**
- Modify: `src-tauri/Cargo.toml`
- Create: `src-tauri/src/db/mod.rs`
- Create: `src-tauri/src/db/connection.rs`
- Create: `src-tauri/src/models/database.rs`
- Modify: `src-tauri/src/models/mod.rs`
- Create: `src-tauri/src/commands/database.rs`
- Modify: `src-tauri/src/commands/mod.rs`
- Modify: `src-tauri/src/lib.rs`
- Test: `src-tauri/src/tests/database_query_tests.rs`

- [ ] **Step 1: 写 URL 构造测试**

```rust
#[test]
fn builds_mysql_connection_url() {
    let connection = DatabaseConnectionSettings {
        kind: "mysql".to_string(),
        id: "mysql-dev".to_string(),
        name: "dev".to_string(),
        group: None,
        host: "127.0.0.1".to_string(),
        port: 3306,
        username: "root".to_string(),
        password: "p@ss word".to_string(),
        database: Some("app".to_string()),
    };

    assert_eq!(
        database_connection_url(&connection).unwrap(),
        "mysql://root:p%40ss%20word@127.0.0.1:3306/app"
    );
}
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```powershell
cargo test database_query_tests
```

Expected: `database_connection_url` 不存在。

- [ ] **Step 3: 增加依赖**

`src-tauri/Cargo.toml` 增加：

```toml
sqlx = { version = "0.8", default-features = false, features = ["runtime-tokio-rustls", "mysql", "postgres"] }
```

- [ ] **Step 4: 实现连接模块**

`db/connection.rs` 提供：

```rust
pub fn database_connection_url(connection: &DatabaseConnectionSettings) -> Result<String, String>;

#[derive(Clone, Default)]
pub struct DatabaseConnectionManager;

impl DatabaseConnectionManager {
    pub async fn test_connection(&self, connection: &DatabaseConnectionSettings) -> Result<(), String>;
}
```

第一版可以先不做复杂连接池，使用短连接测试；执行查询任务再按需引入池或复用。

- [ ] **Step 5: 实现 Tauri commands**

`commands/database.rs` 提供：

```rust
#[tauri::command]
pub async fn test_database_connection(
    settings_store: State<'_, SettingsStore>,
    database_manager: State<'_, DatabaseConnectionManager>,
    connection_id: String,
) -> Result<String, String>;

#[tauri::command]
pub async fn test_database_connection_config(
    database_manager: State<'_, DatabaseConnectionManager>,
    connection: DatabaseConnectionSettings,
) -> Result<String, String>;
```

- [ ] **Step 6: 注册命令和 manager**

在 `lib.rs`：

```rust
app.manage(DatabaseConnectionManager::default());
commands::database::test_database_connection,
commands::database::test_database_connection_config,
```

- [ ] **Step 7: 运行测试**

Run:

```powershell
cargo test database_query_tests
cargo test
```

Expected: all pass.

- [ ] **Step 8: 提交**

```powershell
git add src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/db src-tauri/src/models src-tauri/src/commands src-tauri/src/lib.rs src-tauri/src/tests/database_query_tests.rs
git commit -m "feat(database): 添加数据库连接测试命令"
```

---

## Task 4: 连接面板展示和打开数据库标签

**Files:**
- Modify: `src/features/connections/ConnectionList.tsx`
- Test: `src/features/connections/ConnectionList.test.tsx`
- Modify: `src/app/AppShell.tsx`
- Test: `src/app/AppShell.test.tsx`
- Create: `src/features/database/DatabaseWorkspace.tsx`
- Create: `src/features/database/databaseTypes.ts`
- Modify: `src/i18n/locales/zh-CN.ts`
- Modify: `src/i18n/locales/en-US.ts`

- [ ] **Step 1: 写失败测试**

`AppShell.test.tsx` 增加：

```tsx
it("opens a database workspace tab from a mysql connection", async () => {
  settings = {
    ...createSettings(),
    connections: [{
      kind: "mysql",
      id: "mysql-dev",
      name: "开发 MySQL",
      host: "127.0.0.1",
      port: 3306,
      username: "root",
      password: "secret",
      database: "app",
    }],
  };

  render(<AppShell />);

  await userEvent.dblClick(screen.getByText("开发 MySQL").closest("li") as HTMLElement);

  expect(within(screen.getByLabelText("工作区标签")).getByRole("button", { name: "开发 MySQL" })).toBeInTheDocument();
  expect(screen.getByLabelText("数据库工作区")).toBeInTheDocument();
});
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```powershell
.\node_modules\.bin\vitest.cmd run --config C:\Dev\devhub\vite.config.ts --environment jsdom src\app\AppShell.test.tsx src\features\connections\ConnectionList.test.tsx
```

Expected: 数据库连接不被识别。

- [ ] **Step 3: 实现连接展示**

在 `ConnectionList.tsx`：

- `kind === "mysql"` 使用数据库图标和 `mysql://host:port/database`。
- `kind === "postgresql"` 使用数据库图标和 `postgresql://host:port/database`。
- 双击触发 `onOpenDatabase(connection.id)`。

- [ ] **Step 4: 实现工作区占位**

`DatabaseWorkspace.tsx`：

```tsx
export function DatabaseWorkspace({ connectionId }: { connectionId: string }) {
  return (
    <section className="database-workspace" aria-label="数据库工作区">
      <div className="database-workspace__empty">{connectionId}</div>
    </section>
  );
}
```

`AppShell.tsx` 增加 `DatabaseWorkspaceTab`，渲染 `DatabaseWorkspace`。

- [ ] **Step 5: 运行测试确认通过**

Run:

```powershell
.\node_modules\.bin\vitest.cmd run --config C:\Dev\devhub\vite.config.ts --environment jsdom src\app\AppShell.test.tsx src\features\connections\ConnectionList.test.tsx
```

Expected: tests pass.

- [ ] **Step 6: 提交**

```powershell
git add src/features/connections/ConnectionList.tsx src/features/connections/ConnectionList.test.tsx src/app/AppShell.tsx src/app/AppShell.test.tsx src/features/database src/i18n/locales/zh-CN.ts src/i18n/locales/en-US.ts
git commit -m "feat(database): 支持打开数据库工作区"
```

---

## Task 5: 对象树后端元数据查询

**Files:**
- Create: `src-tauri/src/db/metadata.rs`
- Modify: `src-tauri/src/models/database.rs`
- Modify: `src-tauri/src/commands/database.rs`
- Test: `src-tauri/src/tests/database_query_tests.rs`

- [ ] **Step 1: 写纯函数测试**

先测试数据库类型到元数据 SQL 的映射，不依赖真实数据库。

```rust
#[test]
fn builds_mysql_table_metadata_query() {
    let query = metadata_query_for_tables("mysql", "app", None).unwrap();

    assert!(query.sql.contains("information_schema.tables"));
    assert!(query.sql.contains("table_schema"));
}

#[test]
fn builds_postgresql_column_metadata_query() {
    let query = metadata_query_for_columns("postgresql", "public", "users").unwrap();

    assert!(query.sql.contains("information_schema.columns"));
    assert!(query.sql.contains("table_schema"));
}
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```powershell
cargo test database_query_tests
```

- [ ] **Step 3: 定义模型**

`models/database.rs`：

```rust
#[derive(Debug, Clone, Serialize)]
pub struct DatabaseTreeNode {
    pub id: String,
    pub name: String,
    pub kind: String,
    pub has_children: bool,
    pub detail: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ListDatabaseObjectsRequest {
    pub connection_id: String,
    pub parent_kind: Option<String>,
    pub database: Option<String>,
    pub schema: Option<String>,
    pub table: Option<String>,
}
```

- [ ] **Step 4: 实现元数据查询**

提供：

```rust
pub async fn list_database_objects(
    manager: &DatabaseConnectionManager,
    connection: &DatabaseConnectionSettings,
    request: &ListDatabaseObjectsRequest,
) -> Result<Vec<DatabaseTreeNode>, String>;
```

第一版支持：

- MySQL database 列表。
- MySQL 表/视图列表。
- MySQL 字段列表。
- PostgreSQL schema 列表。
- PostgreSQL 表/视图列表。
- PostgreSQL 字段列表。

- [ ] **Step 5: Tauri command**

`commands/database.rs` 增加：

```rust
#[tauri::command]
pub async fn list_database_objects(
    settings_store: State<'_, SettingsStore>,
    database_manager: State<'_, DatabaseConnectionManager>,
    request: ListDatabaseObjectsRequest,
) -> Result<Vec<DatabaseTreeNode>, String>;
```

- [ ] **Step 6: 运行 Rust 测试**

Run:

```powershell
cargo test database_query_tests
cargo test
```

Expected: all pass.

- [ ] **Step 7: 提交**

```powershell
git add src-tauri/src/db/metadata.rs src-tauri/src/models/database.rs src-tauri/src/commands/database.rs src-tauri/src/tests/database_query_tests.rs
git commit -m "feat(database): 添加数据库对象树查询"
```

---

## Task 6: 前端对象树

**Files:**
- Create: `src/features/database/DatabaseObjectTree.tsx`
- Modify: `src/features/database/DatabaseWorkspace.tsx`
- Test: `src/features/database/DatabaseWorkspace.test.tsx`
- Modify: `src/styles/globals.css`

- [ ] **Step 1: 写失败测试**

```tsx
it("loads and expands database object tree nodes", async () => {
  callBackendMock.mockImplementation((command) => {
    if (command === "list_database_objects") {
      return Promise.resolve([
        { id: "db:app", name: "app", kind: "database", has_children: true },
      ]);
    }
    return Promise.resolve([]);
  });

  render(<DatabaseWorkspace connectionId="mysql-dev" />);

  expect(await screen.findByText("app")).toBeInTheDocument();
});
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```powershell
.\node_modules\.bin\vitest.cmd run --config C:\Dev\devhub\vite.config.ts --environment jsdom src\features\database\DatabaseWorkspace.test.tsx
```

- [ ] **Step 3: 实现对象树组件**

`DatabaseObjectTree`：

- 初次加载调用 `list_database_objects`。
- 点击有子节点的节点时加载子节点。
- 节点显示名称和简短 detail。
- 节点错误显示在节点下方。

- [ ] **Step 4: 接入工作区**

`DatabaseWorkspace` 左侧渲染对象树，右侧保留 SQL/结果占位。

- [ ] **Step 5: 运行测试**

Run:

```powershell
.\node_modules\.bin\vitest.cmd run --config C:\Dev\devhub\vite.config.ts --environment jsdom src\features\database\DatabaseWorkspace.test.tsx
```

- [ ] **Step 6: 提交**

```powershell
git add src/features/database src/styles/globals.css
git commit -m "feat(database): 添加数据库对象树界面"
```

---

## Task 7: SQL 执行后端

**Files:**
- Create: `src-tauri/src/db/query.rs`
- Modify: `src-tauri/src/models/database.rs`
- Modify: `src-tauri/src/commands/database.rs`
- Test: `src-tauri/src/tests/database_query_tests.rs`

- [ ] **Step 1: 写限制和危险语句测试**

```rust
#[test]
fn appends_default_limit_to_select_without_limit() {
    assert_eq!(
        apply_select_limit("select * from users", 200).unwrap(),
        "select * from users LIMIT 200"
    );
}

#[test]
fn keeps_select_with_existing_limit() {
    assert_eq!(
        apply_select_limit("select * from users limit 20", 200).unwrap(),
        "select * from users limit 20"
    );
}

#[test]
fn detects_dangerous_sql() {
    assert!(is_dangerous_sql("delete from users"));
    assert!(!is_dangerous_sql("select * from users"));
}
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```powershell
cargo test database_query_tests
```

- [ ] **Step 3: 定义模型**

`models/database.rs`：

```rust
#[derive(Debug, Clone, Deserialize)]
pub struct ExecuteDatabaseQueryRequest {
    pub connection_id: String,
    pub database: Option<String>,
    pub sql: String,
    pub limit: Option<u32>,
}

#[derive(Debug, Clone, Serialize)]
pub struct DatabaseQueryResult {
    pub columns: Vec<DatabaseResultColumn>,
    pub rows: Vec<Vec<DatabaseCellValue>>,
    pub affected_rows: u64,
    pub duration_ms: u128,
    pub limited: bool,
}
```

- [ ] **Step 4: 实现 SQL helper**

实现：

- `is_select_sql(sql: &str) -> bool`
- `is_dangerous_sql(sql: &str) -> bool`
- `apply_select_limit(sql: &str, limit: u32) -> Result<String, String>`

危险语句按第一条有效语句识别，不确定时返回危险。

- [ ] **Step 5: 实现执行命令**

`execute_database_query`：

- 加载连接。
- 对 SELECT 应用限制。
- 执行 SQL。
- 返回列、行、影响行数、耗时、是否限制。
- 成功或失败都写入查询历史。

- [ ] **Step 6: 运行测试**

Run:

```powershell
cargo test database_query_tests
cargo test
```

- [ ] **Step 7: 提交**

```powershell
git add src-tauri/src/db/query.rs src-tauri/src/models/database.rs src-tauri/src/commands/database.rs src-tauri/src/tests/database_query_tests.rs
git commit -m "feat(database): 添加 SQL 执行能力"
```

---

## Task 8: SQL 编辑器和结果表格

**Files:**
- Create: `src/features/database/SqlEditor.tsx`
- Create: `src/features/database/QueryResultTable.tsx`
- Modify: `src/features/database/DatabaseWorkspace.tsx`
- Test: `src/features/database/DatabaseWorkspace.test.tsx`
- Modify: `src/styles/globals.css`

- [ ] **Step 1: 写失败测试**

```tsx
it("executes sql and renders query results", async () => {
  callBackendMock.mockImplementation((command) => {
    if (command === "execute_database_query") {
      return Promise.resolve({
        columns: [{ name: "id", data_type: "int" }],
        rows: [[{ kind: "number", value: "1" }]],
        affected_rows: 0,
        duration_ms: 12,
        limited: true,
      });
    }
    if (command === "list_database_objects") return Promise.resolve([]);
    return Promise.resolve([]);
  });

  render(<DatabaseWorkspace connectionId="mysql-dev" />);

  await userEvent.type(screen.getByLabelText("SQL 编辑器"), "select * from users");
  await userEvent.click(screen.getByRole("button", { name: "执行" }));

  expect(await screen.findByText("id")).toBeInTheDocument();
  expect(screen.getByText("1")).toBeInTheDocument();
  expect(screen.getByText("结果已限制为 200 行")).toBeInTheDocument();
});
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```powershell
.\node_modules\.bin\vitest.cmd run --config C:\Dev\devhub\vite.config.ts --environment jsdom src\features\database\DatabaseWorkspace.test.tsx
```

- [ ] **Step 3: 实现 SQL 编辑器**

`SqlEditor`：

- textarea。
- limit 输入，默认 200。
- 执行按钮。
- 危险 SQL 前弹出项目内确认弹窗。

- [ ] **Step 4: 实现结果表格**

`QueryResultTable`：

- 表头列名。
- 行号。
- `NULL` 特殊显示。
- 大文本截断。
- 错误和耗时显示。

- [ ] **Step 5: 运行测试**

Run:

```powershell
.\node_modules\.bin\vitest.cmd run --config C:\Dev\devhub\vite.config.ts --environment jsdom src\features\database\DatabaseWorkspace.test.tsx
```

- [ ] **Step 6: 提交**

```powershell
git add src/features/database src/styles/globals.css
git commit -m "feat(database): 添加 SQL 编辑器和结果表格"
```

---

## Task 9: 双击表查看数据

**Files:**
- Modify: `src/features/database/DatabaseObjectTree.tsx`
- Modify: `src/features/database/DatabaseWorkspace.tsx`
- Test: `src/features/database/DatabaseWorkspace.test.tsx`
- Modify: `src-tauri/src/db/query.rs`
- Test: `src-tauri/src/tests/database_query_tests.rs`

- [ ] **Step 1: 写后端引用测试**

```rust
#[test]
fn quotes_mysql_identifier() {
    assert_eq!(quote_identifier("mysql", "user`log").unwrap(), "`user``log`");
}

#[test]
fn quotes_postgresql_identifier() {
    assert_eq!(quote_identifier("postgresql", "user\"log").unwrap(), "\"user\"\"log\"");
}
```

- [ ] **Step 2: 写前端双击测试**

```tsx
it("loads table data when double clicking a table", async () => {
  callBackendMock.mockImplementation((command) => {
    if (command === "list_database_objects") {
      return Promise.resolve([{ id: "table:users", name: "users", kind: "table", has_children: true }]);
    }
    if (command === "execute_database_query") {
      return Promise.resolve({ columns: [], rows: [], affected_rows: 0, duration_ms: 1, limited: true });
    }
    return Promise.resolve([]);
  });

  render(<DatabaseWorkspace connectionId="mysql-dev" />);

  await userEvent.dblClick(await screen.findByText("users"));

  expect(callBackendMock).toHaveBeenCalledWith("execute_database_query", expect.objectContaining({
    request: expect.objectContaining({ sql: "SELECT * FROM `users` LIMIT 200" }),
  }));
});
```

- [ ] **Step 3: 运行测试确认失败**

Run:

```powershell
cargo test database_query_tests
.\node_modules\.bin\vitest.cmd run --config C:\Dev\devhub\vite.config.ts --environment jsdom src\features\database\DatabaseWorkspace.test.tsx
```

- [ ] **Step 4: 实现引用和双击**

后端提供 `quote_identifier(kind, name)`。

前端双击表时：

- 生成 SELECT。
- 填入 SQL 编辑器。
- 调用执行查询。

- [ ] **Step 5: 运行测试**

Run same commands.

- [ ] **Step 6: 提交**

```powershell
git add src-tauri/src/db/query.rs src-tauri/src/tests/database_query_tests.rs src/features/database src/styles/globals.css
git commit -m "feat(database): 支持双击表查看数据"
```

---

## Task 10: SQLite 查询历史

**Files:**
- Create: `src-tauri/src/db/history.rs`
- Modify: `src-tauri/src/db/mod.rs`
- Modify: `src-tauri/src/commands/database.rs`
- Modify: `src-tauri/src/models/database.rs`
- Modify: `src-tauri/src/lib.rs`
- Test: `src-tauri/src/tests/database_history_tests.rs`

- [ ] **Step 1: 写失败测试**

```rust
#[test]
fn keeps_latest_100_query_history_items_per_connection() {
    let temp = tempfile::tempdir().unwrap();
    let store = QueryHistoryStore::new_for_dir(temp.path().to_path_buf());

    for index in 0..105 {
        store.record(QueryHistoryRecord {
            connection_id: "mysql-dev".to_string(),
            database_kind: "mysql".to_string(),
            database_name: Some("app".to_string()),
            sql_text: format!("select {index}"),
            duration_ms: 1,
            success: true,
            error_message: None,
        }).unwrap();
    }

    let items = store.list("mysql-dev", 200).unwrap();

    assert_eq!(items.len(), 100);
    assert_eq!(items[0].sql_text, "select 104");
}
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```powershell
cargo test database_history_tests
```

- [ ] **Step 3: 实现 QueryHistoryStore**

`history.rs`：

- `QueryHistoryStore::new_for_dir(app_dir: PathBuf)`
- `init()`
- `record(record)`
- `list(connection_id, limit)`
- `trim(connection_id, keep = 100)`

数据库文件：`app_dir/devhub.db`。

- [ ] **Step 4: 接入 lib.rs**

`setup` 中：

```rust
app.manage(QueryHistoryStore::new_for_dir(app_dir.clone()));
```

- [ ] **Step 5: 命令**

增加：

```rust
#[tauri::command]
pub async fn list_database_query_history(
    history_store: State<'_, QueryHistoryStore>,
    connection_id: String,
) -> Result<Vec<QueryHistoryItem>, String>;
```

`execute_database_query` 成功/失败后调用 `record`。

- [ ] **Step 6: 运行测试**

Run:

```powershell
cargo test database_history_tests
cargo test
```

- [ ] **Step 7: 提交**

```powershell
git add src-tauri/src/db/history.rs src-tauri/src/db/mod.rs src-tauri/src/commands/database.rs src-tauri/src/models/database.rs src-tauri/src/lib.rs src-tauri/src/tests/database_history_tests.rs
git commit -m "feat(database): 添加查询历史存储"
```

---

## Task 11: 查询历史面板

**Files:**
- Create: `src/features/database/QueryHistoryPanel.tsx`
- Modify: `src/features/database/DatabaseWorkspace.tsx`
- Test: `src/features/database/DatabaseWorkspace.test.tsx`
- Modify: `src/styles/globals.css`

- [ ] **Step 1: 写失败测试**

```tsx
it("loads query history and fills sql editor from history item", async () => {
  callBackendMock.mockImplementation((command) => {
    if (command === "list_database_query_history") {
      return Promise.resolve([{ id: 1, sql_text: "select * from users", executed_at: "2026-06-20 12:00:00", duration_ms: 10, success: true }]);
    }
    if (command === "list_database_objects") return Promise.resolve([]);
    return Promise.resolve([]);
  });

  render(<DatabaseWorkspace connectionId="mysql-dev" />);

  await userEvent.click(screen.getByRole("button", { name: "查询历史" }));
  await userEvent.click(await screen.findByText("select * from users"));

  expect(screen.getByLabelText("SQL 编辑器")).toHaveValue("select * from users");
});
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```powershell
.\node_modules\.bin\vitest.cmd run --config C:\Dev\devhub\vite.config.ts --environment jsdom src\features\database\DatabaseWorkspace.test.tsx
```

- [ ] **Step 3: 实现历史面板**

历史面板：

- 按钮打开/关闭。
- 调用 `list_database_query_history`。
- 显示 SQL 摘要、时间、耗时、成功/失败。
- 点击项填回编辑器。

- [ ] **Step 4: 运行测试**

Run same command.

- [ ] **Step 5: 提交**

```powershell
git add src/features/database src/styles/globals.css
git commit -m "feat(database): 添加查询历史面板"
```

---

## Task 12: 危险 SQL 确认弹窗

**Files:**
- Modify: `src/features/database/SqlEditor.tsx`
- Modify: `src/features/database/DatabaseWorkspace.tsx`
- Test: `src/features/database/DatabaseWorkspace.test.tsx`

- [ ] **Step 1: 写失败测试**

```tsx
it("asks for confirmation before running dangerous sql", async () => {
  callBackendMock.mockResolvedValue({ columns: [], rows: [], affected_rows: 1, duration_ms: 2, limited: false });

  render(<DatabaseWorkspace connectionId="mysql-dev" />);

  await userEvent.type(screen.getByLabelText("SQL 编辑器"), "delete from users");
  await userEvent.click(screen.getByRole("button", { name: "执行" }));

  expect(screen.getByRole("dialog", { name: "确认执行危险 SQL" })).toBeInTheDocument();
  expect(callBackendMock).not.toHaveBeenCalledWith("execute_database_query", expect.anything());

  await userEvent.click(screen.getByRole("button", { name: "确认执行" }));

  expect(callBackendMock).toHaveBeenCalledWith("execute_database_query", expect.anything());
});
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```powershell
.\node_modules\.bin\vitest.cmd run --config C:\Dev\devhub\vite.config.ts --environment jsdom src\features\database\DatabaseWorkspace.test.tsx
```

- [ ] **Step 3: 实现前端危险判断**

前端用和后端一致的保守列表：

```ts
const DANGEROUS_SQL = /^(insert|update|delete|drop|truncate|alter|create|replace|grant|revoke)\b/i;
```

执行危险 SQL 前显示项目内确认弹窗，不使用浏览器 confirm。

- [ ] **Step 4: 运行测试**

Run same command.

- [ ] **Step 5: 提交**

```powershell
git add src/features/database
git commit -m "feat(database): 添加危险 SQL 执行确认"
```

---

## Task 13: 设置页和 i18n 收口

**Files:**
- Modify: `src/features/settings/SettingsPanel.tsx`
- Test: `src/features/settings/SettingsPanel.test.tsx`
- Modify: `src/i18n/locales/zh-CN.ts`
- Modify: `src/i18n/locales/en-US.ts`

- [ ] **Step 1: 写失败测试**

设置页连接摘要应包含数据库连接数量：

```tsx
it("includes database connections in connection summary", () => {
  settings = {
    ...createSettings(),
    connections: [
      { kind: "mysql", id: "mysql-dev", name: "开发 MySQL", host: "127.0.0.1", port: 3306, username: "root", password: "secret", database: "app" },
    ],
  };

  render(<SettingsPanel />);

  expect(screen.getByText(/1 个连接/)).toBeInTheDocument();
});
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```powershell
.\node_modules\.bin\vitest.cmd run --config C:\Dev\devhub\vite.config.ts --environment jsdom src\features\settings\SettingsPanel.test.tsx
```

- [ ] **Step 3: 补 i18n 和摘要**

确保新增数据库文案覆盖 zh-CN / en-US。

- [ ] **Step 4: 运行测试**

Run same command.

- [ ] **Step 5: 提交**

```powershell
git add src/features/settings/SettingsPanel.tsx src/features/settings/SettingsPanel.test.tsx src/i18n/locales/zh-CN.ts src/i18n/locales/en-US.ts
git commit -m "feat(database): 完善数据库文案和设置摘要"
```

---

## Task 14: 文档和最终验证

**Files:**
- Modify: `README.md`
- Modify: `docs/当前状态与下一步.md`
- Modify: `docs/superpowers/specs/2026-06-20-database-management-a-design.md`

- [ ] **Step 1: 更新 README**

加入数据库 A 版能力：

- MySQL / PostgreSQL 直连。
- 连接测试。
- 对象树。
- SQL 编辑器。
- 查询结果。
- 查询历史。
- 默认限制 200 行。

- [ ] **Step 2: 更新当前状态**

在 `docs/当前状态与下一步.md` 的最近完成中加入数据库 A 版完成项，并调整下一步建议为数据库 B 版。

- [ ] **Step 3: 运行前端全量测试**

Run:

```powershell
.\node_modules\.bin\vitest.cmd run --config C:\Dev\devhub\vite.config.ts --environment jsdom
```

Expected: all tests pass.

- [ ] **Step 4: 运行类型检查**

Run:

```powershell
.\node_modules\.bin\tsc.cmd --noEmit
```

Expected: exit 0.

- [ ] **Step 5: 运行 Rust 测试和格式检查**

Run:

```powershell
cargo test
cargo fmt --check
```

Working directory: `src-tauri`

Expected: all tests pass, fmt check exit 0.

- [ ] **Step 6: 运行 diff 检查**

Run:

```powershell
git diff --check
```

Expected: no output, exit 0.

- [ ] **Step 7: 提交**

```powershell
git add README.md docs/当前状态与下一步.md docs/superpowers/specs/2026-06-20-database-management-a-design.md
git commit -m "docs(database): 更新数据库管理 A 版文档"
```

---

## Self-Review

### 设计覆盖

- MySQL / PostgreSQL：Task 1、3、5、7。
- 直连用户名密码：Task 1、2、3。
- 密码保存到 `settings.json`：Task 1、2。
- 连接测试：Task 3。
- 连接面板和数据库标签：Task 4。
- 对象树：Task 5、6。
- SQL 编辑器和任意 SQL：Task 7、8。
- 危险 SQL 确认：Task 7、12。
- 默认限制 200：Task 7、8、9。
- 双击表查看数据：Task 9。
- SQLite 查询历史：Task 10、11。
- 文档：Task 14。

### 风险和约束

- `sqlx` 依赖会增加编译时间和包体积；实现 Task 3 时如果评估明显过重，允许改为 `mysql_async` + `tokio-postgres`，但需要同步更新设计文档和本计划。
- 自动追加 `LIMIT` 对复杂 SELECT 可能不完美；A 版只做保守处理，后续可改为后端读取限制行数并提示截断。
- 第一版不做 SSH tunnel、SSL 和数据编辑，避免数据库模块范围膨胀。

### 验证命令总表

```powershell
.\node_modules\.bin\vitest.cmd run --config C:\Dev\devhub\vite.config.ts --environment jsdom
.\node_modules\.bin\tsc.cmd --noEmit
```

```powershell
cargo test
cargo fmt --check
```

Working directory for Rust commands: `C:\Dev\devhub\src-tauri`

```powershell
git diff --check
```
