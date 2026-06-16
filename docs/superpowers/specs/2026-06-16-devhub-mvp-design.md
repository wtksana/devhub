# DevHub MVP 设计文档

## 背景

DevHub 是一个跨平台一站式开发运维桌面工具。长期目标类似 HexHub，覆盖 SSH、SFTP、数据库、Redis、Docker、AI 辅助等开发运维场景。

第一版不追求完整平台形态，先聚焦服务器连接体验：SSH 终端、SFTP 文件管理、连接管理和 AI 辅助面板。这样可以优先打磨长连接、流控、安全凭据、终端体验和文件传输这些底层能力，为后续数据库、Redis、隧道和更多 AI 场景打基础。

## 已确认范围

### 第一版包含

- 跨平台桌面应用。
- SSH 终端。
- SFTP 文件管理。
- 连接管理。
- Settings 面板和可编辑的 `settings.json`。
- 字体、主题、快捷键、布局配置。
- 连接配置可通过复制配置文件迁移。
- 密码登录。
- 私钥登录。
- 带 passphrase 的私钥。
- 终端内 sudo 场景。
- AI 面板：BYOK 配置，生成命令、脚本、解释说明，但默认不自动执行。

### 第一版不包含

- 跳板机。
- SSH agent。
- SSH 隧道。
- SFTP sudo 写入。
- 数据库正式管理。
- Redis 正式管理。
- Docker / Kubernetes。
- AI Agent 自动执行多步任务。

## 技术选型

推荐技术栈：

- 桌面框架：Tauri 2。
- 后端核心：Rust。
- 异步运行时：Tokio。
- 前端：TypeScript + React 或 Vue。
- SSH 终端 UI：xterm.js。
- SFTP 和 SSH 连接：Rust 后端统一管理。
- 用户配置：JSON 文件，提供 `settings.json` 编辑能力。
- 运行态缓存和历史记录：SQLite。
- 密码、私钥 passphrase、AI API Key：系统凭据存储。

选择 Tauri + Rust 的原因：

- Tauri 使用系统 WebView，启动速度和安装包体积通常优于 Electron。
- Rust 适合管理 SSH/SFTP 长连接、并发任务、流控、取消、资源回收和敏感凭据。
- 前端 Web 生态适合实现终端、文件列表、AI 面板和复杂交互。
- 连接能力集中在 Rust 后端，避免把长连接和密钥逻辑放进前端渲染进程。

备选方案：

- Wails + Go：网络并发开发效率高，但桌面生态、Tauri 插件生态和精细资源控制略弱。
- Electron + Node.js：开发快，但启动速度、内存占用和长时间多连接稳定性与目标冲突，不作为首选。

## 产品结构

### 主界面

主界面由三部分组成：

- 左侧连接导航：分组、服务器列表、最近连接、连接状态。
- 中央工作区：SSH 终端标签页和 SFTP 文件标签页。
- 右侧 AI 面板：根据用户授权的上下文生成解释、命令或脚本。

### Settings 面板

Settings 面板参考 Zed 的配置体验，提供图形化设置入口，同时允许用户直接编辑 `settings.json`。Zed 支持通过设置窗口或 `settings.json` 修改配置，也支持独立的 `keymap.json` 管理快捷键；DevHub 第一版采用相同方向：图形界面适合常见配置，JSON 文件适合迁移、备份和 AI 辅助修改。

Settings 面板包含：

- 通用设置：语言、启动行为、更新提示。
- 外观设置：主题、UI 字体、终端字体、字号、行高。
- 布局设置：连接列表宽度、AI 面板位置、默认打开面板、标签行为。
- 快捷键设置：打开终端、打开 SFTP、切换标签、打开 AI 面板、复制粘贴等。
- 连接设置：服务器分组、主机、端口、用户名、认证方式、私钥路径或引用。
- AI 设置：BYOK Provider、base URL、默认模型、温度、上下文发送策略。

第一版至少提供：

- Settings 图形面板。
- 打开 `settings.json` 的入口。
- 保存后校验 JSON schema。
- 配置错误定位到字段。
- 配置变更后对可热更新项目立即生效，例如主题、字体和布局。
- 对需要重连或重启的配置给出明确提示。

### 配置文件设计

配置以可复制的 JSON 文件为主，目标是新安装后复制配置文件即可恢复大部分工作环境。

建议配置文件：

- `settings.json`：主配置，包含 UI、布局、AI 非敏感参数、连接非敏感参数。
- `keymap.json`：快捷键配置，便于后续独立管理快捷键冲突和上下文。

平台路径：

- Windows：`%APPDATA%\DevHub\settings.json` 和 `%APPDATA%\DevHub\keymap.json`。
- macOS：`~/Library/Application Support/DevHub/settings.json` 和 `~/Library/Application Support/DevHub/keymap.json`。
- Linux：`~/.config/devhub/settings.json` 和 `~/.config/devhub/keymap.json`。

