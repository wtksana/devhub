# DevHub MVP 设计文档

## 背景

DevHub 是一个跨平台一站式开发运维桌面工具。长期目标类似 HexHub，覆盖 SSH、SFTP、数据库、Redis、Docker、AI 辅助等开发运维场景。

第一版不追求完整平台形态，先聚焦服务器连接体验：SSH 终端、SFTP 文件管理、连接管理和 AI 辅助面板。这样可以优先打磨长连接、流控、安全凭据、终端体验和文件传输这些底层能力，为后续数据库、Redis、隧道和更多 AI 场景打基础。

## MVP 范围

第一版包含：

- SSH 终端。
- SFTP 文件管理。
- 连接管理。
- 设置面板和可编辑的 `settings.json`。
- 可复制迁移的 `settings.json` / `keymap.json`。
- 系统凭据存储。
- 密码登录。
- 私钥登录。
- 带口令的私钥。
- 终端内 sudo 场景。
- AI 面板：BYOK 配置，生成命令、脚本、解释说明，但默认不自动执行。

第一版不包含：

- 跳板机。
- SSH agent。
- SSH tunnel。
- SFTP sudo 写入。
- 数据库正式管理。
- Redis 正式管理。
- Docker / Kubernetes。
- AI Agent 自动执行多步任务。

## 技术选型

- 桌面框架：Tauri 2。
- 后端核心：Rust。
- 异步运行时：Tokio。
- 前端：TypeScript + React。
- SSH 终端 UI：xterm.js。
- SFTP 和 SSH 连接：Rust 后端统一管理。
- 用户配置：JSON 文件，提供 `settings.json` 编辑能力。
- 运行态缓存和历史记录：SQLite。
- 密码、私钥口令、AI API 密钥：系统凭据存储。

选择 Tauri + Rust 的原因：

- Tauri 使用系统 WebView，启动速度和安装包体积通常优于 Electron。
- Rust 适合管理 SSH/SFTP 长连接、并发任务、流控、取消、资源回收和敏感凭据。
- 前端可以使用成熟 Web 生态构建复杂面板和终端界面。
- 连接能力集中在 Rust 后端，避免把长连接和密钥逻辑放进前端渲染进程。

备选方案：

- Wails + Go：网络并发开发效率高，但桌面生态、Tauri 插件生态和精细资源控制略弱。
- Electron + Node.js：开发快，但启动速度、内存占用和长时间多连接稳定性与目标冲突，不作为首选。

## 产品结构

第一版工作台由四个区域组成：

- 左侧连接面板：服务器连接、分组、快速打开。
- 中央工作区：SSH 终端标签页和 SFTP 文件标签页。
- 右侧 AI 面板：与当前连接、当前终端或当前目录相关的 AI 对话。
- 底部状态栏：连接状态、任务状态、AI 提供方 状态。

前端整体体验参考 Zed，但不是复制 Zed 编辑器功能。第一版借鉴的是工作台结构、命令优先交互、紧凑面板、JSON 配置和键盘友好体验。

## 工作台设计

- 工作台采用左侧 停靠面板、中央 工作区、右侧 助手 面板、底部状态栏的结构。
- 面板可以折叠，宽度可调整，并把宽度和可见状态写入 `settings.json`。
- 使用命令面板打开常见操作，例如打开设置、连接服务器、切换标签。
- 终端、SFTP、设置、AI 都以标签页或面板形式进入工作台。
- AI 面板在右侧保持上下文感知，但默认不遮挡终端和 SFTP 主操作区。
- 主题、字体、布局和快捷键都通过 设置面板和 JSON 配置控制。

核心前端组件：

- `AppShell`：整体工作台骨架。
- `DockPanel`：左侧连接 停靠面板 和右侧 AI 停靠面板。
- `WorkspaceTabs`：中央标签栏。
- `StatusBar`：连接状态、任务状态、AI 提供方 状态。
- `CommandPalette`：打开连接、打开设置、切换面板等基础命令入口。
- `SplitPane`：可调整宽度的面板布局。

## 设置面板

设置面板参考 Zed 的配置体验，提供图形化设置入口，同时允许用户直接编辑 `settings.json`。Zed 支持通过设置窗口或 `settings.json` 修改配置，也支持独立的 `keymap.json` 管理快捷键；DevHub 第一版采用相同方向：图形界面适合常见配置，JSON 文件适合迁移、备份和 AI 辅助修改。

设置面板包含：

- 外观设置：主题、界面字体、终端字体、终端字号。
- 布局设置：连接栏宽度、AI 面板位置、默认打开面板。
- 连接设置：新增、编辑、删除连接；配置密码或私钥认证。
- 快捷键设置：打开终端、打开 SFTP、切换标签、打开 AI 面板、复制粘贴等。
- AI 设置：BYOK 提供方、基础 URL、默认模型、上下文发送策略。

第一版必须支持：

- 设置图形面板。
- 打开 `settings.json` 的入口。
- 保存后校验 JSON 结构校验。
- 清晰展示配置错误。
- 新安装后复制配置文件即可恢复非敏感工作环境。

## 配置文件

