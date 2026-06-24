# 应用操作日志 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 DevHub 增加第一版本地应用操作日志，记录关键操作、结果、耗时和错误，并提供设置项与打开日志目录入口。

**Architecture:** 后端新增 `core::app_logger` 作为唯一日志写入边界，按天写入 app config 目录下的 JSON Lines 文件。`models::settings`、前端 settings schema 和设置页增加 `logging` 配置；Tauri command 暴露写前端日志、获取日志目录和打开日志目录。第一批命令只覆盖设置、终端、SFTP、Redis、数据库关键入口，不做完整日志查看器。

**Tech Stack:** Rust、Tauri command、serde/serde_json、chrono、React、TypeScript、Zod、Vitest、Cargo test。

---

## File Structure

- Create `src-tauri/src/core/app_logger.rs`
  - 日志级别、日志条目、日志写入器、日志目录、按天文件名、保留天数清理。
- Modify `src-tauri/src/core/mod.rs`
  - 导出 `app_logger`。
- Modify `src-tauri/src/models/settings.rs`
  - 增加 `LoggingSettings` 和 `DevHubSettings.logging` 默认值。
- Modify `src-tauri/src/core/settings_store.rs`
  - 确认旧 settings 自动补默认 `logging`。
- Create `src-tauri/src/commands/logging.rs`
  - `write_app_log`、`get_log_directory`、`open_log_directory`。
- Modify `src-tauri/src/commands/mod.rs`
  - 导出 logging commands。
- Modify `src-tauri/src/lib.rs`
  - `setup` 中管理 `AppLogger`，invoke handler 注册 logging commands。
- Modify selected command files:
  - `src-tauri/src/commands/settings.rs`
  - `src-tauri/src/commands/terminal.rs`
  - `src-tauri/src/commands/sftp.rs`
  - `src-tauri/src/commands/redis.rs`
  - `src-tauri/src/commands/database.rs`
  - 在关键入口增加日志记录。
- Modify frontend settings files:
  - `src/features/settings/settingsTypes.ts`
  - `src/features/settings/settingsSchema.ts`
  - `src/features/settings/settingsSchema.test.ts`
  - `src/features/settings/useSettings.ts`
  - `src/features/settings/SettingsPanel.tsx`
  - `src/features/settings/SettingsPanel.test.tsx`
- Modify i18n:
  - `src/i18n/locales/zh-CN.ts`
  - `src/i18n/locales/en-US.ts`
- Modify docs:
  - `README.md`
  - `docs/当前状态与下一步.md`
  - `docs/testing/manual-mvp-checklist.md`

---

### Task 1: Rust Logging Settings

**Files:**
- Modify: `src-tauri/src/models/settings.rs`
- Modify: `src-tauri/src/tests/settings_store_tests.rs`

- [ ] **Step 1: Write failing Rust tests for default logging settings**

Add to `src-tauri/src/tests/settings_store_tests.rs`:

```rust
#[test]
fn creates_default_logging_settings() {
    let settings = DevHubSettings::default();

    assert!(settings.logging.enabled);
    assert_eq!(settings.logging.level, "info");
    assert_eq!(settings.logging.retention_days, 14);
    assert!(!settings.logging.include_sql);
}

#[test]
fn saves_logging_settings() {
    let temp_dir = tempfile::tempdir().unwrap();
    let store = SettingsStore::new_for_dir(temp_dir.path().to_path_buf());
    let mut settings = DevHubSettings::default();
    settings.logging.enabled = false;
    settings.logging.level = "debug".to_string();
    settings.logging.retention_days = 3;
    settings.logging.include_sql = true;

    store.save(&settings).unwrap();
    let loaded = store.load().unwrap().unwrap();

    assert_eq!(loaded.logging.enabled, false);
    assert_eq!(loaded.logging.level, "debug");
    assert_eq!(loaded.logging.retention_days, 3);
    assert_eq!(loaded.logging.include_sql, true);
}
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```powershell
cargo test --manifest-path src-tauri\Cargo.toml settings_store_tests::creates_default_logging_settings settings_store_tests::saves_logging_settings
```

Expected: compile failure because `DevHubSettings` has no `logging` field.

- [ ] **Step 3: Implement Rust logging settings**

In `src-tauri/src/models/settings.rs`, add:

```rust
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct LoggingSettings {
    #[serde(default = "default_true")]
    pub enabled: bool,
    #[serde(default = "default_log_level")]
    pub level: String,
    #[serde(default = "default_log_retention_days")]
    pub retention_days: u16,
    #[serde(default)]
    pub include_sql: bool,
}