`settings.json` 可以保存：

- 外观和布局。
- 连接分组和连接条目。
- 私钥文件路径。
- AI Provider、base URL、模型名。
- 凭据引用 ID。

`settings.json` 不保存：

- 登录密码。
- 私钥 passphrase。
- AI API Key。
- 私钥内容。

示例结构：

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

复制配置文件可以恢复界面、连接条目、AI Provider 和模型配置。敏感凭据需要用户在新机器上重新录入，或后续通过受密码保护的加密导入导出功能迁移；该加密迁移不进入第一版。

### 连接管理

连接配置保存非敏感信息：

- 连接名称。
- 分组。
- 主机地址。
- 端口。
- 用户名。
- 认证方式。
- 私钥路径或私钥引用。
- 默认打开方式。
- 最近连接时间。
- 凭据引用 ID。

敏感信息不明文写入普通配置文件：

- 登录密码。
- 私钥 passphrase。
- AI API Key。

这些信息应保存到系统凭据存储。Windows 使用 Credential Manager，macOS 使用 Keychain，Linux 使用 Secret Service 或兼容实现。

### SSH 终端

SSH 终端能力：

- 密码登录。
- 私钥登录。
- 私钥 passphrase。
- 多终端标签。
- 终端输入输出流。
- 终端窗口尺寸同步。
- 连接中、已连接、断开、失败状态。
- 手动断开。
- 基础重连入口。
- 复制、粘贴。
- 终端主题。

sudo 场景只在终端内支持。用户在远程终端里按服务器交互正常输入 sudo 密码。第一版不做 SFTP 提权写文件。

### SFTP 文件管理

SFTP 能力：

- 目录浏览。
- 返回上级目录。
- 文件上传。
- 文件下载。
- 删除。
- 重命名。
- 新建目录。
- 文件大小、修改时间、权限展示。
- 传输进度。
- 传输取消。
- 失败提示。

SFTP 使用当前 SSH 登录用户权限。不做 sudo 写入。如果用户没有权限写入目录，界面展示失败原因，不自动尝试提权。

### AI 面板

第一版 AI 权限级别为“生成但不执行”。

AI 使用 BYOK 模式。用户在 Settings 面板中配置 Provider、base URL、模型和 API Key。API Key 写入系统凭据存储，`settings.json` 只保存 `api_key_ref`。

AI 可以：

- 解释终端输出。
- 解释错误日志。
- 根据用户输入生成 shell 命令。
- 根据用户输入生成脚本片段。
- 根据用户选中的终端文本生成排查建议。
- 根据用户选中的远程文件片段解释配置含义。

AI 不可以：

- 自动执行命令。
- 自动修改远程文件。
- 自动上传文件。
- 自动删除文件。
- 自动读取未授权的终端缓冲区或文件内容。
- 自动发送密码、私钥、passphrase、API Key。

发送给 AI 的上下文必须由用户明确触发，例如：

- 选中终端文本后点击“解释”。
- 选中文件片段后点击“分析”。
- 在 AI 面板手动输入问题。

AI 生成命令后，只能显示在面板内。用户需要手动复制，或通过明确按钮把命令填入终端输入区；填入后仍由用户按回车执行。

## 架构设计

### 前端模块

- `ConnectionList`：连接分组、服务器列表、状态展示。
- `TerminalWorkspace`：终端标签、xterm.js 实例、终端快捷操作。
- `SftpWorkspace`：远程目录、文件操作、传输任务列表。
- `AiPanel`：聊天、上下文选择、AI 结果展示。
- `SettingsPanel`：图形化设置。
- `SettingsJsonEditor`：编辑 `settings.json`，展示校验错误。
- `KeymapEditor`：快捷键配置和冲突提示。

前端不直接持有敏感凭据，不直接连接 SSH/SFTP。前端通过 Tauri 命令和事件订阅与 Rust 后端通信。

### Rust 后端模块

- `connection_manager`：连接配置、会话生命周期、状态管理。
- `credential_store`：系统凭据存储读写。
- `ssh_session`：SSH 连接、终端通道、输入输出、尺寸同步。
- `sftp_session`：SFTP 目录读取、文件操作、传输任务。
- `event_bus`：后端事件推送到前端。
- `ai_client`：AI Provider 请求、响应流、错误处理。
- `settings_store`：读取、写入、校验 `settings.json` 和 `keymap.json`。
- `runtime_store`：SQLite 运行态缓存、历史记录和非关键索引。

### 数据流

SSH 终端数据流：

1. 用户点击连接。
2. 前端请求 Rust 后端创建 SSH 会话。
3. Rust 后端读取连接配置和必要凭据。
4. Rust 后端建立 SSH 连接和远程 shell 通道。
5. 前端输入通过命令发送到后端。
6. 后端把远程输出按批次推送到前端。
7. 前端把输出写入 xterm.js。

