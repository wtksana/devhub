# DevHub MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first DevHub desktop MVP: Tauri 2 + Rust + React app with Settings, SSH terminal, SFTP file management, BYOK AI panel, and safe local configuration.

**Architecture:** The frontend is a React/TypeScript UI that renders workspaces and sends commands to the Rust core through Tauri commands and events. The Rust core owns settings files, credential storage, SSH/SFTP sessions, stream backpressure, AI provider calls, and runtime state. User-copyable configuration lives in `settings.json` and `keymap.json`; sensitive values live in the OS credential store and are referenced by ID.

**Tech Stack:** Tauri 2, Rust, Tokio, React, TypeScript, Vite, xterm.js, Monaco Editor, Zod, SQLite, `ssh2`/libssh2 for MVP SSH+SFTP, OS credential storage, OpenAI-compatible BYOK HTTP API.

---

## References

- Spec: `docs/superpowers/specs/2026-06-16-devhub-mvp-design.md`
- Tauri create app: `pnpm create tauri-app . --template react-ts`
- Tauri dev: `pnpm tauri dev`
- Tauri build: `pnpm tauri build`
- Tauri command pattern: Rust `#[tauri::command]` plus frontend `invoke(...)`

## File Structure

After scaffolding, the project should use this structure:

```text
C:\Dev\devhub
  .editorconfig
  .gitattributes
  package.json
  pnpm-lock.yaml
  index.html
  vite.config.ts
  tsconfig.json
  src\
    main.tsx
    App.tsx
    app\
      AppShell.tsx
      CommandPalette.tsx
      DockPanel.tsx
      StatusBar.tsx
      WorkspaceTabs.tsx
      routes.ts
    components\
      ToolbarButton.tsx
      Modal.tsx
      SplitPane.tsx
    features\
      ai\
        AiPanel.tsx
        aiTypes.ts
        useAiChat.ts
      connections\
        ConnectionList.tsx
        ConnectionEditor.tsx
        connectionTypes.ts
      settings\
        SettingsPanel.tsx
        SettingsJsonEditor.tsx
        KeymapEditor.tsx
        settingsSchema.ts
        settingsTypes.ts
        useSettings.ts
      sftp\
        SftpWorkspace.tsx
        TransferQueue.tsx
        sftpTypes.ts
      terminal\
        TerminalWorkspace.tsx
        TerminalTab.tsx
        terminalTypes.ts
    lib\
      tauri.ts
      ids.ts
      result.ts
    styles\
      globals.css
      theme.css
  src-tauri\
    Cargo.toml
    tauri.conf.json
    src\
      lib.rs
      main.rs
      app_state.rs
      commands\
        mod.rs
        ai.rs
        credentials.rs
        settings.rs
        sftp.rs
        terminal.rs
      core\
        mod.rs
        ai_client.rs
        app_paths.rs
        credential_store.rs
        event_bus.rs
        settings_store.rs
      ssh\
        mod.rs
        session_manager.rs
        sftp_manager.rs
        terminal_manager.rs
      models\
        mod.rs
        ai.rs
        connection.rs
        settings.rs
        sftp.rs
        terminal.rs
      tests\
        settings_store_tests.rs
        sensitive_config_tests.rs
```

Boundaries:

- `src/features/*` owns UI and frontend state only.
- `src/lib/tauri.ts` is the only frontend file that imports Tauri invoke/listen APIs.
- `src-tauri/src/commands/*` is the Tauri API surface.
- `src-tauri/src/core/*` is reusable non-SSH backend logic.
- `src-tauri/src/ssh/*` owns SSH/SFTP lifecycle and never leaks credentials to the frontend.
- `src-tauri/src/models/*` defines serializable request/response models shared by command handlers.

---

## Task 1: Scaffold Tauri React App

**Files:**
- Create via scaffold: `package.json`, `src/`, `src-tauri/`, `vite.config.ts`, `tsconfig.json`
- Modify: `.gitignore`

- [ ] **Step 1: Scaffold the app in the current directory**

Run from `C:\Dev\devhub`:

```powershell
pnpm create tauri-app . --template react-ts
```

Expected:

- Tauri creates a React TypeScript app in the current repo.
- It may ask for confirmation because the directory is not empty; keep existing `docs/` and `.gitattributes`.

- [ ] **Step 2: Install dependencies**

```powershell
pnpm install
```

Expected: dependencies install and `pnpm-lock.yaml` is created.

- [ ] **Step 3: Add development dependencies**

```powershell
pnpm add zod @xterm/xterm @xterm/addon-fit @monaco-editor/react lucide-react clsx
pnpm add -D vitest @testing-library/react @testing-library/jest-dom @testing-library/user-event jsdom
```

Expected: frontend dependencies are added to `package.json`.

- [ ] **Step 4: Add Rust dependencies**

Edit `src-tauri/Cargo.toml` dependencies so the relevant section includes:

```toml
[dependencies]
tauri = { version = "2", features = [] }
tauri-plugin-opener = "2"
serde = { version = "1", features = ["derive"] }
serde_json = "1"
tokio = { version = "1", features = ["macros", "rt-multi-thread", "sync", "time", "io-util"] }
thiserror = "2"
uuid = { version = "1", features = ["v4", "serde"] }
directories = "6"
keyring = "3"
ssh2 = "0.9"
rusqlite = { version = "0.32", features = ["bundled"] }
reqwest = { version = "0.12", features = ["json", "stream", "rustls-tls"], default-features = false }

[dev-dependencies]
tempfile = "3"
```

If the scaffold created newer compatible versions, keep the newer scaffolded Tauri entries and add only missing dependencies.

- [ ] **Step 5: Add base test scripts**

Modify `package.json` scripts:

```json
{
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "preview": "vite preview",
    "tauri": "tauri",
    "test": "vitest run",
    "test:watch": "vitest",
    "lint:rust": "cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings",
    "test:rust": "cargo test --manifest-path src-tauri/Cargo.toml"
  }
}
```

- [ ] **Step 6: Run scaffold verification**

```powershell
pnpm test
pnpm build
pnpm run test:rust
cargo fmt --manifest-path src-tauri/Cargo.toml --check
```

Expected:

- `pnpm test` may report no tests only if no test file exists yet.
- `pnpm build` succeeds.
- Rust tests compile.
- Rust formatting check succeeds.

- [ ] **Step 7: Commit scaffold**

```powershell
git add -- package.json pnpm-lock.yaml index.html vite.config.ts tsconfig.json src src-tauri .gitignore
git commit -m "chore: 初始化 Tauri React 应用"
```

---

## Task 2: Add Editor and Formatting Baseline

**Files:**
- Create: `.editorconfig`
- Modify: `.gitignore`
- Modify: `src/styles/globals.css`

- [ ] **Step 1: Create `.editorconfig`**

```ini
root = true

[*]
charset = utf-8
end_of_line = lf
insert_final_newline = true
indent_style = space
indent_size = 2

[*.rs]
indent_size = 4

[*.{bat,cmd,ps1}]
end_of_line = crlf
```

- [ ] **Step 2: Ensure generated local files are ignored**

Add to `.gitignore`:

```gitignore
node_modules/
dist/
target/
.env
.env.*
!.env.example
```

- [ ] **Step 3: Create base global CSS**

Replace the scaffolded global CSS with:

```css
:root {
  font-family: Inter, "Segoe UI", sans-serif;
  color: #e6e8eb;
  background: #101214;
  font-synthesis: none;
  text-rendering: optimizeLegibility;
}

* {
  box-sizing: border-box;
}

body {
  margin: 0;
  min-width: 960px;
  min-height: 100vh;
  background: #101214;
}

button,
input,
textarea,
select {
  font: inherit;
}
```

- [ ] **Step 4: Verify**

```powershell
pnpm build
cargo fmt --manifest-path src-tauri/Cargo.toml --check
```

Expected: both commands pass.

- [ ] **Step 5: Commit**

```powershell
git add -- .editorconfig .gitignore src/styles src
git commit -m "chore: 添加编辑器和格式化基线"
```

---

## Task 3: Define Shared Settings Schema

**Files:**
- Create: `src/features/settings/settingsTypes.ts`
- Create: `src/features/settings/settingsSchema.ts`
- Create: `src/features/settings/settingsSchema.test.ts`
- Create: `src/features/connections/connectionTypes.ts`
- Create: `src/features/ai/aiTypes.ts`
- Create: `src/features/terminal/terminalTypes.ts`
- Create: `src/features/sftp/sftpTypes.ts`