配置以可复制的 JSON 文件为主，目标是新安装后复制配置文件即可恢复大部分工作环境。

配置文件：

- `settings.json`：主配置，包含 UI、布局、AI 非敏感参数、连接非敏感参数。
- `keymap.json`：快捷键配置，便于后续独立管理快捷键冲突和上下文。

默认位置：

- Windows：`%APPDATA%\DevHub\settings.json` 和 `%APPDATA%\DevHub\keymap.json`。
- macOS：`~/Library/Application Support/DevHub/settings.json` 和 `~/Library/Application Support/DevHub/keymap.json`。
- Linux：`~/.config/devhub/settings.json` 和 `~/.config/devhub/keymap.json`。

`settings.json` 可以保存：

- 主题、字体、字号。
- 布局、面板宽度、默认打开状态。
- 连接名称、分组、主机、端口、用户名、认证方式和凭据引用。
- AI 提供方、基础 URL、模型名。

`settings.json` 不保存：

- SSH 密码。
- 私钥口令。
- AI API 密钥。
- 私钥内容。

示例：

```json
{
  "appearance": {
    "theme": "dark",
    "ui_font_family": "Inter",
    "terminal_font_family": "JetBrains Mono",
    "terminal_font_size": 14
  },
  "layout": {
    "ai_panel": "right",
    "connection_sidebar_width": 280,
    "open_ai_panel_by_default": true
  },
  "connections": [
    {
      "id": "prod-web-01",
      "name": "prod-web-01",
      "group": "production",
      "host": "10.0.0.10",
      "port": 22,
      "username": "deploy",
      "auth": {
        "type": "private_key",
        "private_key_path": "C:\\Users\\user\\.ssh\\id_ed25519",
        "passphrase_ref": "ssh:prod-web-01:passphrase"
      }
    }
  ],
  "ai": {
    "provider": "openai_compatible",
    "base_url": "https://api.example.com/v1",
    "model": "gpt-4.1",
    "api_key_ref": "ai:default"
  }
}
```

复制配置文件可以恢复界面、连接条目、AI 提供方 和模型配置。敏感凭据需要用户在新机器上重新录入，或后续通过受密码保护的加密导入导出功能迁移；该加密迁移不进入第一版。

## 凭据安全

敏感信息包括：

- SSH 密码。
- 私钥口令。
- AI API 密钥。
- 私钥内容。

这些信息应保存到系统凭据存储。Windows 使用 Credential Manager，macOS 使用 Keychain，Linux 使用 Secret Service 或兼容实现。

后端只向前端暴露凭据引用和操作结果，不回传敏感明文。日志、错误消息和调试输出不得包含敏感值。

## SSH 终端

第一版支持：

- 密码认证。
- 私钥认证。
- 带口令私钥。
- 终端内 sudo 交互。
- 多终端标签。
- 关闭标签时释放会话。

sudo 场景只在终端内支持。用户在远程终端里按服务器交互正常输入 sudo 密码。第一版不做 SFTP 提权写文件。

## SFTP 文件管理

SFTP 能力：

- 浏览远程目录。
- 上传文件。
- 下载文件。
- 新建目录。
- 删除文件或目录。
- 重命名文件或目录。
- 展示权限错误。
- 传输队列和基础任务状态。

SFTP 使用当前 SSH 登录用户权限。不做 sudo 写入。如果用户没有权限写入目录，界面展示失败原因，不自动尝试提权。

## AI 面板

AI 使用 BYOK 模式。用户在设置面板中配置提供方、基础 URL、模型和 API 密钥。API 密钥写入系统凭据存储，`settings.json` 只保存 `api_key_ref`。

第一版 AI 能力：

- 根据当前终端或用户输入解释命令。
- 根据用户输入生成 shell 命令。
- 根据 SFTP 当前路径解释常见文件操作。
- 生成 SQL 或脚本草稿，但不自动执行。
- 明确提示风险操作需要人工确认。

第一版 AI 禁止：

- 自动执行命令。
- 自动发送密码、私钥口令、API 密钥。
- 自动修改远程文件。
- 在没有用户确认的情况下执行高风险操作。

## 前端模块

- `ConnectionList`：连接分组、服务器列表、状态展示。
- `AppShell`：Zed 风格工作台布局，组织 停靠面板、工作区、AI 面板 和 状态栏。
- `CommandPalette`：命令入口和键盘优先操作。
- `WorkspaceTabs`：终端、SFTP、设置的标签管理。
- `DockPanel`：可折叠、可调整宽度的左右面板。
- `TerminalWorkspace`：终端标签、xterm.js 实例、终端快捷操作。
- `SftpWorkspace`：远程目录、文件操作、传输任务列表。
- `AiPanel`：聊天、上下文选择、AI 结果展示。
- `SettingsPanel`：图形化设置。
- `SettingsJsonEditor`：编辑 `settings.json`，展示校验错误。
- `KeymapEditor`：快捷键配置和冲突提示。

前端不直接持有敏感凭据，不直接连接 SSH/SFTP。前端通过 Tauri 命令和事件订阅与 Rust 后端通信。

## Rust 后端模块