SFTP 数据流：

1. 用户打开 SFTP 标签。
2. 前端请求后端创建或复用 SSH/SFTP 会话。
3. 后端读取远程目录。
4. 前端展示文件列表。
5. 上传、下载、删除、重命名等操作由前端发起，后端执行。
6. 后端持续推送任务进度和结果。

AI 数据流：

1. 用户选择上下文或手动输入问题。
2. 前端展示将发送的上下文摘要。
3. 用户确认发送。
4. 后端调用 AI Provider。
5. AI 响应流式返回到前端面板。
6. 用户自行复制或填入命令，不自动执行。

Settings 数据流：

1. 用户在 Settings 面板修改配置，或直接编辑 `settings.json`。
2. 前端把配置草稿发送给后端校验。
3. 后端执行 schema 校验和敏感字段检查。
4. 校验通过后写入 JSON 文件。
5. 后端发布配置变更事件。
6. 前端热更新主题、字体、布局和快捷键。
7. 对连接认证方式等不能热更新的配置，界面提示需要重新连接。

## 性能设计

目标不是只在单连接下流畅，而是在多连接长期运行时仍可用。

第一版建议性能目标：

- 同时打开 20 个 SSH 终端标签，输入无明显卡顿。
- 同时运行 3 个 SFTP 传输任务，终端输入不被阻塞。
- 单个 SSH 连接大量输出时，其他标签切换仍保持流畅。
- 单个 SFTP 任务失败不会影响其他会话。
- 前端文件列表和传输列表使用虚拟滚动或分页，避免大量 DOM。

关键约束：

- SSH 输出必须分片和批量刷新。
- 后端到前端的事件通道使用有界队列，避免无限堆积。
- SFTP 上传下载任务支持取消。
- 会话关闭时必须释放 SSH 通道、SFTP 句柄和任务。
- AI 请求支持取消，取消后不继续向前端推送内容。

## 错误处理

连接错误：

- 主机不可达。
- 端口不可达。
- 用户名或密码错误。
- 私钥无效。
- passphrase 错误。
- 远端断开。

SFTP 错误：

- 权限不足。
- 文件不存在。
- 目标已存在。
- 网络中断。
- 本地磁盘写入失败。

AI 错误：

- API Key 缺失。
- Provider 不可达。
- 请求超时。
- 配额不足。
- 上下文过长。

Settings 错误：

- JSON 语法错误。
- 字段类型错误。
- 未知 Provider。
- 快捷键冲突。
- 连接 ID 重复。
- 凭据引用缺失。
- 敏感字段误写入 `settings.json`。

错误提示应解释“发生了什么”和“用户下一步可以做什么”，但不暴露密码、私钥路径细节或完整敏感请求内容。

## 安全设计

- 敏感凭据不明文写入 SQLite 或普通 JSON 文件。
- 前端不保存密码、passphrase、AI API Key。
- `settings.json` 只保存敏感凭据引用，不保存敏感值。
- Settings 保存时需要检测明显敏感字段，阻止把密码、API Key、私钥内容写入配置文件。
- AI 上下文默认最小化。
- AI 不自动执行命令。
- 危险操作，例如删除远程文件，需要用户明确确认。
- 日志不得记录密码、私钥内容、passphrase、API Key。
- 远程文件内容只有在用户明确选择时才可发送给 AI。

## 后续扩展路线

第二阶段可以考虑：

- SSH 隧道。
- 跳板机。
- SSH agent。
- 数据库连接和 SQL 编辑。
- Redis 管理。
- Docker 管理。
- AI SQL 助手。

AI SQL 助手的安全原则沿用第一版：AI 可以生成 SQL，但默认不自动执行。涉及 UPDATE、DELETE、DROP、TRUNCATE、ALTER 等高风险 SQL 时，需要额外确认。

## 验收标准

第一版完成时应满足：

- 能在 Windows、macOS、Linux 上构建桌面应用。
- 能保存连接配置，并通过密码或私钥连接服务器。
- 能通过 Settings 面板修改字体、主题、布局和 AI Provider。
- 能直接编辑 `settings.json` 并在保存时校验。
- 能复制 `settings.json` 和 `keymap.json` 恢复非敏感工作环境。
- BYOK API Key 和 SSH 密码不明文进入配置文件。
- 能打开多个 SSH 终端标签。
- 能在终端中正常处理 sudo 交互。
- 能通过 SFTP 浏览目录、上传、下载、删除、重命名和新建目录。
- 能在 AI 面板中基于用户手动提供的上下文生成说明、命令或脚本。
- AI 生成内容不会自动执行。
- 多 SSH 标签和 SFTP 任务并发时 UI 不明显卡顿。
- 敏感信息不明文存储。