- [ ] **Step 1: Write failing frontend schema tests**

Create `src/features/settings/settingsSchema.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { parseSettings } from "./settingsSchema";

describe("settings schema", () => {
  it("accepts a valid portable settings file", () => {
    const settings = parseSettings({
      appearance: {
        theme: "dark",
        ui_font_family: "Inter",
        terminal_font_family: "JetBrains Mono",
        terminal_font_size: 14,
      },
      layout: {
        ai_panel: "right",
        connection_sidebar_width: 280,
        open_ai_panel_by_default: true,
      },
      connections: [
        {
          id: "prod-web-01",
          name: "prod-web-01",
          group: "production",
          host: "10.0.0.10",
          port: 22,
          username: "deploy",
          auth: {
            type: "private_key",
            private_key_path: "C:\\Users\\user\\.ssh\\id_ed25519",
            passphrase_ref: "ssh:prod-web-01:passphrase",
          },
        },
      ],
      ai: {
        provider: "openai_compatible",
        base_url: "https://api.example.com/v1",
        model: "gpt-4.1",
        api_key_ref: "ai:default",
      },
    });

    expect(settings.connections[0].auth.type).toBe("private_key");
  });

  it("rejects sensitive values inside settings json", () => {
    expect(() =>
      parseSettings({
        connections: [
          {
            id: "bad",
            name: "bad",
            host: "127.0.0.1",
            port: 22,
            username: "root",
            password: "plain-text-password",
          },
        ],
      }),
    ).toThrow(/sensitive/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```powershell
pnpm test -- src/features/settings/settingsSchema.test.ts
```

Expected: FAIL because `settingsSchema.ts` does not exist.

- [ ] **Step 3: Add types**

Create `src/features/settings/settingsTypes.ts`:

```ts
export type ThemeName = "dark" | "light" | "system";
export type AiPanelPosition = "left" | "right" | "hidden";

export interface AppearanceSettings {
  theme: ThemeName;
  ui_font_family: string;
  terminal_font_family: string;
  terminal_font_size: number;
}

export interface LayoutSettings {
  ai_panel: AiPanelPosition;
  connection_sidebar_width: number;
  open_ai_panel_by_default: boolean;
}

export interface PasswordAuthSettings {
  type: "password";
  password_ref: string;
}

export interface PrivateKeyAuthSettings {
  type: "private_key";
  private_key_path: string;
  passphrase_ref?: string;
}

export type ConnectionAuthSettings = PasswordAuthSettings | PrivateKeyAuthSettings;

export interface ConnectionSettings {
  id: string;
  name: string;
  group?: string;
  host: string;
  port: number;
  username: string;
  auth: ConnectionAuthSettings;
}

export interface AiSettings {
  provider: "openai_compatible";
  base_url: string;
  model: string;
  api_key_ref: string;
}

export interface DevHubSettings {
  appearance: AppearanceSettings;
  layout: LayoutSettings;
  connections: ConnectionSettings[];
  ai: AiSettings;
}
```

Create simple re-export files:

```ts
// src/features/connections/connectionTypes.ts
export type { ConnectionSettings, ConnectionAuthSettings } from "../settings/settingsTypes";
```

```ts
// src/features/ai/aiTypes.ts
export type { AiSettings } from "../settings/settingsTypes";
```

```ts
// src/features/terminal/terminalTypes.ts
export interface TerminalTab {
  id: string;
  connectionId: string;
  title: string;
  status: "connecting" | "connected" | "disconnected" | "failed";
}
```

```ts
// src/features/sftp/sftpTypes.ts
export interface SftpEntry {
  name: string;
  path: string;
  kind: "file" | "directory" | "symlink" | "unknown";
  size: number;
  modified_at?: string;
  permissions?: string;
}
```

- [ ] **Step 4: Add Zod schema**

Create `src/features/settings/settingsSchema.ts`:

```ts
import { z } from "zod";
import type { DevHubSettings } from "./settingsTypes";

const forbiddenSensitiveKeys = [
  "password",
  "passphrase",
  "api_key",
  "apiKey",
  "private_key",
  "privateKey",
];

function assertNoSensitiveKeys(value: unknown, path: string[] = []): void {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoSensitiveKeys(item, [...path, String(index)]));
    return;
  }

  for (const [key, child] of Object.entries(value)) {
    if (forbiddenSensitiveKeys.includes(key)) {
      throw new Error(`sensitive field is not allowed in settings.json: ${[...path, key].join(".")}`);
    }
    assertNoSensitiveKeys(child, [...path, key]);
  }
}

const authSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("password"),
    password_ref: z.string().min(1),
  }),
  z.object({
    type: z.literal("private_key"),
    private_key_path: z.string().min(1),
    passphrase_ref: z.string().min(1).optional(),
  }),
]);

const connectionSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  group: z.string().optional(),
  host: z.string().min(1),
  port: z.number().int().min(1).max(65535),
  username: z.string().min(1),
  auth: authSchema,
});

export const devHubSettingsSchema = z.object({
  appearance: z.object({
    theme: z.enum(["dark", "light", "system"]),
    ui_font_family: z.string().min(1),
    terminal_font_family: z.string().min(1),
    terminal_font_size: z.number().min(8).max(40),
  }),
  layout: z.object({
    ai_panel: z.enum(["left", "right", "hidden"]),
    connection_sidebar_width: z.number().min(220).max(520),
    open_ai_panel_by_default: z.boolean(),
  }),
  connections: z.array(connectionSchema),
  ai: z.object({
    provider: z.literal("openai_compatible"),
    base_url: z.string().url(),
    model: z.string().min(1),
    api_key_ref: z.string().min(1),
  }),
});

export function parseSettings(value: unknown): DevHubSettings {
  assertNoSensitiveKeys(value);
  return devHubSettingsSchema.parse(value);
}
```

- [ ] **Step 5: Run tests**

```powershell
pnpm test -- src/features/settings/settingsSchema.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add -- src/features
git commit -m "feat: 定义可迁移设置 schema"
```

---

## Task 4: Implement Rust Settings Store

**Files:**
- Create: `src-tauri/src/core/app_paths.rs`
- Create: `src-tauri/src/core/settings_store.rs`
- Create: `src-tauri/src/models/settings.rs`
- Create: `src-tauri/src/commands/settings.rs`
- Modify: `src-tauri/src/core/mod.rs`
- Modify: `src-tauri/src/models/mod.rs`
- Modify: `src-tauri/src/commands/mod.rs`
- Modify: `src-tauri/src/lib.rs`
- Test: `src-tauri/src/tests/settings_store_tests.rs`

- [ ] **Step 1: Write Rust settings store tests**

Create `src-tauri/src/tests/settings_store_tests.rs`:

```rust
use tempfile::tempdir;

use crate::core::settings_store::SettingsStore;

#[test]
fn creates_default_settings_when_missing() {
    let dir = tempdir().unwrap();
    let store = SettingsStore::new_for_dir(dir.path().to_path_buf());

    let settings = store.load_or_create().unwrap();

    assert_eq!(settings.appearance.theme, "dark");
    assert!(store.settings_path().exists());
}

#[test]
fn rejects_sensitive_fields() {
    let dir = tempdir().unwrap();
    let store = SettingsStore::new_for_dir(dir.path().to_path_buf());
    std::fs::write(
        store.settings_path(),
        r#"{"connections":[{"id":"bad","password":"plain"}]}"#,
    )
    .unwrap();

    let error = store.load_or_create().unwrap_err().to_string();

    assert!(error.contains("sensitive"));
}
```

- [ ] **Step 2: Run test to verify it fails**

```powershell
pnpm run test:rust -- settings_store
```

Expected: FAIL because modules do not exist.

- [ ] **Step 3: Add Rust settings models**

Create `src-tauri/src/models/settings.rs`:

```rust
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct AppearanceSettings {
    pub theme: String,
    pub ui_font_family: String,
    pub terminal_font_family: String,
    pub terminal_font_size: u16,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct LayoutSettings {
    pub ai_panel: String,
    pub connection_sidebar_width: u16,
    pub open_ai_panel_by_default: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "type")]