- `connection_manager`：连接配置、会话生命周期、状态管理。
- `credential_store`：系统凭据存储读写。
- `ssh_session`：SSH 连接、终端通道、输入输出、尺寸同步。
- `sftp_session`：SFTP 目录读取、文件操作、传输任务。
- `event_bus`：后端事件推送到前端。
- `ai_client`：AI 提供方 请求、响应流、错误处理。
- `settings_store`：读取、写入、校验 `settings.json` 和 `keymap.json`。
- `runtime_store`：SQLite 运行态缓存、历史记录和非关键索引。

## 数据流

SSH 终端数据流：

1. 用户点击连接并打开终端。
2. 前端请求 Rust 后端创建 SSH 会话。
3. Rust 后端读取连接配置和必要凭据。
4. Rust 后端建立 SSH 连接和远程 shell 通道。
5. 前端输入通过 Tauri 命令发送给后端。
6. 后端读取远程输出，通过事件推送给前端。
7. 前端把输出写入 xterm.js。

SFTP 数据流：

1. 用户打开 SFTP 标签。
2. 前端请求后端创建或复用 SSH/SFTP 会话。
3. 后端读取目录或执行文件操作。
4. 后端返回目录条目、任务状态或错误。
5. 前端更新文件列表和传输队列。

AI 数据流：

1. 用户在 AI 面板输入问题。
2. 前端附带当前上下文，例如连接名、当前目录、用户选中文本。
3. 后端读取 AI 配置和 API 密钥。
4. 后端调用 AI 提供方。
5. 后端返回文本结果。
6. 前端展示结果，不自动执行。

设置数据流：

1. 用户在设置面板修改配置，或直接编辑 `settings.json`。
2. 前端把配置提交给后端。
3. 后端执行 结构校验 校验和敏感字段检查。
4. 校验通过后写入 JSON 文件。
5. 前端刷新工作台配置。

## 性能目标

- 应用冷启动要快，避免 Electron 级别的常驻内存开销。
- 10 个 SSH 终端同时连接时，UI 不明显卡顿。
- 同时运行 3 个 SFTP 传输任务时，终端输入不被阻塞。
- 单个连接卡住或断开时，不影响其他会话。
- 单个 SFTP 任务失败不会影响其他会话。
- AI 请求阻塞或失败时，不影响终端输入和文件操作。

实现要求：

- SSH/SFTP 操作运行在 Rust 后端。
- 阻塞操作使用隔离任务，避免阻塞 UI。
- 终端输出需要批量转发，不按字符逐个推送。
- SFTP 上传下载任务支持取消。
- 会话关闭时必须释放 SSH 通道、SFTP 句柄和任务。

## 错误处理

SSH 错误：

- 主机不可达。
- 认证失败。
- 私钥口令错误。
- 连接中断。
- 远程 shell 无法启动。

SFTP 错误：

- 权限不足。
- 路径不存在。
- 文件已存在。
- 传输中断。
- 磁盘空间不足。

AI 错误：

- API 密钥 缺失。
- 提供方 不可达。
- 模型不可用。
- 请求超时。
- 返回格式异常。

设置错误：

- JSON 语法错误。
- 结构校验 校验失败。
- 未知 提供方。
- 字体或主题值非法。
- 连接配置缺少必要字段。
- 敏感字段误写入 `settings.json`。

## 安全要求

- 敏感凭据不明文写入 SQLite 或普通 JSON 文件。
- 前端不保存密码、私钥口令、AI API 密钥。
- `settings.json` 只保存敏感凭据引用，不保存敏感值。
- 设置保存时需要检测明显敏感字段，阻止把密码、API 密钥、私钥内容写入配置文件。
- AI 默认只生成建议，不自动执行。
- SFTP 不做 sudo 写入。
- 终端内 sudo 由用户直接交互完成。
- 日志不得记录密码、私钥内容、私钥口令、API 密钥。

## 后续路线

第二阶段建议：

- 数据库连接管理：MySQL、PostgreSQL。
- Redis 管理。
- 跳板机。
- SSH agent。
- SSH tunnel。
- 传输队列增强。
- Docker 管理。
- 更完整的快捷键和命令面板。

AI SQL 助手的安全原则沿用第一版：AI 可以生成 SQL，但默认不自动执行。涉及 UPDATE、DELETE、DROP、TRUNCATE、ALTER 等高风险 SQL 时，需要额外确认。

## 验收标准

- 能在 Windows、macOS、Linux 上构建桌面应用。
- 启动速度快于常规 Electron 工具。
- 能通过 设置面板修改字体、主题、布局和 AI 提供方。
- 能直接编辑 `settings.json` 并在保存时校验。
- 能复制 `settings.json` 和 `keymap.json` 恢复非敏感工作环境。
- BYOK API 密钥 和 SSH 密码不明文进入配置文件。
- 能用密码、私钥、带口令私钥连接 SSH。
- 能在终端中正常处理 sudo 交互。
- 能通过 SFTP 浏览目录、上传、下载、删除、重命名和新建目录。
- AI 能根据上下文生成解释和命令，但不会自动执行。
- 多 SSH 标签和 SFTP 任务并发时 UI 不明显卡顿。
