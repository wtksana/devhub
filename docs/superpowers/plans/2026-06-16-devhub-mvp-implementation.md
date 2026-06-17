# DevHub MVP 中文实施计划

> 本文档用于记录 DevHub 第一阶段 MVP 的实现目标、模块边界、任务拆分、验证方式和当前进度。后续新增或修改项目文档时，默认使用简体中文；代码标识符、命令、文件路径、协议名和第三方产品名按原文保留。

## 目标

构建第一版 DevHub 桌面 MVP：基于 Tauri 2、Rust、React 和 TypeScript，实现可迁移设置、连接管理、SSH 终端和 SFTP 文件管理。

## 技术栈

- 桌面框架：Tauri 2。
- 后端语言：Rust。
- 前端框架：React + TypeScript + Vite。
- 终端渲染：xterm.js。
- 设置编辑：Monaco Editor。
- 配置校验：Zod 与 Rust 侧 serde 校验。
- SSH/SFTP：`ssh2` / libssh2。
- 凭据存储：系统凭据存储，通过 `keyring` 访问，保留给私钥口令等后续凭据场景。

## 模块边界

- `src/features/*` 只负责前端 UI 和前端状态。
- `src/lib/tauri.ts` 是前端唯一直接调用 Tauri `invoke` / `listen` 的入口。
- `src-tauri/src/commands/*` 是 Tauri 命令边界。
- `src-tauri/src/core/*` 放置通用后端逻辑，例如设置存储、凭据存储。
- `src-tauri/src/ssh/*` 负责 SSH、SFTP 生命周期和连接相关能力。
- `src-tauri/src/models/*` 定义前后端命令使用的可序列化请求和响应模型。

## 配置原则

- `settings.json` 保存可迁移配置，例如主题、字体、布局和连接基础信息。
- `keymap.json` 保存快捷键配置。
- SSH 密码按用户当前要求直接保存在连接认证配置中，便于复制配置恢复环境。
- 私钥内容不写入普通 JSON 文件，只保存私钥路径。
- 保存设置时拒绝不属于连接认证结构的明显敏感字段，例如散落的 `password`、`passphrase`、`private_key`。

## 已完成任务

### 任务 1：初始化 Tauri React 应用

- 初始化 Tauri 2 + React + TypeScript 项目。
- 安装前端和 Rust 依赖。
- 添加基础测试脚本。

### 任务 2：编辑器和格式化基线

- 添加 `.editorconfig`。
- 整理忽略文件。
- 添加基础全局样式。

### 任务 3：共享设置结构校验

- 定义前端设置类型和 Zod 结构校验。
- 添加敏感字段拒绝逻辑。
- 添加连接、终端、SFTP 类型出口。

### 任务 4：Rust 设置存储

- 实现 `SettingsStore`。
- 首次运行创建默认 `settings.json` 和 `keymap.json`。
- 在 Rust 侧拒绝不允许的敏感字段。

### 任务 5：设置面板和 JSON 编辑

- 实现设置面板、`settings.json` 编辑器和快捷键占位编辑器。
- 前端通过 Tauri 命令加载和保存设置。

### 任务 6：系统凭据存储

- 添加系统凭据存储后端能力，保留给私钥口令等后续凭据场景。
- 提供保存和删除凭据的后端命令。

### 任务 7：Zed 风格工作台

- 实现左侧连接面板、中央工作区、命令入口和状态栏。
- 添加连接列表和基础工作区。

### 任务 8：终端会话命令骨架

- 添加终端请求和响应模型。
- 添加终端 session manager 占位能力。
- 注册打开、写入、调整大小和关闭终端命令。

### 任务 9：SSH 终端界面

- 使用 xterm.js 渲染终端区域。
- 添加终端工作区组件和测试 mock。

### 任务 10：真实 SSH 终端连接

- 后端读取连接配置。
- 使用 `ssh2` 建立 SSH 会话和 PTY shell。
- 使用 `spawn_blocking` 隔离阻塞 SSH 操作。
- 使用有界通道写入终端输入。
- 通过 Tauri 事件 `terminal://output` 推送输出。
- 前端按 `session_id` 过滤输出并转发用户输入。
- 关闭标签时释放会话。

### 任务 11：SFTP 后端能力

- 添加 SFTP 请求、响应和目录条目模型。
- 抽取 SSH 连接和认证 helper，供终端和 SFTP 复用。
- 实现列目录、删除、重命名、新建目录命令。
- SFTP 使用当前 SSH 登录用户权限，不做 sudo 写入。

### 任务 12：SFTP 前端界面

- 添加 SFTP 工作区、远程路径输入、刷新按钮、目录表格和传输队列占位。
- 前端通过 `list_directory` 命令加载远程目录。

### 任务 13：移除 AI 功能

- 删除前端 AI 面板、AI 状态栏按钮和 AI 设置项。
- 删除后端 AI 命令、AI 模型、AI client 和相关测试。
- 删除 OpenAI 兼容 HTTP 依赖。
- 更新文档和验收清单。

## 自动验证命令

每次合并前至少运行：

```powershell
pnpm test
pnpm build
pnpm run test:rust
cargo fmt --manifest-path src-tauri\Cargo.toml --check
cargo clippy --manifest-path src-tauri\Cargo.toml --all-targets -- -D warnings
```

当前已验证结果：

- 前端测试通过。
- 前端构建通过。
- Rust 测试通过。
- Vite 仍提示 chunk size 较大，来源主要是 Monaco/xterm 等大依赖，不阻塞 MVP。

## 手动验收重点

手动验收清单位于 `docs/testing/manual-mvp-checklist.md`。真实环境验收需要准备：

- 至少一台可访问的 SSH 测试服务器。
- 密码登录账号。
- 私钥登录账号。
- 带口令私钥的登录场景。
- 可写和不可写的 SFTP 测试目录。

## 暂不进入 MVP 的能力

- 跳板机。
- SSH agent。
- SSH tunnel。
- SFTP sudo 写入。
- 完整数据库管理。
- Redis 管理。
- Docker / Kubernetes 管理。
- AI 相关功能。

## 下一阶段建议

1. 做真实 SSH、SFTP 手动验收。
2. 修复手动验收暴露的问题。
3. 合并 `devhub-mvp` 到 `master`。
4. 开始第二阶段：数据库连接管理、Redis 管理、连接编辑器完善、传输队列和 UI 细节打磨。
