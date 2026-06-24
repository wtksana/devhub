# 应用操作日志补全 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 补全 DevHub 应用操作日志覆盖面，让 Redis、SFTP、数据库和前端关键错误都能写入脱敏后的本地 JSON Lines 日志。

**Architecture:** 继续以 `src-tauri/src/core/app_logger.rs` 作为唯一后端写入边界，在这里统一做脱敏、截断和 metadata 清洗。后端 command 通过 `commands::logging::log_operation` 写结构化操作日志；前端新增轻量 `logFrontendEvent` / `logFrontendError` helper，通过现有 `write_app_log` command 写 UI 层错误，日志失败静默吞掉。

**Tech Stack:** Rust、Tauri command、serde_json、React、TypeScript、Vitest、Cargo test。

---

## File Structure

- Modify `src-tauri/src/core/app_logger.rs`
  - 负责日志 entry 脱敏、字符串截断、metadata 清洗和相关 Rust 测试。
- Modify `src-tauri/src/commands/logging.rs`
  - `FrontendLogEntry` 增加 metadata；`log_operation` 增加 metadata 参数；提供 `metadata_string` / `metadata_number` / `metadata_bool` 等小 helper。
- Modify `src-tauri/src/commands/redis.rs`
  - 补齐 Redis key 查看、编辑、新增、删除、TTL、批量操作日志。
- Modify `src-tauri/src/commands/sftp.rs`
  - 补齐 SFTP 文件操作、文件夹传输、旧入口日志。
- Modify `src-tauri/src/commands/database.rs`
  - 补齐对象树、表数据增删改、DDL、SQL 文件日志。
- Create `src/lib/appLogging.ts`
  - 前端日志 helper，封装 `write_app_log`，吞掉日志失败。
- Add tests `src/lib/appLogging.test.ts`
  - 覆盖前端日志 helper 正常调用和失败吞掉。
- Modify selected frontend files:
  - `src/features/settings/useSettings.ts`
  - `src/features/connections/ConnectionList.tsx`
  - `src/features/sftp/SftpWorkspace.tsx`
  - `src/features/redis/RedisWorkspace.tsx`
  - `src/features/database/DatabaseObjectTree.tsx`
  - `src/features/database/DatabaseWorkspace.tsx`
  - `src/features/database/DatabaseTableBrowser.tsx`
- Modify selected frontend tests:
  - `src/features/connections/ConnectionList.test.tsx`
  - `src/features/settings/SettingsPanel.test.tsx`
  - Keep test edits scoped to logging assertions when practical.
- Modify docs:
  - `README.md`
  - `docs/当前状态与下一步.md`
  - `docs/testing/manual-mvp-checklist.md`

---

### Task 1: AppLogger 脱敏、截断和 metadata

**Files:**
- Modify: `src-tauri/src/core/app_logger.rs`
- Modify: `src-tauri/src/commands/logging.rs`

- [ ] **Step 1: Write failing Rust tests for redaction and truncation**

Add tests to `src-tauri/src/core/app_logger.rs` inside the existing `#[cfg(test)] mod tests`:

```rust
#[test]
fn redacts_sensitive_strings_before_writing() {
    let temp_dir = tempfile::tempdir().unwrap();
    let logger = AppLogger::new_for_dir(temp_dir.path().to_path_buf());
    let entry = AppLogEntry::new("error", "database", "execute_database_query")
        .target("mysql://root:secret-password@127.0.0.1/app")
        .message("authorization: Bearer abc123")
        .error("redis://:redis-password@127.0.0.1/0");

    logger.write(&settings(), entry).unwrap();

    let content = read_first_log_line(temp_dir.path());
    assert!(!content.contains("secret-password"));
    assert!(!content.contains("abc123"));
    assert!(!content.contains("redis-password"));
    assert!(content.contains("[REDACTED]"));
}

#[test]
fn redacts_sensitive_metadata_and_truncates_long_values() {
    let temp_dir = tempfile::tempdir().unwrap();
    let logger = AppLogger::new_for_dir(temp_dir.path().to_path_buf());
    let mut metadata = serde_json::Map::new();
    metadata.insert("password".to_string(), serde_json::Value::String("plain".to_string()));
    metadata.insert("sql_kind".to_string(), serde_json::Value::String("select".to_string()));
    metadata.insert("long".to_string(), serde_json::Value::String("x".repeat(3000)));
    let entry = AppLogEntry::new("info", "frontend.database", "load")
        .result("failed")
        .metadata(metadata);

    logger.write(&settings(), entry).unwrap();

    let content = read_first_log_line(temp_dir.path());
    let value: Value = serde_json::from_str(&content).unwrap();
    assert_eq!(value["metadata"]["password"], "[REDACTED]");
    assert_eq!(value["metadata"]["sql_kind"], "select");
    assert!(value["metadata"]["long"].as_str().unwrap().len() <= 2015);
}
```

