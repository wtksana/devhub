# Redis Create Key Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 Redis 工作区支持新建 `string`、`hash`、`list`、`set` 和 `zset` 类型 key。

**Architecture:** 后端新增一个 Tauri command，按类型使用 Redis 原生命令创建 key，并用 `EXISTS` 防止覆盖已有 key。前端在 Redis 工具栏增加“新建 key”入口，复用当前弹窗风格，创建成功后刷新列表并打开新 key 详情。

**Tech Stack:** Tauri 2、Rust、redis-rs、React、TypeScript、Vitest、Testing Library。

---

### Task 1: 后端创建 key 命令

**Files:**
- Modify: `src-tauri/src/commands/redis.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: 添加后端请求结构和规范化测试**

在 `src-tauri/src/commands/redis.rs` 增加 `CreateRedisKeyRequest`，字段包括 `connection_id`、`database`、`key`、`key_type`、`ttl_seconds`、`string_value`、`hash_entries`、`list_items`、`set_members`、`zset_entries`。

新增测试覆盖：
- trim key 和 type。
- 空 key 报错。
- 不支持的类型报错。
- TTL 为 0 报错。
- zset 分数非数字报错。

- [ ] **Step 2: 实现 `create_redis_key`**

实现逻辑：
- 加载 Redis 连接并切换 database。
- `EXISTS key` 为 true 时返回 `redis key already exists`。
- `string` 使用 `SET key value`。
- `hash` 使用 `HSET key field value ...`，空集合时使用默认字段 `field` / 空值。
- `list` 使用 `RPUSH key item ...`，空集合时写入一个空字符串元素。
- `set` 使用 `SADD key member ...`，空集合时写入一个空字符串成员。
- `zset` 使用 `ZADD key score member ...`，空集合时写入 `0` / 空字符串成员。
- TTL 存在时追加 `EXPIRE key ttl_seconds`。

- [ ] **Step 3: 注册 Tauri command**

在 `src-tauri/src/lib.rs` 的 invoke handler 中注册 `commands::redis::create_redis_key`。

### Task 2: 前端新建 key 弹窗

**Files:**
- Modify: `src/features/redis/RedisWorkspace.tsx`
- Modify: `src/features/redis/RedisWorkspace.test.tsx`
- Modify: `src/i18n/locales/zh-CN.ts`
- Modify: `src/i18n/locales/en-US.ts`
- Modify: `src/styles/globals.css`

- [ ] **Step 1: 写前端测试**

在 `RedisWorkspace.test.tsx` 新增用例：
- 点击工具栏“新建 key”。
- 选择 `hash`。
- 输入 key、field、value、TTL。
- 点击确认。
- 断言调用 `create_redis_key`。
- 断言刷新列表并打开新 key 详情。

- [ ] **Step 2: 实现弹窗状态和提交逻辑**

在 `RedisWorkspace.tsx` 增加：
- `createDialogOpen`
- `createDraft`
- `openCreateDialog`
- `confirmCreateKey`

提交时校验 key 非空、TTL 必须大于 0。成功后关闭弹窗、刷新 key 列表、打开新 key 详情。

- [ ] **Step 3: 实现类型化内容区**

弹窗内容按类型显示：
- `string`：textarea。
- `hash`：字段和值两列，支持添加条目。
- `list`：一行一个元素。
- `set`：一行一个成员。
- `zset`：成员和分数两列，支持添加条目。

- [ ] **Step 4: 补 i18n 和样式**

补充中文和英文文案，并添加最少 CSS 让弹窗字段宽度和当前连接/SFTP 弹窗一致。

### Task 3: 文档和验证

**Files:**
- Modify: `README.md`
- Modify: `docs/当前状态与下一步.md`
- Modify: `docs/testing/manual-mvp-checklist.md`

- [ ] **Step 1: 更新文档**

说明 Redis 工作区支持新建 `string`、`hash`、`list`、`set`、`zset` key，新建时不会覆盖已有 key。

- [ ] **Step 2: 运行验证**

运行：

```powershell
$env:Path = 'C:\Users\ttat\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin;' + $env:Path
& 'C:\Users\ttat\.cache\codex-runtimes\codex-primary-runtime\dependencies\bin\pnpm.cmd' exec vitest run src/features/redis/RedisWorkspace.test.tsx --reporter=verbose
& 'C:\Users\ttat\.cache\codex-runtimes\codex-primary-runtime\dependencies\bin\pnpm.cmd' test
& 'C:\Users\ttat\.cache\codex-runtimes\codex-primary-runtime\dependencies\bin\pnpm.cmd' build
cargo test --manifest-path src-tauri\Cargo.toml
cargo clippy --manifest-path src-tauri\Cargo.toml --all-targets -- -D warnings
cargo fmt --manifest-path src-tauri\Cargo.toml --check
git diff --check
```

Expected:
- 前端目标测试通过。
- 前端全量测试通过。
- 前端 build 通过，允许保留既有 chunk size warning。
- Rust 测试、clippy、fmt 和 diff check 通过。