pub enum ConnectionAuthSettings {
    #[serde(rename = "password")]
    Password { password_ref: String },
    #[serde(rename = "private_key")]
    PrivateKey {
        private_key_path: String,
        passphrase_ref: Option<String>,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ConnectionSettings {
    pub id: String,
    pub name: String,
    pub group: Option<String>,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub auth: ConnectionAuthSettings,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct AiSettings {
    pub provider: String,
    pub base_url: String,
    pub model: String,
    pub api_key_ref: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct DevHubSettings {
    pub appearance: AppearanceSettings,
    pub layout: LayoutSettings,
    pub connections: Vec<ConnectionSettings>,
    pub ai: AiSettings,
}

impl Default for DevHubSettings {
    fn default() -> Self {
        Self {
            appearance: AppearanceSettings {
                theme: "dark".to_string(),
                ui_font_family: "Inter".to_string(),
                terminal_font_family: "JetBrains Mono".to_string(),
                terminal_font_size: 14,
            },
            layout: LayoutSettings {
                ai_panel: "right".to_string(),
                connection_sidebar_width: 280,
                open_ai_panel_by_default: true,
            },
            connections: Vec::new(),
            ai: AiSettings {
                provider: "openai_compatible".to_string(),
                base_url: "https://api.openai.com/v1".to_string(),
                model: "gpt-4.1".to_string(),
                api_key_ref: "ai:default".to_string(),
            },
        }
    }
}
```

- [ ] **Step 4: Add settings store implementation**

Create `src-tauri/src/core/settings_store.rs`:

```rust
use std::path::PathBuf;

use thiserror::Error;

use crate::models::settings::DevHubSettings;

#[derive(Debug, Error)]
pub enum SettingsStoreError {
    #[error("settings contains sensitive field: {0}")]
    SensitiveField(String),
    #[error("settings json error: {0}")]
    Json(#[from] serde_json::Error),
    #[error("settings io error: {0}")]
    Io(#[from] std::io::Error),
}

pub type Result<T> = std::result::Result<T, SettingsStoreError>;

#[derive(Debug, Clone)]
pub struct SettingsStore {
    base_dir: PathBuf,
}

impl SettingsStore {
    pub fn new_for_dir(base_dir: PathBuf) -> Self {
        Self { base_dir }
    }

    pub fn settings_path(&self) -> PathBuf {
        self.base_dir.join("settings.json")
    }

    pub fn keymap_path(&self) -> PathBuf {
        self.base_dir.join("keymap.json")
    }

    pub fn load_or_create(&self) -> Result<DevHubSettings> {
        std::fs::create_dir_all(&self.base_dir)?;
        if !self.settings_path().exists() {
            let default_settings = DevHubSettings::default();
            self.save(&default_settings)?;
            return Ok(default_settings);
        }

        let raw = std::fs::read_to_string(self.settings_path())?;
        let value: serde_json::Value = serde_json::from_str(&raw)?;
        reject_sensitive_fields(&value, "")?;
        Ok(serde_json::from_value(value)?)
    }

    pub fn save(&self, settings: &DevHubSettings) -> Result<()> {
        std::fs::create_dir_all(&self.base_dir)?;
        let value = serde_json::to_value(settings)?;
        reject_sensitive_fields(&value, "")?;
        let raw = serde_json::to_string_pretty(settings)?;
        std::fs::write(self.settings_path(), format!("{raw}\n"))?;
        if !self.keymap_path().exists() {
            std::fs::write(self.keymap_path(), "{\n  \"bindings\": []\n}\n")?;
        }
        Ok(())
    }
}

fn reject_sensitive_fields(value: &serde_json::Value, path: &str) -> Result<()> {
    let forbidden = ["password", "passphrase", "api_key", "apiKey", "private_key", "privateKey"];
    match value {
        serde_json::Value::Object(map) => {
            for (key, child) in map {
                let next_path = if path.is_empty() {
                    key.to_string()
                } else {
                    format!("{path}.{key}")
                };
                if forbidden.contains(&key.as_str()) {
                    return Err(SettingsStoreError::SensitiveField(next_path));
                }
                reject_sensitive_fields(child, &next_path)?;
            }
        }
        serde_json::Value::Array(items) => {
            for (index, child) in items.iter().enumerate() {
                reject_sensitive_fields(child, &format!("{path}[{index}]"))?;
            }
        }
        _ => {}
    }
    Ok(())
}
```

- [ ] **Step 5: Wire modules**

Create or update module files:

```rust
// src-tauri/src/core/mod.rs
pub mod app_paths;
pub mod settings_store;
```

```rust
// src-tauri/src/models/mod.rs
pub mod settings;
```

```rust
// src-tauri/src/tests/mod.rs
mod settings_store_tests;
```

Ensure `src-tauri/src/lib.rs` contains:

```rust
pub mod core;
pub mod models;

#[cfg(test)]
mod tests;
```

- [ ] **Step 6: Add settings commands**

Create `src-tauri/src/commands/settings.rs`:

```rust
use tauri::{AppHandle, Manager};

use crate::core::settings_store::SettingsStore;
use crate::models::settings::DevHubSettings;

#[tauri::command]
pub async fn load_settings(app: AppHandle) -> Result<DevHubSettings, String> {
    let store = app.state::<SettingsStore>();
    store.load_or_create().map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn save_settings(app: AppHandle, settings: DevHubSettings) -> Result<(), String> {
    let store = app.state::<SettingsStore>();
    store.save(&settings).map_err(|error| error.to_string())
}
```

Wire command module:

```rust
// src-tauri/src/commands/mod.rs
pub mod settings;
```

In `src-tauri/src/lib.rs`, manage the store and register commands:

```rust
use crate::core::settings_store::SettingsStore;

pub mod commands;
pub mod core;
pub mod models;

#[cfg(test)]
mod tests;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let app_dir = app
                .path()
                .app_config_dir()
                .map_err(|error| Box::<dyn std::error::Error>::from(error))?;
            app.manage(SettingsStore::new_for_dir(app_dir));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::settings::load_settings,
            commands::settings::save_settings
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

- [ ] **Step 7: Verify**

```powershell
cargo fmt --manifest-path src-tauri/Cargo.toml
pnpm run test:rust -- settings_store
pnpm build
```

Expected: tests and frontend build pass.

- [ ] **Step 8: Commit**

```powershell
git add -- src-tauri
git commit -m "feat: 添加 settings.json 存储"
```

---

## Task 5: Build Settings UI and JSON Editor

**Files:**
- Create: `src/lib/tauri.ts`
- Create: `src/features/settings/useSettings.ts`
- Create: `src/features/settings/SettingsPanel.tsx`
- Create: `src/features/settings/SettingsJsonEditor.tsx`
- Create: `src/features/settings/KeymapEditor.tsx`
- Test: `src/features/settings/SettingsPanel.test.tsx`
- Modify: `src/App.tsx`

- [ ] **Step 1: Write UI test**

Create `src/features/settings/SettingsPanel.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SettingsPanel } from "./SettingsPanel";

vi.mock("./useSettings", () => ({
  useSettings: () => ({
    settings: {
      appearance: {
        theme: "dark",
        ui_font_family: "Inter",
        terminal_font_family: "JetBrains Mono",
        terminal_font_size: 14,
      },
      layout: {
        ai_panel: "right",
        connection_sidebar_width: 280,
        open_ai_panel_by_default: true,
      },
      connections: [],
      ai: {
        provider: "openai_compatible",
        base_url: "https://api.openai.com/v1",
        model: "gpt-4.1",
        api_key_ref: "ai:default",
      },
    },
    rawJson: "{}",
    error: null,
    saveRawJson: vi.fn(),
    reload: vi.fn(),
  }),
}));

describe("SettingsPanel", () => {
  it("shows appearance, layout, connections, and AI sections", () => {
    render(<SettingsPanel />);

    expect(screen.getByText("外观")).toBeInTheDocument();
    expect(screen.getByText("布局")).toBeInTheDocument();
    expect(screen.getByText("连接")).toBeInTheDocument();
    expect(screen.getByText("AI")).toBeInTheDocument();
    expect(screen.getByText("settings.json")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```powershell
pnpm test -- src/features/settings/SettingsPanel.test.tsx
```

Expected: FAIL because components do not exist.

- [ ] **Step 3: Add Tauri wrapper**

Create `src/lib/tauri.ts`:

```ts
import { invoke } from "@tauri-apps/api/core";

export function callBackend<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  return invoke<T>(command, args);
}
```

- [ ] **Step 4: Add settings hook**

Create `src/features/settings/useSettings.ts`:

```ts
import { useCallback, useEffect, useMemo, useState } from "react";
import { callBackend } from "../../lib/tauri";
import { parseSettings } from "./settingsSchema";
import type { DevHubSettings } from "./settingsTypes";

const defaultSettings: DevHubSettings = {
  appearance: {
    theme: "dark",
    ui_font_family: "Inter",
    terminal_font_family: "JetBrains Mono",
    terminal_font_size: 14,
  },
  layout: {
    ai_panel: "right",
    connection_sidebar_width: 280,
    open_ai_panel_by_default: true,
  },
  connections: [],
  ai: {
    provider: "openai_compatible",
    base_url: "https://api.openai.com/v1",
    model: "gpt-4.1",
    api_key_ref: "ai:default",
  },
};

export function useSettings() {
  const [settings, setSettings] = useState<DevHubSettings>(defaultSettings);
  const [rawJson, setRawJson] = useState(() => JSON.stringify(defaultSettings, null, 2));
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const nextSettings = await callBackend<DevHubSettings>("load_settings");
      setSettings(nextSettings);
      setRawJson(JSON.stringify(nextSettings, null, 2));
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const saveRawJson = useCallback(async (value: string) => {
    try {
      const parsed = parseSettings(JSON.parse(value));
      await callBackend<void>("save_settings", { settings: parsed });
      setSettings(parsed);
      setRawJson(JSON.stringify(parsed, null, 2));
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }, []);

  return useMemo(
    () => ({ settings, rawJson, error, saveRawJson, reload }),
    [settings, rawJson, error, saveRawJson, reload],
  );
}
```

- [ ] **Step 5: Add settings components**

Create `src/features/settings/SettingsPanel.tsx`:

```tsx
import { SettingsJsonEditor } from "./SettingsJsonEditor";
import { KeymapEditor } from "./KeymapEditor";
import { useSettings } from "./useSettings";

export function SettingsPanel() {
  const settingsState = useSettings();
  const { settings, error } = settingsState;

  return (
    <section className="settings-panel" aria-label="Settings">
      <header className="settings-panel__header">
        <h1>设置</h1>
        {error ? <p className="settings-panel__error">{error}</p> : null}
      </header>

      <div className="settings-panel__grid">
        <section>
          <h2>外观</h2>
          <p>主题：{settings.appearance.theme}</p>
          <p>界面字体：{settings.appearance.ui_font_family}</p>
          <p>终端字体：{settings.appearance.terminal_font_family}</p>
        </section>
        <section>
          <h2>布局</h2>
          <p>AI 面板：{settings.layout.ai_panel}</p>
          <p>连接栏宽度：{settings.layout.connection_sidebar_width}px</p>
        </section>
        <section>
          <h2>连接</h2>
          <p>{settings.connections.length} 个连接</p>
        </section>
        <section>
          <h2>AI</h2>
          <p>{settings.ai.provider}</p>
          <p>{settings.ai.model}</p>
        </section>
      </div>

      <SettingsJsonEditor {...settingsState} />
      <KeymapEditor />
    </section>
  );
}
```

Create `src/features/settings/SettingsJsonEditor.tsx`:

```tsx
import { useState } from "react";
import Editor from "@monaco-editor/react";
import type { DevHubSettings } from "./settingsTypes";

interface SettingsJsonEditorProps {
  settings: DevHubSettings;
  rawJson: string;
  saveRawJson: (value: string) => Promise<void>;
}

export function SettingsJsonEditor({ rawJson, saveRawJson }: SettingsJsonEditorProps) {
  const [draft, setDraft] = useState(rawJson);

  return (
    <section className="settings-json">
      <h2>settings.json</h2>
      <Editor
        height="360px"
        defaultLanguage="json"
        value={draft}
        theme="vs-dark"
        onChange={(value) => setDraft(value ?? "")}
        options={{ minimap: { enabled: false }, fontSize: 13 }}
      />
      <button type="button" onClick={() => void saveRawJson(draft)}>
        保存 settings.json
      </button>
    </section>
  );
}
```

Create `src/features/settings/KeymapEditor.tsx`:

```tsx
export function KeymapEditor() {
  return (
    <section className="keymap-editor">
      <h2>快捷键</h2>
      <p>第一版使用 keymap.json 管理快捷键，后续提供冲突检测和图形化编辑。</p>
    </section>
  );
}
```

- [ ] **Step 6: Wire App**

Modify `src/App.tsx`:

```tsx
import { SettingsPanel } from "./features/settings/SettingsPanel";
import "./styles/globals.css";

export default function App() {
  return <SettingsPanel />;
}
```

- [ ] **Step 7: Verify**

```powershell
pnpm test -- src/features/settings
pnpm build
```

Expected: tests and build pass.

- [ ] **Step 8: Commit**

```powershell
git add -- src
git commit -m "feat: 添加 Settings 面板"
```

---

## Task 6: Implement Credential Store Commands

**Files:**
- Create: `src-tauri/src/core/credential_store.rs`
- Create: `src-tauri/src/commands/credentials.rs`
- Create: `src-tauri/src/models/connection.rs`
- Test: `src-tauri/src/tests/sensitive_config_tests.rs`
- Modify: `src-tauri/src/core/mod.rs`
- Modify: `src-tauri/src/commands/mod.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Write sensitive config test**

Create `src-tauri/src/tests/sensitive_config_tests.rs`:

```rust
use crate::core::credential_store::CredentialStore;

#[test]
fn credential_ids_are_namespaced() {
    let id = CredentialStore::credential_id("ssh", "prod-web-01", "password");
    assert_eq!(id, "ssh:prod-web-01:password");
}
```

- [ ] **Step 2: Run test to verify it fails**

```powershell
pnpm run test:rust -- sensitive_config
```

Expected: FAIL because `credential_store` does not exist.

- [ ] **Step 3: Add credential store**

Create `src-tauri/src/core/credential_store.rs`:

```rust
use keyring::Entry;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum CredentialStoreError {
    #[error("credential store error: {0}")]
    Keyring(#[from] keyring::Error),
}

pub type Result<T> = std::result::Result<T, CredentialStoreError>;

#[derive(Debug, Clone)]
pub struct CredentialStore {
    service: String,
}

impl CredentialStore {
    pub fn new(service: impl Into<String>) -> Self {
        Self {
            service: service.into(),
        }
    }

    pub fn credential_id(scope: &str, name: &str, kind: &str) -> String {
        format!("{scope}:{name}:{kind}")
    }

    pub fn set_secret(&self, id: &str, secret: &str) -> Result<()> {
        Entry::new(&self.service, id)?.set_password(secret)?;
        Ok(())
    }

    pub fn get_secret(&self, id: &str) -> Result<String> {
        Ok(Entry::new(&self.service, id)?.get_password()?)
    }

    pub fn delete_secret(&self, id: &str) -> Result<()> {
        Entry::new(&self.service, id)?.delete_credential()?;
        Ok(())
    }
}
```

- [ ] **Step 4: Add commands**

Create `src-tauri/src/commands/credentials.rs`:

```rust
use serde::Deserialize;
use tauri::{AppHandle, Manager};

use crate::core::credential_store::CredentialStore;

#[derive(Debug, Deserialize)]
pub struct SaveCredentialRequest {
    pub id: String,
    pub secret: String,
}

#[tauri::command]
pub async fn save_credential(app: AppHandle, request: SaveCredentialRequest) -> Result<(), String> {
    let store = app.state::<CredentialStore>();
    store
        .set_secret(&request.id, &request.secret)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn delete_credential(app: AppHandle, id: String) -> Result<(), String> {
    let store = app.state::<CredentialStore>();
    store.delete_secret(&id).map_err(|error| error.to_string())
}
```

Wire modules and state:

```rust
// src-tauri/src/core/mod.rs
pub mod app_paths;
pub mod credential_store;
pub mod settings_store;
```

```rust
// src-tauri/src/commands/mod.rs
pub mod credentials;
pub mod settings;
```

In `lib.rs` setup:

```rust
app.manage(crate::core::credential_store::CredentialStore::new("devhub"));
```

Add commands to `generate_handler!`:

```rust
commands::credentials::save_credential,
commands::credentials::delete_credential,
```

- [ ] **Step 5: Verify**

```powershell
cargo fmt --manifest-path src-tauri/Cargo.toml
pnpm run test:rust -- sensitive_config
pnpm build
```

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add -- src-tauri
git commit -m "feat: 添加系统凭据存储"
```

---

## Task 7: Build App Shell and Connection List

**Files:**
- Create: `src/app/AppShell.tsx`
- Create: `src/app/CommandPalette.tsx`
- Create: `src/app/DockPanel.tsx`
- Create: `src/app/StatusBar.tsx`
- Create: `src/app/WorkspaceTabs.tsx`
- Create: `src/features/connections/ConnectionList.tsx`
- Create: `src/features/connections/ConnectionEditor.tsx`
- Test: `src/app/AppShell.test.tsx`
- Modify: `src/App.tsx`

- [ ] **Step 1: Write Zed-style shell test**

Create `src/app/AppShell.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AppShell } from "./AppShell";

describe("AppShell", () => {
  it("renders Zed-style dock, workspace, assistant, command, and status regions", () => {
    render(<AppShell />);

    expect(screen.getByLabelText("连接列表")).toBeInTheDocument();
    expect(screen.getByLabelText("工作区")).toBeInTheDocument();
    expect(screen.getByLabelText("AI 面板")).toBeInTheDocument();
    expect(screen.getByLabelText("命令面板")).toBeInTheDocument();
    expect(screen.getByLabelText("状态栏")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```powershell
pnpm test -- src/app/AppShell.test.tsx
```

Expected: FAIL because `AppShell` does not exist.

- [ ] **Step 3: Add Zed-style app primitives**

Create `src/app/DockPanel.tsx`:

```tsx
import type { ReactNode } from "react";

interface DockPanelProps {
  side: "left" | "right";
  label: string;
  children: ReactNode;
}

export function DockPanel({ side, label, children }: DockPanelProps) {
  return (
    <aside className={`dock-panel dock-panel--${side}`} aria-label={label}>
      {children}
    </aside>
  );
}
```

Create `src/app/WorkspaceTabs.tsx`:

```tsx
interface WorkspaceTabsProps {
  active: "terminal" | "sftp" | "settings";
  onSelect: (workspace: "terminal" | "sftp" | "settings") => void;
}

export function WorkspaceTabs({ active, onSelect }: WorkspaceTabsProps) {
  const tabs = [
    ["terminal", "终端"],
    ["sftp", "SFTP"],
    ["settings", "Settings"],
  ] as const;

  return (
    <nav className="workspace-tabs" aria-label="工作区标签">
      {tabs.map(([id, label]) => (
        <button
          key={id}
          type="button"
          aria-pressed={active === id}
          onClick={() => onSelect(id)}
        >
          {label}
        </button>
      ))}
    </nav>
  );
}
```

Create `src/app/CommandPalette.tsx`:

```tsx
interface CommandPaletteProps {
  onOpenSettings: () => void;
}

export function CommandPalette({ onOpenSettings }: CommandPaletteProps) {
  return (
    <section className="command-palette" aria-label="命令面板">
      <button type="button" onClick={onOpenSettings}>
        打开 Settings
      </button>
    </section>
  );
}
```

Create `src/app/StatusBar.tsx`:

```tsx
interface StatusBarProps {
  activeConnectionId: string | null;
}

export function StatusBar({ activeConnectionId }: StatusBarProps) {
  return (
    <footer className="status-bar" aria-label="状态栏">
      <span>{activeConnectionId ? `连接：${activeConnectionId}` : "未连接"}</span>
      <span>AI: BYOK</span>
    </footer>
  );
}
```

- [ ] **Step 4: Add connection list**

Create `src/features/connections/ConnectionList.tsx`:

```tsx
import type { ConnectionSettings } from "../settings/settingsTypes";

interface ConnectionListProps {
  connections: ConnectionSettings[];
  onOpenTerminal: (connectionId: string) => void;
  onOpenSftp: (connectionId: string) => void;
}

export function ConnectionList({ connections, onOpenTerminal, onOpenSftp }: ConnectionListProps) {
  return (
    <aside className="connection-list" aria-label="连接列表">
      <header>
        <h2>连接</h2>
      </header>
      {connections.length === 0 ? <p>暂无连接，请在 Settings 中添加。</p> : null}
      <ul>
        {connections.map((connection) => (
          <li key={connection.id}>
            <strong>{connection.name}</strong>
            <span>{connection.username}@{connection.host}:{connection.port}</span>
            <button type="button" onClick={() => onOpenTerminal(connection.id)}>终端</button>
            <button type="button" onClick={() => onOpenSftp(connection.id)}>SFTP</button>
          </li>
        ))}
      </ul>
    </aside>
  );
}
```

Create `src/features/connections/ConnectionEditor.tsx`:

```tsx
export function ConnectionEditor() {
  return (
    <section>
      <h2>连接配置</h2>
      <p>连接配置由 settings.json 保存，敏感凭据写入系统凭据存储。</p>
    </section>
  );
}
```

- [ ] **Step 5: Add app shell**

Create `src/app/AppShell.tsx`:

```tsx
import { useState } from "react";
import { CommandPalette } from "./CommandPalette";
import { DockPanel } from "./DockPanel";
import { StatusBar } from "./StatusBar";
import { WorkspaceTabs } from "./WorkspaceTabs";
import { AiPanel } from "../features/ai/AiPanel";
import { ConnectionList } from "../features/connections/ConnectionList";
import { SettingsPanel } from "../features/settings/SettingsPanel";
import { useSettings } from "../features/settings/useSettings";
import { SftpWorkspace } from "../features/sftp/SftpWorkspace";
import { TerminalWorkspace } from "../features/terminal/TerminalWorkspace";

type Workspace = "terminal" | "sftp" | "settings";

export function AppShell() {
  const { settings } = useSettings();
  const [workspace, setWorkspace] = useState<Workspace>("settings");
  const [activeConnectionId, setActiveConnectionId] = useState<string | null>(null);

  return (
    <main className="app-shell">
      <CommandPalette onOpenSettings={() => setWorkspace("settings")} />
      <div className="app-shell__body">
        <DockPanel side="left" label="连接列表">
          <ConnectionList
            connections={settings.connections}
            onOpenTerminal={(connectionId) => {
              setActiveConnectionId(connectionId);
              setWorkspace("terminal");
            }}
            onOpenSftp={(connectionId) => {
              setActiveConnectionId(connectionId);
              setWorkspace("sftp");
            }}
          />
        </DockPanel>
        <section className="workspace" aria-label="工作区">
          <WorkspaceTabs active={workspace} onSelect={setWorkspace} />
          {workspace === "terminal" ? <TerminalWorkspace connectionId={activeConnectionId} /> : null}
          {workspace === "sftp" ? <SftpWorkspace connectionId={activeConnectionId} /> : null}
          {workspace === "settings" ? <SettingsPanel /> : null}
        </section>
        <DockPanel side="right" label="AI 面板">
          <AiPanel />
        </DockPanel>
      </div>
      <StatusBar activeConnectionId={activeConnectionId} />
    </main>
  );
}
```

- [ ] **Step 6: Add temporary workspace placeholders**

Create `src/features/ai/AiPanel.tsx`:

```tsx
export function AiPanel() {
  return (
    <aside className="ai-panel" aria-label="AI 面板">
      <h2>AI</h2>
      <p>AI 使用 BYOK，生成命令和脚本但不自动执行。</p>
    </aside>
  );
}
```

Create `src/features/terminal/TerminalWorkspace.tsx`:

```tsx
interface TerminalWorkspaceProps {
  connectionId: string | null;
}

export function TerminalWorkspace({ connectionId }: TerminalWorkspaceProps) {
  return <section>{connectionId ? `终端：${connectionId}` : "未选择连接"}</section>;
}
```

Create `src/features/sftp/SftpWorkspace.tsx`:

```tsx
interface SftpWorkspaceProps {
  connectionId: string | null;
}

export function SftpWorkspace({ connectionId }: SftpWorkspaceProps) {
  return <section>{connectionId ? `SFTP：${connectionId}` : "未选择连接"}</section>;
}
```

Modify `src/App.tsx`:

```tsx
import { AppShell } from "./app/AppShell";
import "./styles/globals.css";

export default function App() {
  return <AppShell />;
}
```

- [ ] **Step 7: Add Zed-inspired layout CSS**

Append to `src/styles/globals.css`:

```css
.app-shell {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) 26px;
  height: 100vh;
  background: #101214;
  color: #e6e8eb;
}

.app-shell__body {
  display: grid;
  grid-template-columns: 280px minmax(0, 1fr) 340px;
  min-height: 0;
}

.dock-panel {
  min-width: 0;
  overflow: hidden;
  border-color: #2a2f35;
  background: #15181b;
}

.dock-panel--left {
  border-right: 1px solid #2a2f35;
}

.dock-panel--right {
  border-left: 1px solid #2a2f35;
}

.workspace {
  min-width: 0;
  min-height: 0;
  display: grid;
  grid-template-rows: 34px minmax(0, 1fr);
  background: #0f1113;
}

.workspace-tabs,
.command-palette,
.status-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 10px;
  border-bottom: 1px solid #2a2f35;
  background: #15181b;
}

.status-bar {
  justify-content: space-between;
  border-top: 1px solid #2a2f35;
  border-bottom: 0;
  font-size: 12px;
  color: #aab0b7;
}
```

- [ ] **Step 8: Verify**

```powershell
pnpm test -- src/app src/features/connections
pnpm build
```

Expected: PASS.

- [ ] **Step 9: Commit**

```powershell
git add -- src
git commit -m "feat: 添加 Zed 风格工作台"
```

---

## Task 8: Implement Terminal Session API

**Files:**
- Create: `src-tauri/src/models/terminal.rs`
- Create: `src-tauri/src/ssh/session_manager.rs`
- Create: `src-tauri/src/ssh/terminal_manager.rs`
- Create: `src-tauri/src/commands/terminal.rs`
- Modify: `src-tauri/src/ssh/mod.rs`
- Modify: `src-tauri/src/models/mod.rs`
- Modify: `src-tauri/src/commands/mod.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Add terminal models**

Create `src-tauri/src/models/terminal.rs`:

```rust
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OpenTerminalRequest {
    pub connection_id: String,
    pub cols: u16,
    pub rows: u16,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TerminalInputRequest {
    pub session_id: String,
    pub data: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TerminalResizeRequest {
    pub session_id: String,
    pub cols: u16,
    pub rows: u16,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TerminalSessionResponse {
    pub session_id: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct TerminalOutputEvent {
    pub session_id: String,
    pub data: String,
}
```

- [ ] **Step 2: Add session manager skeleton**

Create `src-tauri/src/ssh/session_manager.rs`:

```rust
use std::collections::HashMap;
use std::sync::Arc;

use tokio::sync::Mutex;
use uuid::Uuid;

#[derive(Clone, Default)]
pub struct SessionManager {
    sessions: Arc<Mutex<HashMap<String, ManagedSession>>>,
}

#[derive(Debug)]
pub struct ManagedSession {
    pub connection_id: String,
}

impl SessionManager {
    pub async fn create_placeholder(&self, connection_id: String) -> String {
        let session_id = Uuid::new_v4().to_string();
        self.sessions.lock().await.insert(
            session_id.clone(),
            ManagedSession { connection_id },
        );
        session_id
    }

    pub async fn close(&self, session_id: &str) {
        self.sessions.lock().await.remove(session_id);
    }
}
```

- [ ] **Step 3: Add terminal commands**

Create `src-tauri/src/commands/terminal.rs`:

```rust
use tauri::{AppHandle, Manager};

use crate::models::terminal::{
    OpenTerminalRequest, TerminalInputRequest, TerminalResizeRequest, TerminalSessionResponse,
};
use crate::ssh::session_manager::SessionManager;

#[tauri::command]
pub async fn open_terminal(
    app: AppHandle,
    request: OpenTerminalRequest,
) -> Result<TerminalSessionResponse, String> {
    let sessions = app.state::<SessionManager>();
    let session_id = sessions.create_placeholder(request.connection_id).await;
    Ok(TerminalSessionResponse { session_id })
}

#[tauri::command]
pub async fn write_terminal(_app: AppHandle, _request: TerminalInputRequest) -> Result<(), String> {
    Ok(())
}

#[tauri::command]
pub async fn resize_terminal(_app: AppHandle, _request: TerminalResizeRequest) -> Result<(), String> {
    Ok(())
}

#[tauri::command]
pub async fn close_terminal(app: AppHandle, session_id: String) -> Result<(), String> {
    let sessions = app.state::<SessionManager>();
    sessions.close(&session_id).await;
    Ok(())
}
```

Wire modules:

```rust
// src-tauri/src/ssh/mod.rs
pub mod session_manager;
pub mod terminal_manager;
```

```rust
// src-tauri/src/models/mod.rs
pub mod settings;
pub mod terminal;
```

```rust
// src-tauri/src/commands/mod.rs
pub mod credentials;
pub mod settings;
pub mod terminal;
```

In `lib.rs`, add:

```rust
pub mod ssh;
```

Manage state:

```rust
app.manage(crate::ssh::session_manager::SessionManager::default());
```

Register commands:

```rust
commands::terminal::open_terminal,
commands::terminal::write_terminal,
commands::terminal::resize_terminal,
commands::terminal::close_terminal,
```

- [ ] **Step 4: Verify skeleton**

```powershell
cargo fmt --manifest-path src-tauri/Cargo.toml
pnpm run test:rust
pnpm build
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add -- src-tauri
git commit -m "feat: 添加终端会话命令骨架"
```

---

## Task 9: Add xterm Terminal UI

**Files:**
- Create: `src/features/terminal/TerminalTab.tsx`
- Modify: `src/features/terminal/TerminalWorkspace.tsx`
- Test: `src/features/terminal/TerminalWorkspace.test.tsx`

- [ ] **Step 1: Write terminal UI test**

Create `src/features/terminal/TerminalWorkspace.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TerminalWorkspace } from "./TerminalWorkspace";

describe("TerminalWorkspace", () => {
  it("prompts for a connection when none is selected", () => {
    render(<TerminalWorkspace connectionId={null} />);
    expect(screen.getByText("未选择连接")).toBeInTheDocument();
  });

  it("renders terminal container for selected connection", () => {
    render(<TerminalWorkspace connectionId="prod-web-01" />);
    expect(screen.getByLabelText("SSH 终端")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails if needed**

```powershell
pnpm test -- src/features/terminal/TerminalWorkspace.test.tsx
```

Expected: initial placeholder may partially pass; continue to replace with real terminal UI.

- [ ] **Step 3: Add terminal tab component**

Create `src/features/terminal/TerminalTab.tsx`:

```tsx
import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";

interface TerminalTabProps {
  connectionId: string;
}

export function TerminalTab({ connectionId }: TerminalTabProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const terminal = new Terminal({
      cursorBlink: true,
      fontFamily: "JetBrains Mono, Consolas, monospace",
      fontSize: 14,
      convertEol: true,
    });
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(containerRef.current);
    fitAddon.fit();
    terminal.writeln(`Connecting to ${connectionId}...`);

    return () => {
      terminal.dispose();
    };
  }, [connectionId]);

  return <div className="terminal-tab" aria-label="SSH 终端" ref={containerRef} />;
}
```

Modify `src/features/terminal/TerminalWorkspace.tsx`:

```tsx
import { TerminalTab } from "./TerminalTab";

interface TerminalWorkspaceProps {
  connectionId: string | null;
}

export function TerminalWorkspace({ connectionId }: TerminalWorkspaceProps) {
  if (!connectionId) {
    return <section>未选择连接</section>;
  }

  return (
    <section className="terminal-workspace">
      <TerminalTab connectionId={connectionId} />
    </section>
  );
}
```

- [ ] **Step 4: Verify**

```powershell
pnpm test -- src/features/terminal
pnpm build
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add -- src/features/terminal
git commit -m "feat: 添加 SSH 终端界面"
```

---

## Task 10: Implement Real SSH Terminal Transport

**Files:**
- Modify: `src-tauri/src/ssh/session_manager.rs`
- Modify: `src-tauri/src/commands/terminal.rs`
- Modify: `src/features/terminal/TerminalTab.tsx`
- Modify: `src/lib/tauri.ts`

- [ ] **Step 1: Add frontend event helpers**

Modify `src/lib/tauri.ts`:

```ts
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export function callBackend<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  return invoke<T>(command, args);
}

export function listenBackend<T>(
  event: string,
  handler: (payload: T) => void,
): Promise<UnlistenFn> {
  return listen<T>(event, (message) => handler(message.payload));
}
```

- [ ] **Step 2: Replace placeholder session with blocking SSH worker**

Modify `src-tauri/src/ssh/session_manager.rs` to:

- Lookup connection from `SettingsStore`.
- Lookup password/passphrase from `CredentialStore`.
- Connect with `ssh2::Session`.
- Create a PTY channel.
- Spawn a reader task that batches output and emits `terminal://output`.
- Keep writer handle in `SessionManager`.

Minimum API to expose:

```rust
impl SessionManager {
    pub async fn open_terminal(
        &self,
        app: tauri::AppHandle,
        connection_id: String,
        cols: u16,
        rows: u16,
    ) -> Result<String, String>;

    pub async fn write_terminal(&self, session_id: &str, data: &str) -> Result<(), String>;
    pub async fn resize_terminal(&self, session_id: &str, cols: u16, rows: u16) -> Result<(), String>;
    pub async fn close(&self, session_id: &str);
}
```

Implementation rule:

- Use `tokio::task::spawn_blocking` for `ssh2` blocking operations.
- Use bounded channels for input.
- Emit output in chunks, not per byte.
- Do not log passwords, passphrases, private key content, or API keys.

- [ ] **Step 3: Update terminal commands to call real manager**

Modify `src-tauri/src/commands/terminal.rs` so:

```rust
#[tauri::command]
pub async fn open_terminal(
    app: AppHandle,
    request: OpenTerminalRequest,
) -> Result<TerminalSessionResponse, String> {
    let sessions = app.state::<SessionManager>();
    let session_id = sessions
        .open_terminal(app.clone(), request.connection_id, request.cols, request.rows)
        .await?;
    Ok(TerminalSessionResponse { session_id })
}
```

Keep `write_terminal`, `resize_terminal`, and `close_terminal` delegating to `SessionManager`.

- [ ] **Step 4: Update terminal UI to invoke backend**

Modify `TerminalTab.tsx`:

- On mount, call `open_terminal`.
- Listen for `terminal://output`.
- Write only matching `session_id` output into xterm.
- On input, call `write_terminal`.
- On dispose, call `close_terminal`.
- On resize, call `resize_terminal`.

Use this event payload:

```ts
interface TerminalOutputEvent {
  session_id: string;
  data: string;
}
```

- [ ] **Step 5: Manual verification against a test server**

Create a local settings entry for a reachable test SSH host.

Run:

```powershell
pnpm tauri dev
```

Verify:

- Password login works.
- Private key login works.
- Private key passphrase works.
- Running `sudo -v` prompts in terminal and accepts manual password input.
- Closing the tab releases the session.

- [ ] **Step 6: Automated verification**

```powershell
pnpm build
pnpm run test:rust
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
```

Expected: PASS.

- [ ] **Step 7: Commit**

```powershell
git add -- src src-tauri
git commit -m "feat: 实现 SSH 终端连接"
```

---

## Task 11: Implement SFTP Backend

**Files:**
- Create: `src-tauri/src/models/sftp.rs`
- Create: `src-tauri/src/ssh/sftp_manager.rs`
- Create: `src-tauri/src/commands/sftp.rs`
- Modify: `src-tauri/src/ssh/mod.rs`
- Modify: `src-tauri/src/models/mod.rs`
- Modify: `src-tauri/src/commands/mod.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Add SFTP models**

Create `src-tauri/src/models/sftp.rs`:

```rust
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ListDirectoryRequest {
    pub connection_id: String,
    pub path: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct SftpEntry {
    pub name: String,
    pub path: String,
    pub kind: String,
    pub size: u64,
    pub modified_at: Option<String>,
    pub permissions: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeletePathRequest {
    pub connection_id: String,
    pub path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RenamePathRequest {
    pub connection_id: String,
    pub from: String,
    pub to: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateDirectoryRequest {
    pub connection_id: String,
    pub path: String,
}
```

- [ ] **Step 2: Add manager and commands**

Create `src-tauri/src/ssh/sftp_manager.rs` with functions:

```rust
pub async fn list_directory(connection_id: String, path: String) -> Result<Vec<SftpEntry>, String>;
pub async fn delete_path(connection_id: String, path: String) -> Result<(), String>;
pub async fn rename_path(connection_id: String, from: String, to: String) -> Result<(), String>;
pub async fn create_directory(connection_id: String, path: String) -> Result<(), String>;
```

Implementation rule:

- Reuse the same connection lookup and credential resolution as terminal.
- Use current SSH user only.
- Do not attempt sudo writes.
- Use `spawn_blocking` for `ssh2::Sftp` operations.

Create `src-tauri/src/commands/sftp.rs` exposing:

```rust
#[tauri::command]
pub async fn list_directory(request: ListDirectoryRequest) -> Result<Vec<SftpEntry>, String>;

#[tauri::command]
pub async fn delete_path(request: DeletePathRequest) -> Result<(), String>;

#[tauri::command]
pub async fn rename_path(request: RenamePathRequest) -> Result<(), String>;

#[tauri::command]
pub async fn create_directory(request: CreateDirectoryRequest) -> Result<(), String>;
```

- [ ] **Step 3: Wire modules and commands**

Add `sftp` modules to `models/mod.rs`, `commands/mod.rs`, `ssh/mod.rs`, and `generate_handler!`.

- [ ] **Step 4: Verify**

```powershell
pnpm run test:rust
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add -- src-tauri
git commit -m "feat: 添加 SFTP 后端能力"
```

---

## Task 12: Build SFTP UI

**Files:**
- Modify: `src/features/sftp/SftpWorkspace.tsx`
- Create: `src/features/sftp/TransferQueue.tsx`
- Test: `src/features/sftp/SftpWorkspace.test.tsx`

- [ ] **Step 1: Write SFTP UI test**

Create `src/features/sftp/SftpWorkspace.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SftpWorkspace } from "./SftpWorkspace";

describe("SftpWorkspace", () => {
  it("prompts for a connection when none is selected", () => {
    render(<SftpWorkspace connectionId={null} />);
    expect(screen.getByText("未选择连接")).toBeInTheDocument();
  });

  it("shows toolbar for selected connection", () => {
    render(<SftpWorkspace connectionId="prod-web-01" />);
    expect(screen.getByRole("button", { name: "刷新" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "新建目录" })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Implement SFTP UI**

Modify `src/features/sftp/SftpWorkspace.tsx`:

```tsx
import { useCallback, useState } from "react";
import { callBackend } from "../../lib/tauri";
import type { SftpEntry } from "./sftpTypes";
import { TransferQueue } from "./TransferQueue";

interface SftpWorkspaceProps {
  connectionId: string | null;
}

export function SftpWorkspace({ connectionId }: SftpWorkspaceProps) {
  const [path, setPath] = useState("/");
  const [entries, setEntries] = useState<SftpEntry[]>([]);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!connectionId) return;
    try {
      const nextEntries = await callBackend<SftpEntry[]>("list_directory", {
        request: { connection_id: connectionId, path },
      });
      setEntries(nextEntries);
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }, [connectionId, path]);

  if (!connectionId) {
    return <section>未选择连接</section>;
  }

  return (
    <section className="sftp-workspace">
      <header>
        <h2>SFTP</h2>
        <input value={path} onChange={(event) => setPath(event.target.value)} aria-label="远程路径" />
        <button type="button" onClick={() => void refresh()}>刷新</button>
        <button type="button">新建目录</button>
      </header>
      {error ? <p role="alert">{error}</p> : null}
      <table>
        <thead>
          <tr>
            <th>名称</th>
            <th>类型</th>
            <th>大小</th>
            <th>权限</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => (
            <tr key={entry.path}>
              <td>{entry.name}</td>
              <td>{entry.kind}</td>
              <td>{entry.size}</td>
              <td>{entry.permissions ?? ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <TransferQueue />
    </section>
  );
}
```

Create `src/features/sftp/TransferQueue.tsx`:

```tsx
export function TransferQueue() {
  return (
    <section aria-label="传输队列">
      <h3>传输队列</h3>
      <p>暂无传输任务</p>
    </section>
  );
}
```

- [ ] **Step 3: Verify**

```powershell
pnpm test -- src/features/sftp
pnpm build
```

Expected: PASS.

- [ ] **Step 4: Manual SFTP verification**

Run:

```powershell
pnpm tauri dev
```

Verify with a test server:

- Browse `/`.
- Browse user home directory.
- Create a test directory in a writable location.
- Rename it.
- Delete it.
- Attempt to write in a restricted directory and confirm the UI shows permission error without sudo.

- [ ] **Step 5: Commit**

```powershell
git add -- src
git commit -m "feat: 添加 SFTP 文件管理界面"
```

---

## Task 13: Implement BYOK AI Panel

**Files:**
- Create: `src-tauri/src/models/ai.rs`
- Create: `src-tauri/src/core/ai_client.rs`
- Create: `src-tauri/src/commands/ai.rs`
- Modify: `src-tauri/src/models/mod.rs`
- Modify: `src-tauri/src/core/mod.rs`
- Modify: `src-tauri/src/commands/mod.rs`
- Modify: `src/features/ai/AiPanel.tsx`
- Create: `src/features/ai/useAiChat.ts`
- Test: `src/features/ai/AiPanel.test.tsx`

- [ ] **Step 1: Write AI panel test**

Create `src/features/ai/AiPanel.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AiPanel } from "./AiPanel";

describe("AiPanel", () => {
  it("states that generated commands are not executed automatically", () => {
    render(<AiPanel />);
    expect(screen.getByText(/不会自动执行/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Add Rust AI models and command**

Create `src-tauri/src/models/ai.rs`:

```rust
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AiChatRequest {
    pub prompt: String,
    pub context: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct AiChatResponse {
    pub text: String,
}
```

Create `src-tauri/src/core/ai_client.rs`:

```rust
use crate::models::ai::{AiChatRequest, AiChatResponse};

pub async fn chat(request: AiChatRequest) -> Result<AiChatResponse, String> {
    if request.prompt.trim().is_empty() {
        return Err("prompt is required".to_string());
    }

    Ok(AiChatResponse {
        text: "AI Provider wiring will use BYOK settings and never auto-execute generated commands.".to_string(),
    })
}
```

Create `src-tauri/src/commands/ai.rs`:

```rust
use crate::core::ai_client;
use crate::models::ai::{AiChatRequest, AiChatResponse};

#[tauri::command]
pub async fn ai_chat(request: AiChatRequest) -> Result<AiChatResponse, String> {
    ai_client::chat(request).await
}
```

Wire modules and command.

- [ ] **Step 3: Add frontend AI hook**

Create `src/features/ai/useAiChat.ts`:

```ts
import { useState } from "react";
import { callBackend } from "../../lib/tauri";

interface AiChatResponse {
  text: string;
}

export function useAiChat() {
  const [answer, setAnswer] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function ask(prompt: string, context?: string) {
    try {
      const response = await callBackend<AiChatResponse>("ai_chat", {
        request: { prompt, context },
      });
      setAnswer(response.text);
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }

  return { answer, error, ask };
}
```

Modify `src/features/ai/AiPanel.tsx`:

```tsx
import { useState } from "react";
import { useAiChat } from "./useAiChat";

export function AiPanel() {
  const [prompt, setPrompt] = useState("");
  const { answer, error, ask } = useAiChat();

  return (
    <aside className="ai-panel" aria-label="AI 面板">
      <h2>AI</h2>
      <p>AI 使用 BYOK。生成命令和脚本，但不会自动执行。</p>
      <textarea
        aria-label="AI 输入"
        value={prompt}
        onChange={(event) => setPrompt(event.target.value)}
      />
      <button type="button" onClick={() => void ask(prompt)}>
        发送
      </button>
      {error ? <p role="alert">{error}</p> : null}
      {answer ? <pre>{answer}</pre> : null}
    </aside>
  );
}
```

- [ ] **Step 4: Verify**

```powershell
pnpm test -- src/features/ai
pnpm build
pnpm run test:rust
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add -- src src-tauri
git commit -m "feat: 添加 BYOK AI 面板"
```

---

## Task 14: Replace AI Stub With OpenAI-Compatible Provider

**Files:**
- Modify: `src-tauri/src/core/ai_client.rs`
- Modify: `src-tauri/src/commands/ai.rs`
- Modify: `src-tauri/src/core/credential_store.rs`

- [ ] **Step 1: Implement provider request**

Modify `ai_client.rs` to:

- Load settings through `SettingsStore`.
- Read `settings.ai.api_key_ref` from `CredentialStore`.
- POST to `{base_url}/chat/completions`.
- Send a conservative system prompt: "Generate explanations and commands, but do not claim execution."
- Return text only.
- Redact API key from all errors.

Request shape:

```json
{
  "model": "configured-model",
  "messages": [
    { "role": "system", "content": "You are DevHub AI. Generate explanations and commands, but never execute anything." },
    { "role": "user", "content": "user prompt and optional context" }
  ],
  "stream": false
}
```

- [ ] **Step 2: Verify missing API key error**

Run the app without an API key:

```powershell
pnpm tauri dev
```

Expected: AI panel shows a clear missing credential error, not a panic and not a leaked key.

- [ ] **Step 3: Verify with a test BYOK key**

Save API key through credential command or Settings UI, then ask:

```text
解释这个命令：sudo systemctl restart nginx
```

Expected:

- AI returns explanation.
- It does not execute anything.
- DevTools/logs do not show the API key.

- [ ] **Step 4: Automated verification**

```powershell
pnpm build
pnpm run test:rust
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add -- src-tauri
git commit -m "feat: 接入 OpenAI 兼容 AI Provider"
```

---

## Task 15: Performance and Safety Pass

**Files:**
- Review and modify: `src-tauri/src/ssh/session_manager.rs`
- Review and modify: `src-tauri/src/ssh/sftp_manager.rs`
- Review and modify: `src/features/terminal/TerminalTab.tsx`
- Review and modify: `src/features/sftp/SftpWorkspace.tsx`
- Create: `docs/testing/manual-mvp-checklist.md`

- [ ] **Step 1: Create manual checklist**

Create `docs/testing/manual-mvp-checklist.md`:

```markdown
# DevHub MVP Manual Test Checklist

## Settings

- [ ] settings.json loads on first run.
- [ ] Editing theme/font/layout validates JSON.
- [ ] Password, passphrase, API key are rejected if written directly into settings.json.
- [ ] Copying settings.json and keymap.json restores non-sensitive settings.

## SSH

- [ ] Password login works.
- [ ] Private key login works.
- [ ] Private key passphrase works.
- [ ] sudo prompt works in terminal.
- [ ] Closing a terminal releases the session.
- [ ] 20 terminal tabs remain responsive.

## SFTP

- [ ] Browse writable directory.
- [ ] Upload small file.
- [ ] Download small file.
- [ ] Rename file.
- [ ] Delete file.
- [ ] Permission denied is shown without sudo attempt.
- [ ] 3 concurrent transfer tasks do not freeze terminal input.

## AI

- [ ] BYOK key is stored outside settings.json.
- [ ] AI can explain selected text.
- [ ] AI can generate a command.
- [ ] AI-generated command is not auto-executed.
- [ ] API key does not appear in logs.
```

- [ ] **Step 2: Run automated checks**

```powershell
pnpm test
pnpm build
pnpm run test:rust
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
```

Expected: PASS.

- [ ] **Step 3: Run desktop app**

```powershell
pnpm tauri dev
```

Expected:

- App starts without console errors.
- Settings, SSH, SFTP, and AI sections are visible.
- No obvious layout overlap at default window size.

- [ ] **Step 4: Record known limitations**

Append to `docs/testing/manual-mvp-checklist.md`:

```markdown
## Known MVP Limitations

- No jump host support.
- No SSH agent support.
- No SSH tunnel support.
- No SFTP sudo write.
- No full database or Redis management.
- No AI auto-execution.
```

- [ ] **Step 5: Commit**

```powershell
git add -- docs src src-tauri
git commit -m "test: 添加 MVP 验收清单"
```

---

## Final Verification

Run before declaring MVP implementation complete:

```powershell
git status --short
pnpm test
pnpm build
pnpm run test:rust
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
```

Expected:

- `git status --short` is clean.
- All tests pass.
- Frontend build succeeds.
- Rust formatting and clippy pass.

## Self-Review Notes

- Spec coverage: plan includes Settings, copyable JSON config, credential storage, SSH terminal, SFTP, terminal-only sudo, BYOK AI, performance and manual verification.
- Explicitly out of scope: jump host, SSH agent, tunnel, SFTP sudo writes, database/Redis management, Docker/K8s, AI auto-execution.
- Risk called out: `ssh2` is blocking; plan requires `spawn_blocking`, bounded channels, and session cleanup to protect UI responsiveness.