Add this helper in the test module:

```rust
fn read_first_log_line(app_dir: &std::path::Path) -> String {
    let log_dir = app_dir.join("logs");
    let file = fs::read_dir(&log_dir)
        .unwrap()
        .next()
        .unwrap()
        .unwrap()
        .path();
    fs::read_to_string(file).unwrap().trim().to_string()
}
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```powershell
cargo test --manifest-path src-tauri\Cargo.toml core::app_logger::tests::redacts_sensitive_strings_before_writing core::app_logger::tests::redacts_sensitive_metadata_and_truncates_long_values
```

Expected: cargo only accepts one filter, so if it errors with unexpected argument, run:

```powershell
cargo test --manifest-path src-tauri\Cargo.toml core::app_logger::tests
```

Expected failure: new tests fail because strings are not redacted/truncated yet.

- [ ] **Step 3: Implement sanitization in AppLogger**

In `src-tauri/src/core/app_logger.rs`, add:

```rust
const MAX_LOG_FIELD_LEN: usize = 2000;
const REDACTED: &str = "[REDACTED]";
const SENSITIVE_KEYS: &[&str] = &[
    "password",
    "passphrase",
    "private_key",
    "privateKey",
    "secret",
    "token",
    "authorization",
    "api_key",
    "apiKey",
];
```

Add methods:

```rust
impl AppLogEntry {
    fn sanitized(mut self) -> Self {
        self.target = self.target.map(|value| sanitize_string(&value));
        self.result = self.result.map(|value| sanitize_string(&value));
        self.message = self.message.map(|value| sanitize_string(&value));
        self.error = self.error.map(|value| sanitize_string(&value));
        self.metadata = self.metadata.map(sanitize_metadata);
        self
    }
}

fn sanitize_metadata(metadata: Map<String, Value>) -> Map<String, Value> {
    metadata
        .into_iter()
        .map(|(key, value)| {
            if is_sensitive_key(&key) {
                (key, Value::String(REDACTED.to_string()))
            } else {
                (key, sanitize_value(value))
            }
        })
        .collect()
}

fn sanitize_value(value: Value) -> Value {
    match value {
        Value::String(value) => Value::String(sanitize_string(&value)),
        Value::Array(values) => Value::Array(values.into_iter().map(sanitize_value).collect()),
        Value::Object(values) => Value::Object(sanitize_metadata(values)),
        other => other,
    }
}

fn sanitize_string(value: &str) -> String {
    let mut sanitized = redact_url_passwords(value);
    sanitized = redact_authorization(&sanitized);
    truncate_string(&sanitized)
}

fn redact_url_passwords(value: &str) -> String {
    let mut result = String::with_capacity(value.len());
    let mut rest = value;
    while let Some(scheme_index) = rest.find("://") {
        let (prefix, after_prefix) = rest.split_at(scheme_index + 3);
        result.push_str(prefix);
        rest = after_prefix;
        if let Some(at_index) = rest.find('@') {
            let credentials = &rest[..at_index];
            if let Some(colon_index) = credentials.rfind(':') {
                result.push_str(&credentials[..=colon_index]);
                result.push_str(REDACTED);
                rest = &rest[at_index..];
                continue;
            }
        }
    }
    result.push_str(rest);
    result
}

fn redact_authorization(value: &str) -> String {
    let lower = value.to_lowercase();
    if lower.contains("authorization") || lower.contains("bearer ") {
        return REDACTED.to_string();
    }
    value.to_string()
}