fn default_log_level() -> String {
    "info".to_string()
}

fn default_log_retention_days() -> u16 {
    14
}

impl Default for LoggingSettings {
    fn default() -> Self {
        Self {
            enabled: true,
            level: default_log_level(),
            retention_days: default_log_retention_days(),
            include_sql: false,
        }
    }
}
```

Add to `DevHubSettings`:

```rust
#[serde(default)]
pub logging: LoggingSettings,
```

Add to `DevHubSettings::default()`:

```rust
logging: LoggingSettings::default(),
```

- [ ] **Step 4: Run tests and verify pass**

Run:

```powershell
cargo test --manifest-path src-tauri\Cargo.toml settings_store_tests
```

Expected: all settings store tests pass.

---

### Task 2: Backend AppLogger

**Files:**
- Create: `src-tauri/src/core/app_logger.rs`
- Modify: `src-tauri/src/core/mod.rs`
- Add tests in: `src-tauri/src/core/app_logger.rs`

- [ ] **Step 1: Write failing tests for writing JSON Lines and retention cleanup**

Create `src-tauri/src/core/app_logger.rs` with tests first:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::settings::LoggingSettings;
    use serde_json::Value;
    use std::fs;

    fn settings() -> LoggingSettings {
        LoggingSettings {
            enabled: true,
            level: "info".to_string(),
            retention_days: 14,
            include_sql: false,
        }
    }

    #[test]
    fn writes_json_line_to_daily_log_file() {
        let temp_dir = tempfile::tempdir().unwrap();
        let logger = AppLogger::new_for_dir(temp_dir.path().to_path_buf());
        let entry = AppLogEntry::new("info", "sftp", "list_directory")
            .target("prod-web-01:/var/log")
            .result("success")
            .duration_ms(32);

        logger.write(&settings(), entry).unwrap();

        let log_dir = temp_dir.path().join("logs");
        let files: Vec<_> = fs::read_dir(&log_dir).unwrap().collect();
        assert_eq!(files.len(), 1);
        let content = fs::read_to_string(files[0].as_ref().unwrap().path()).unwrap();
        let value: Value = serde_json::from_str(content.trim()).unwrap();
        assert_eq!(value["level"], "info");
        assert_eq!(value["module"], "sftp");
        assert_eq!(value["action"], "list_directory");
        assert_eq!(value["target"], "prod-web-01:/var/log");
        assert_eq!(value["result"], "success");
        assert_eq!(value["duration_ms"], 32);
    }

    #[test]
    fn skips_entries_below_configured_level() {
        let temp_dir = tempfile::tempdir().unwrap();
        let logger = AppLogger::new_for_dir(temp_dir.path().to_path_buf());
        let mut config = settings();
        config.level = "warn".to_string();

        logger
            .write(&config, AppLogEntry::new("info", "redis", "list_keys").result("success"))
            .unwrap();

        assert!(!temp_dir.path().join("logs").exists());
    }

    #[test]
    fn removes_log_files_older_than_retention_days() {
        let temp_dir = tempfile::tempdir().unwrap();
        let logger = AppLogger::new_for_dir(temp_dir.path().to_path_buf());
        let log_dir = logger.log_dir();
        fs::create_dir_all(&log_dir).unwrap();
        fs::write(log_dir.join("devhub-2000-01-01.log"), "{}\n").unwrap();

        let mut config = settings();
        config.retention_days = 1;
        logger.cleanup_old_logs(&config).unwrap();

        assert!(!log_dir.join("devhub-2000-01-01.log").exists());
    }
}
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```powershell
cargo test --manifest-path src-tauri\Cargo.toml core::app_logger
```

Expected: compile failure because `AppLogger` and `AppLogEntry` are not implemented.

- [ ] **Step 3: Implement AppLogger**

In `src-tauri/src/core/app_logger.rs`, implement:

```rust
use crate::models::settings::LoggingSettings;
use chrono::{DateTime, Datelike, Duration, Local, NaiveDate};
use serde::Serialize;
use serde_json::{Map, Value};
use std::{
    fs::{self, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
    sync::Mutex,
};

pub struct AppLogger {
    app_dir: PathBuf,
    lock: Mutex<()>,
}

#[derive(Debug, Clone, Serialize)]
pub struct AppLogEntry {
    ts: DateTime<Local>,
    level: String,
    module: String,
    action: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    target: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    result: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    duration_ms: Option<u128>,
    #[serde(skip_serializing_if = "Option::is_none")]
    message: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    metadata: Option<Map<String, Value>>,
}

impl AppLogEntry {
    pub fn new(level: impl Into<String>, module: impl Into<String>, action: impl Into<String>) -> Self {
        Self {
            ts: Local::now(),
            level: level.into(),
            module: module.into(),
            action: action.into(),
            target: None,
            result: None,
            duration_ms: None,
            message: None,
            error: None,
            metadata: None,
        }
    }

    pub fn target(mut self, target: impl Into<String>) -> Self {
        self.target = Some(target.into());
        self
    }

    pub fn result(mut self, result: impl Into<String>) -> Self {
        self.result = Some(result.into());
        self
    }

    pub fn duration_ms(mut self, duration_ms: u128) -> Self {
        self.duration_ms = Some(duration_ms);
        self
    }

    pub fn message(mut self, message: impl Into<String>) -> Self {
        self.message = Some(message.into());
        self
    }

    pub fn error(mut self, error: impl Into<String>) -> Self {
        self.error = Some(error.into());
        self
    }
}

impl AppLogger {
    pub fn new_for_dir(app_dir: PathBuf) -> Self {
        Self {
            app_dir,
            lock: Mutex::new(()),
        }
    }

    pub fn log_dir(&self) -> PathBuf {
        self.app_dir.join("logs")
    }

    pub fn write(&self, settings: &LoggingSettings, entry: AppLogEntry) -> Result<(), String> {
        if !settings.enabled || !should_log(&settings.level, &entry.level) {
            return Ok(());
        }
        let _guard = self.lock.lock().map_err(|error| error.to_string())?;
        fs::create_dir_all(self.log_dir()).map_err(|error| error.to_string())?;
        self.cleanup_old_logs(settings)?;
        let path = self.log_file_path(Local::now());
        let mut file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(path)
            .map_err(|error| error.to_string())?;
        let line = serde_json::to_string(&entry).map_err(|error| error.to_string())?;
        writeln!(file, "{line}").map_err(|error| error.to_string())
    }

    fn log_file_path(&self, now: DateTime<Local>) -> PathBuf {
        self.log_dir().join(format!(
            "devhub-{:04}-{:02}-{:02}.log",
            now.year(),
            now.month(),
            now.day()
        ))
    }

    pub fn cleanup_old_logs(&self, settings: &LoggingSettings) -> Result<(), String> {
        let log_dir = self.log_dir();
        if !log_dir.exists() {
            return Ok(());
        }
        let cutoff = Local::now().date_naive() - Duration::days(i64::from(settings.retention_days));
        for entry in fs::read_dir(log_dir).map_err(|error| error.to_string())? {
            let entry = entry.map_err(|error| error.to_string())?;
            let path = entry.path();
            if should_remove_log_file(&path, cutoff) {
                let _ = fs::remove_file(path);
            }
        }
        Ok(())
    }
}

fn should_log(configured: &str, entry: &str) -> bool {
    level_rank(entry) >= level_rank(configured)
}

fn level_rank(level: &str) -> u8 {
    match level {
        "debug" => 10,
        "info" => 20,
        "warn" => 30,
        "error" => 40,
        _ => 20,
    }
}

fn should_remove_log_file(path: &Path, cutoff: NaiveDate) -> bool {
    let Some(file_name) = path.file_name().and_then(|name| name.to_str()) else {
        return false;
    };
    if !file_name.starts_with("devhub-") || !file_name.ends_with(".log") {
        return false;
    }
    let date_part = &file_name[7..17];
    NaiveDate::parse_from_str(date_part, "%Y-%m-%d")
        .map(|date| date < cutoff)
        .unwrap_or(false)
}
```

Add to `src-tauri/src/core/mod.rs`:

```rust
pub mod app_logger;
```

- [ ] **Step 4: Run tests**

Run:

```powershell
cargo test --manifest-path src-tauri\Cargo.toml core::app_logger
```

Expected: app_logger tests pass.

---

### Task 3: Logging Commands and App State

**Files:**
- Create: `src-tauri/src/commands/logging.rs`
- Modify: `src-tauri/src/commands/mod.rs`
- Modify: `src-tauri/src/lib.rs`
- Add tests in: `src-tauri/src/tests/settings_store_tests.rs` or command tests if needed

- [ ] **Step 1: Write command shape**

Create `src-tauri/src/commands/logging.rs`:

```rust
use crate::core::app_logger::{AppLogEntry, AppLogger};
use crate::core::settings_store::SettingsStore;
use serde::Deserialize;
use tauri::{AppHandle, Manager, State};
use tauri_plugin_opener::OpenerExt;

#[derive(Debug, Deserialize)]
pub struct FrontendLogEntry {
    level: String,
    module: String,
    action: String,
    target: Option<String>,
    result: Option<String>,
    message: Option<String>,
    error: Option<String>,
}

#[tauri::command]
pub fn get_log_directory(logger: State<'_, AppLogger>) -> Result<String, String> {
    Ok(logger.log_dir().to_string_lossy().to_string())
}

#[tauri::command]
pub fn open_log_directory(app: AppHandle, logger: State<'_, AppLogger>) -> Result<(), String> {
    let log_dir = logger.log_dir();
    std::fs::create_dir_all(&log_dir).map_err(|error| error.to_string())?;
    app.opener()
        .open_path(log_dir.to_string_lossy().to_string(), None::<&str>)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn write_app_log(
    settings_store: State<'_, SettingsStore>,
    logger: State<'_, AppLogger>,
    entry: FrontendLogEntry,
) -> Result<(), String> {
    let settings = settings_store.load_or_create().map_err(|error| error.to_string())?;
    let mut log_entry = AppLogEntry::new(entry.level, entry.module, entry.action);
    if let Some(target) = entry.target {
        log_entry = log_entry.target(target);
    }
    if let Some(result) = entry.result {
        log_entry = log_entry.result(result);
    }
    if let Some(message) = entry.message {
        log_entry = log_entry.message(message);
    }
    if let Some(error) = entry.error {
        log_entry = log_entry.error(error);
    }
    logger.write(&settings.logging, log_entry)
}
```

- [ ] **Step 2: Register module and state**

In `src-tauri/src/commands/mod.rs` add:

```rust
pub mod logging;
```

In `src-tauri/src/lib.rs`:

```rust
use crate::core::app_logger::AppLogger;
```

In setup:

```rust
app.manage(AppLogger::new_for_dir(app_dir.clone()));
```

In invoke handler:

```rust
commands::logging::get_log_directory,
commands::logging::open_log_directory,
commands::logging::write_app_log,
```

- [ ] **Step 3: Run cargo check/tests**

Run:

```powershell
cargo test --manifest-path src-tauri\Cargo.toml
```

Expected: Rust tests compile and pass.

---

### Task 4: Frontend Settings Schema and UI

**Files:**
- Modify: `src/features/settings/settingsTypes.ts`
- Modify: `src/features/settings/settingsSchema.ts`
- Modify: `src/features/settings/settingsSchema.test.ts`
- Modify: `src/features/settings/useSettings.ts`
- Modify: `src/features/settings/SettingsPanel.tsx`
- Modify: `src/features/settings/SettingsPanel.test.tsx`
- Modify: `src/i18n/locales/zh-CN.ts`
- Modify: `src/i18n/locales/en-US.ts`

- [ ] **Step 1: Write failing schema tests**

Add to `src/features/settings/settingsSchema.test.ts`:

```ts
it("fills default logging settings", () => {
  const settings = parseSettings({});

  expect(settings.logging).toEqual({
    enabled: true,
    level: "info",
    retention_days: 14,
    include_sql: false,
  });
});

it("accepts logging settings", () => {
  const settings = parseSettings({
    logging: {
      enabled: false,
      level: "debug",
      retention_days: 3,
      include_sql: true,
    },
  });

  expect(settings.logging).toEqual({
    enabled: false,
    level: "debug",
    retention_days: 3,
    include_sql: true,
  });
});
```

- [ ] **Step 2: Run schema test and verify failure**

Run:

```powershell
pnpm test -- src\features\settings\settingsSchema.test.ts -t "logging"
```

Expected: failure because logging schema does not exist.

- [ ] **Step 3: Implement frontend logging settings types and schema**

In `settingsTypes.ts` add:

```ts
export interface LoggingSettings {
  enabled: boolean;
  level: "debug" | "info" | "warn" | "error";
  retention_days: number;
  include_sql: boolean;
}
```

Add `logging: LoggingSettings;` to `DevHubSettings`.

In `settingsSchema.ts` add defaults and zod object:

```ts
const defaultLogging = {
  enabled: true,
  level: "info" as const,
  retention_days: 14,
  include_sql: false,
};
```

Add to schema:

```ts
logging: z.object({
  enabled: z.boolean().default(defaultLogging.enabled),
  level: z.enum(["debug", "info", "warn", "error"]).default(defaultLogging.level),
  retention_days: z.coerce.number().int().min(1).max(365).default(defaultLogging.retention_days),
  include_sql: z.boolean().default(defaultLogging.include_sql),
}).default(defaultLogging),
```

In `useSettings.ts` default settings add:

```ts
logging: {
  enabled: true,
  level: "info",
  retention_days: 14,
  include_sql: false,
},
```

- [ ] **Step 4: Add SettingsPanel controls**

In `SettingsPanel.tsx`, add `日志` nav item or place it under `通用`. For first version, add a dedicated `日志` section with:

- checkbox `启用日志`
- select `日志级别`
- number input `日志保留天数`
- checkbox `记录完整 SQL`
- button `打开日志目录`
- button `复制日志目录路径`

Use existing `callBackend` and clipboard helper patterns:

```ts
await callBackend<void>("open_log_directory");
const path = await callBackend<string>("get_log_directory");
await writeClipboardText(path);
```

- [ ] **Step 5: Add i18n keys**

Add Chinese and English keys for:

- `settings.logging`
- `settings.logging_enabled`
- `settings.logging_level`
- `settings.logging_retention_days`
- `settings.logging_include_sql`
- `settings.logging_include_sql_desc`
- `settings.open_log_directory`
- `settings.copy_log_directory`
- `settings.log_directory_copied`

- [ ] **Step 6: Add SettingsPanel tests**

Add to `SettingsPanel.test.tsx`:

```ts
it("edits logging settings and opens the log directory", async () => {
  callBackendMock.mockResolvedValueOnce(undefined);
  renderSettingsPanel();

  await userEvent.click(within(screen.getByLabelText("设置分类")).getByRole("button", { name: "日志" }));
  await userEvent.click(screen.getByLabelText("启用日志"));
  await userEvent.selectOptions(screen.getByLabelText("日志级别"), "debug");
  await userEvent.clear(screen.getByLabelText("日志保留天数"));
  await userEvent.type(screen.getByLabelText("日志保留天数"), "3");
  await userEvent.click(screen.getByLabelText("记录完整 SQL"));
  await userEvent.click(screen.getByRole("button", { name: "打开日志目录" }));

  expect(callBackendMock).toHaveBeenCalledWith("open_log_directory");
  expect(saveSettings).toHaveBeenCalledWith(expect.objectContaining({
    logging: {
      enabled: false,
      level: "debug",
      retention_days: 3,
      include_sql: true,
    },
  }));
});
```

Adjust helper names to existing test setup.

- [ ] **Step 7: Run frontend settings tests**

Run:

```powershell
pnpm test -- src\features\settings\settingsSchema.test.ts src\features\settings\SettingsPanel.test.tsx
```

Expected: tests pass.

---

### Task 5: Backend Command Logging

**Files:**
- Modify selected command modules:
  - `src-tauri/src/commands/settings.rs`
  - `src-tauri/src/commands/terminal.rs`
  - `src-tauri/src/commands/sftp.rs`
  - `src-tauri/src/commands/redis.rs`
  - `src-tauri/src/commands/database.rs`

- [ ] **Step 1: Add small helper**

In each command file, or a shared small helper module if duplication becomes obvious, use:

```rust
fn log_operation(
    settings_store: &SettingsStore,
    logger: &AppLogger,
    level: &str,
    module: &str,
    action: &str,
    target: Option<String>,
    result: &str,
    started_at: Option<std::time::Instant>,
    error: Option<String>,
) {
    let Ok(settings) = settings_store.load_or_create() else {
        return;
    };
    let mut entry = AppLogEntry::new(level, module, action).result(result);
    if let Some(target) = target {
        entry = entry.target(target);
    }
    if let Some(started_at) = started_at {
        entry = entry.duration_ms(started_at.elapsed().as_millis());
    }
    if let Some(error) = error {
        entry = entry.error(error);
    }
    let _ = logger.write(&settings.logging, entry);
}
```

If this helper is needed in multiple modules, put it in `src-tauri/src/commands/logging.rs` as `pub fn log_operation(...)`.

- [ ] **Step 2: Instrument key commands minimally**

For each command:

- Record `started_at = Instant::now()`.
- On success: write `level=info`, `result=success`.
- On failure: write `level=error`, `result=failed`, `error=error.to_string()`.

Start with these commands:

- `save_settings`
- `open_terminal`
- `close_terminal`
- `open_sftp_session`
- `list_sftp_directory`
- `upload_sftp_file`
- `download_sftp_file`
- `cancel_sftp_transfer`
- `test_redis_connection`
- `list_redis_keys`
- `test_database_connection`
- `execute_database_query`
- `load_database_table_page`

Do not record full SQL unless `settings.logging.include_sql` is true.

- [ ] **Step 3: Run Rust tests**

Run:

```powershell
cargo test --manifest-path src-tauri\Cargo.toml
```

Expected: all Rust tests pass.

---

### Task 6: Docs and Final Verification

**Files:**
- Modify: `README.md`
- Modify: `docs/当前状态与下一步.md`
- Modify: `docs/testing/manual-mvp-checklist.md`

- [ ] **Step 1: Update README**

Add a section under settings or security:

```md
### 操作日志

DevHub 会把关键操作写入本地日志目录，便于排查连接、SFTP、Redis 和数据库问题。日志默认开启，按天写入 `<app_config_dir>/logs/devhub-YYYY-MM-DD.log`。默认不记录完整 SQL、不记录密码和私钥口令。
```

- [ ] **Step 2: Update status doc and manual checklist**

Add completed items for:

- 日志设置项。
- 打开日志目录。
- 关键操作日志。
- 敏感信息不写入日志。

- [ ] **Step 3: Run full verification**

Run:

```powershell
pnpm test
pnpm build
pnpm test:rust
git diff --check
```

Expected:

- Frontend tests pass.
- Build passes. Vite chunk warning is acceptable if unchanged.
- Rust tests pass.
- `git diff --check` has no errors.

- [ ] **Step 4: Commit**

```powershell
git add -- src-tauri\src\core\app_logger.rs src-tauri\src\core\mod.rs src-tauri\src\models\settings.rs src-tauri\src\commands\logging.rs src-tauri\src\commands\mod.rs src-tauri\src\lib.rs src-tauri\src\commands\settings.rs src-tauri\src\commands\terminal.rs src-tauri\src\commands\sftp.rs src-tauri\src\commands\redis.rs src-tauri\src\commands\database.rs src-tauri\src\tests\settings_store_tests.rs src\features\settings\settingsTypes.ts src\features\settings\settingsSchema.ts src\features\settings\settingsSchema.test.ts src\features\settings\useSettings.ts src\features\settings\SettingsPanel.tsx src\features\settings\SettingsPanel.test.tsx src\i18n\locales\zh-CN.ts src\i18n\locales\en-US.ts README.md docs\当前状态与下一步.md docs\testing\manual-mvp-checklist.md
git commit -m "feat(logging): 添加应用操作日志"
```

---

## Self-Review

- Spec coverage: 覆盖日志位置、格式、设置项、脱敏、后端 command、前端设置入口、文档和验证。
- Placeholder scan: 没有 TBD/TODO/fill in later。
- Type consistency: Rust `LoggingSettings`、frontend `LoggingSettings`、JSON 字段名保持 `enabled/level/retention_days/include_sql` 一致。