fn truncate_string(value: &str) -> String {
    if value.chars().count() <= MAX_LOG_FIELD_LEN {
        return value.to_string();
    }
    let truncated = value.chars().take(MAX_LOG_FIELD_LEN).collect::<String>();
    format!("{truncated}...[truncated]")
}

fn is_sensitive_key(key: &str) -> bool {
    SENSITIVE_KEYS
        .iter()
        .any(|sensitive| key.eq_ignore_ascii_case(sensitive))
}
```

In `AppLogger::write`, sanitize before serialization:

```rust
let entry = entry.sanitized();
let line = serde_json::to_string(&entry).map_err(|error| error.to_string())?;
```

- [ ] **Step 4: Extend logging command metadata support**

In `src-tauri/src/commands/logging.rs`, import:

```rust
use serde_json::{Map, Value};
```

Update `FrontendLogEntry`:

```rust
metadata: Option<Map<String, Value>>,
```

Update `write_app_log`:

```rust
if let Some(metadata) = entry.metadata {
    log_entry = log_entry.metadata(metadata);
}
```

Update `log_operation` signature:

```rust
pub fn log_operation(
    settings_store: &SettingsStore,
    logger: &AppLogger,
    level: &str,
    module: &str,
    action: &str,
    target: Option<String>,
    result: &str,
    started_at: Option<Instant>,
    error: Option<String>,
    metadata: Option<Map<String, Value>>,
)
```

Before write:

```rust
if let Some(metadata) = metadata {
    entry = entry.metadata(metadata);
}
```

Add helpers:

```rust
pub fn metadata(items: impl IntoIterator<Item = (&'static str, Value)>) -> Map<String, Value> {
    items.into_iter().map(|(key, value)| (key.to_string(), value)).collect()
}

pub fn metadata_string(value: impl Into<String>) -> Value {
    Value::String(value.into())
}

pub fn metadata_number(value: impl Into<i64>) -> Value {
    Value::Number(value.into().into())
}

pub fn metadata_bool(value: bool) -> Value {
    Value::Bool(value)
}
```

Update all existing `log_operation(...)` call sites to pass the new final `None` argument.

- [ ] **Step 5: Run Rust tests**

Run:

```powershell
cargo test --manifest-path src-tauri\Cargo.toml core::app_logger commands::redis::tests::normalizes_redis_key_scan_request_defaults
```

If cargo rejects multiple filters, run:

```powershell
cargo test --manifest-path src-tauri\Cargo.toml core::app_logger
cargo test --manifest-path src-tauri\Cargo.toml commands::redis::tests::normalizes_redis_key_scan_request_defaults
```

Expected: tests pass.

- [ ] **Step 6: Commit**

```powershell
git add -- src-tauri\src\core\app_logger.rs src-tauri\src\commands\logging.rs src-tauri\src\commands\database.rs src-tauri\src\commands\redis.rs src-tauri\src\commands\settings.rs src-tauri\src\commands\sftp.rs src-tauri\src\commands\terminal.rs
git commit -m "feat(logging): 支持日志脱敏和元数据"
```

---

### Task 2: 后端 Redis/SFTP/Database 命令日志覆盖

**Files:**
- Modify: `src-tauri/src/commands/redis.rs`
- Modify: `src-tauri/src/commands/sftp.rs`
- Modify: `src-tauri/src/commands/database.rs`

- [ ] **Step 1: Add small backend target helpers**

In `redis.rs`, add near helper functions:

```rust
fn redis_key_target(connection_id: &str, database: u16, key: &str) -> String {
    format!("{connection_id}:db{database}:{key}")
}

fn redis_bulk_target(connection_id: &str, database: u16, count: usize) -> String {
    format!("{connection_id}:db{database}:{count} keys")
}
```

In `sftp.rs`, add:

```rust
fn sftp_target(session_id: &str, path: &str) -> String {
    format!("{session_id}:{path}")
}
```

In `database.rs`, add:

```rust
fn database_table_target(connection_id: &str, database: &str, table: &str) -> String {
    format!("{connection_id}:{database}:{table}")
}

fn database_sql_file_target(connection_id: &str, database: &str, name: &str) -> String {
    format!("{connection_id}:{database}:{name}")
}
```

- [ ] **Step 2: Instrument Redis commands**

For each command in `redis.rs` listed in the design, use this exact pattern:

```rust
let started_at = std::time::Instant::now();
let target = redis_key_target(&request.connection_id, request.database, &request.key);
```

For bulk operations use:

```rust
let target = redis_bulk_target(&request.connection_id, request.database, request.keys.len());
```

After existing operation produces `result`, add:

```rust
match &result {
    Ok(_) => log_operation(
        settings_store.inner(),
        logger.inner(),
        "info",
        "redis",
        "<command_name>",
        Some(target),
        "success",
        Some(started_at),
        None,
        Some(metadata([
            ("database", metadata_number(i64::from(request.database))),
        ])),
    ),
    Err(error) => log_operation(
        settings_store.inner(),
        logger.inner(),
        "error",
        "redis",
        "<command_name>",
        Some(target),
        "failed",
        Some(started_at),
        Some(error.clone()),
        Some(metadata([
            ("database", metadata_number(i64::from(request.database))),
        ])),
    ),
}
```

Add `logger: State<'_, AppLogger>` to command signatures that do not have it. Import:

```rust
use crate::core::app_logger::AppLogger;
use crate::commands::logging::{log_operation, metadata, metadata_number, metadata_string};
```

For `create_redis_key`, include:

```rust
("key_type", metadata_string(request.key_type.clone()))
```

For bulk commands, include:

```rust
("count", metadata_number(request.keys.len() as i64))
```

Do not add Redis value/member/field value into metadata.

- [ ] **Step 3: Instrument SFTP commands**

Add `settings_store: State<'_, SettingsStore>` and `logger: State<'_, AppLogger>` to session-based SFTP commands that do not have them.

Use:

```rust
let started_at = std::time::Instant::now();
let target = sftp_target(&request.session_id, &request.path);
```

For rename:

```rust
let target = format!("{}:{} -> {}", request.session_id, request.from, request.to);
```

For multi-path compress:

```rust
let target = format!("{}:{} paths -> {}", request.session_id, request.paths.len(), request.archive_name);
```

For directory transfer, include:

```rust
("transfer_id", metadata_string(request.transfer_id.clone())),
("overwrite", metadata_bool(request.overwrite)),
```

For read text file, include:

```rust
("max_bytes", metadata_number(request.max_bytes as i64)),
```

Do not log text file content.

- [ ] **Step 4: Instrument Database commands**

Add `logger: State<'_, AppLogger>` and log around:

- `list_database_objects`
- `update_database_table_rows`
- `insert_database_table_rows`
- `delete_database_table_rows`
- `get_database_table_ddl`
- `list_database_sql_files`
- `save_database_sql_file`

Use metadata:

```rust
Some(metadata([
    ("database", metadata_string(request.database.clone())),
    ("table", metadata_string(request.table.clone())),
]))
```

For update/insert/delete rows, include row count and field count where available:

```rust
("row_count", metadata_number(request.rows.len() as i64))
```

Do not log cell values or SQL file content.

For `execute_database_query`, extend existing metadata with `sql_kind`. Add helper:

```rust
fn sql_kind(sql: &str) -> &'static str {
    let first = sql
        .split_whitespace()
        .next()
        .unwrap_or_default()
        .to_ascii_lowercase();
    match first.as_str() {
        "select" | "with" => "select",
        "insert" => "insert",
        "update" => "update",
        "delete" => "delete",
        "create" | "alter" | "drop" | "truncate" => "ddl",
        _ => "other",
    }
}
```

- [ ] **Step 5: Run Rust tests**

Run:

```powershell
pnpm test:rust
```

Expected: all Rust tests pass.

- [ ] **Step 6: Commit**

```powershell
git add -- src-tauri\src\commands\redis.rs src-tauri\src\commands\sftp.rs src-tauri\src\commands\database.rs
git commit -m "feat(logging): 补全后端操作日志"
```

---

### Task 3: 前端日志 helper 和关键错误接入

**Files:**
- Create: `src/lib/appLogging.ts`
- Create: `src/lib/appLogging.test.ts`
- Modify: `src/features/settings/useSettings.ts`
- Modify: `src/features/connections/ConnectionList.tsx`
- Modify: `src/features/sftp/SftpWorkspace.tsx`
- Modify: `src/features/redis/RedisWorkspace.tsx`
- Modify: `src/features/database/DatabaseObjectTree.tsx`
- Modify: `src/features/database/DatabaseWorkspace.tsx`
- Modify: `src/features/database/DatabaseTableBrowser.tsx`
- Modify selected tests as needed.

- [ ] **Step 1: Write failing frontend logging helper tests**

Create `src/lib/appLogging.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach } from "vitest";
import { callBackend } from "./tauri";
import { logFrontendError, logFrontendEvent } from "./appLogging";

vi.mock("./tauri", () => ({
  callBackend: vi.fn(),
}));

const callBackendMock = vi.mocked(callBackend);

describe("appLogging", () => {
  beforeEach(() => {
    callBackendMock.mockReset();
  });

  it("writes frontend log entries through the backend", async () => {
    callBackendMock.mockResolvedValue(undefined);

    await logFrontendEvent({
      level: "error",
      module: "frontend.redis",
      action: "load_keys",
      target: "redis-local:db0",
      result: "failed",
      error: "network error",
      metadata: { command: "list_redis_keys" },
    });

    expect(callBackendMock).toHaveBeenCalledWith("write_app_log", {
      entry: {
        level: "error",
        module: "frontend.redis",
        action: "load_keys",
        target: "redis-local:db0",
        result: "failed",
        error: "network error",
        metadata: { command: "list_redis_keys" },
      },
    });
  });

  it("does not throw when frontend logging fails", async () => {
    callBackendMock.mockRejectedValue(new Error("logging failed"));

    await expect(logFrontendError("frontend.sftp", "load_directory", new Error("boom"), "/tmp")).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test and verify failure**

Run:

```powershell
pnpm test -- src\lib\appLogging.test.ts
```

Expected: fails because `src/lib/appLogging.ts` does not exist.

- [ ] **Step 3: Implement frontend logging helper**

Create `src/lib/appLogging.ts`:

```ts
import { callBackend } from "./tauri";

export type FrontendLogLevel = "debug" | "info" | "warn" | "error";

export interface FrontendLogEntry {
  level: FrontendLogLevel;
  module: string;
  action: string;
  target?: string;
  result?: string;
  message?: string;
  error?: string;
  metadata?: Record<string, string | number | boolean | null>;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function logFrontendEvent(entry: FrontendLogEntry): Promise<void> {
  try {
    await callBackend<void>("write_app_log", { entry });
  } catch {
    // 日志失败不能影响业务操作。
  }
}

export function logFrontendError(
  module: string,
  action: string,
  error: unknown,
  target?: string,
  metadata?: FrontendLogEntry["metadata"],
): Promise<void> {
  return logFrontendEvent({
    level: "error",
    module,
    action,
    target,
    result: "failed",
    error: errorMessage(error),
    metadata,
  });
}
```

- [ ] **Step 4: Run helper tests**

Run:

```powershell
pnpm test -- src\lib\appLogging.test.ts
```

Expected: tests pass.

- [ ] **Step 5: Connect frontend errors**

Add targeted calls in catch blocks:

In `useSettings.ts`, in each catch:

```ts
void logFrontendError("frontend.settings", "load_settings", caught);
```

Use action names:

- `load_settings`
- `save_raw_settings`
- `save_settings`

In `ConnectionList.tsx`, log test and save/delete failures with module `frontend.connections`.

In `SftpWorkspace.tsx`, log catch blocks for open session, list directory, create/delete/rename, upload/download/compress/extract/read/write with module `frontend.sftp`.

In `RedisWorkspace.tsx`, log catch blocks for list keys, get key value, save/delete/rename/create/ttl/bulk operations with module `frontend.redis`.

In database files, use module `frontend.database` and action names matching backend command names.

For each call, include target when cheap and non-sensitive:

```ts
void logFrontendError("frontend.redis", "list_redis_keys", caught, `${connection.id}:db${database}`, {
  command: "list_redis_keys",
});
```

Do not include password, private key passphrase, SQL content, Redis values, SFTP file content, or table cell values.

- [ ] **Step 6: Add one UI-level assertion**

In `src/features/connections/ConnectionList.test.tsx`, add or update a delete/test failure test to assert `write_app_log` is called through `callBackend`.

If the current test mock only handles known commands, extend it:

```ts
if (command === "write_app_log") return Promise.resolve();
```

Add assertion:

```ts
expect(callBackendMock).toHaveBeenCalledWith("write_app_log", {
  entry: expect.objectContaining({
    level: "error",
    module: "frontend.connections",
    action: expect.any(String),
    result: "failed",
  }),
});
```

- [ ] **Step 7: Run frontend tests**

Run:

```powershell
pnpm test -- src\lib\appLogging.test.ts src\features\connections\ConnectionList.test.tsx src\features\settings\SettingsPanel.test.tsx
```

Expected: tests pass.

- [ ] **Step 8: Commit**

```powershell
git add -- src\lib\appLogging.ts src\lib\appLogging.test.ts src\features\settings\useSettings.ts src\features\connections\ConnectionList.tsx src\features\sftp\SftpWorkspace.tsx src\features\redis\RedisWorkspace.tsx src\features\database\DatabaseObjectTree.tsx src\features\database\DatabaseWorkspace.tsx src\features\database\DatabaseTableBrowser.tsx src\features\connections\ConnectionList.test.tsx src\features\settings\SettingsPanel.test.tsx
git commit -m "feat(logging): 记录前端关键错误"
```

---

### Task 4: 文档和全量验证

**Files:**
- Modify: `README.md`
- Modify: `docs/当前状态与下一步.md`
- Modify: `docs/testing/manual-mvp-checklist.md`

- [ ] **Step 1: Update README**

In the `操作日志` section, update coverage from first version to completed coverage:

```md
日志覆盖 Redis key 查看、编辑、新增、删除、TTL 和批量操作，SFTP 目录、文件、压缩、解压和传输操作，数据库对象树、DDL、SQL 文件、SQL 执行和表数据增删改，以及前端关键错误。
```

Add:

```md
日志写入前会统一对密码、口令、token、authorization、URL 密码片段和超长字段做脱敏或截断。日志写入失败不会影响原业务操作。
```

- [ ] **Step 2: Update status doc**

In `docs/当前状态与下一步.md`, add completed items:

```md
- 操作日志已补齐 Redis、SFTP、数据库和前端关键错误覆盖。
- 操作日志写入前会统一脱敏和截断，日志失败不会影响业务操作。
```

- [ ] **Step 3: Update manual checklist**

In `docs/testing/manual-mvp-checklist.md`, add:

```md
- [x] Redis 查看、编辑、新增、删除、TTL 和批量操作会记录操作日志。
- [x] SFTP 文件操作、压缩解压和传输操作会记录操作日志。
- [x] 数据库对象树、DDL、SQL 文件、SQL 执行和表数据增删改会记录操作日志。
- [x] 前端关键错误会通过 `write_app_log` 写入日志。
- [x] 日志写入前会对密码、口令、token、authorization、URL 密码片段和超长字段脱敏或截断。
```

- [ ] **Step 4: Run full verification**

Run:

```powershell
pnpm test
pnpm build
pnpm test:rust
git diff --check
```

Expected:

- Frontend tests pass.
- Build passes. Existing Vite chunk warning is acceptable.
- Rust tests pass.
- `git diff --check` has no output.

- [ ] **Step 5: Commit**

```powershell
git add -- README.md docs\当前状态与下一步.md docs\testing\manual-mvp-checklist.md
git commit -m "docs(logging): 更新操作日志补全文档"
```

---

## Self-Review

- Spec coverage: 计划覆盖后端脱敏截断、metadata、Redis/SFTP/Database 主要 command、前端错误日志、文档和验证。
- Placeholder scan: 未使用 TBD/TODO/待定；所有步骤都给出目标文件、代码形状和验证命令。
- Type consistency: 后端 metadata 使用 `serde_json::Map<String, Value>`；前端 metadata 使用 `Record<string, string | number | boolean | null>`，由 Tauri 序列化为 JSON object；`log_operation` 最后新增 `metadata` 参数，所有现有调用点需要补 `None`。
