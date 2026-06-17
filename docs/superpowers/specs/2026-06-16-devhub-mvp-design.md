# DevHub MVP 设计文档

## 背景

DevHub 是一个跨平台一站式开发运维桌面工具。长期目标类似 HexHub，覆盖 SSH、SFTP、数据库、Redis、Docker 等开发运维场景。

第一版不追求完整平台形态，先聚焦服务器连接体验：SSH 终端、SFTP 文件管理、连接管理和可迁移设置。这样可以优先打磨长连接、流控、终端体验、文件传输和配置恢复这些底层能力，为后续数据库、Redis、隧道等能力打基础。

## MVP 范围

第一版包含：

- SSH 终端。
- SFTP 文件管理器基础能力。
- 连接管理。
- 设置面板和可编辑的 `settings.json`。
- 可复制迁移的 `settings.json` / `keymap.json`。
- 密码登录。
- 私钥登录。
- 带口令的私钥。
- 终端内 sudo 场景。

第一版不包含：

- 跳板机。
- SSH agent。
- SSH tunnel。
- SFTP sudo 写入。
- SFTP 压缩和解压缩。
- SFTP 上传文件夹。
- SFTP 拖拽上传。
- SFTP 远程编辑文件内容。
- 数据库正式管理。
- Redis 正式管理。
- Docker / Kubernetes。
- AI 相关功能。

## 技术选型

- 桌面框架：Tauri 2。
- 后端核心：Rust。
- 异步运行时：Tokio。
- 前端：TypeScript + React。
- SSH 终端 UI：xterm.js。
- SFTP 和 SSH 连接：Rust 后端统一管理。
- 文件选择和保存：Tauri 对话框与 Rust 后端文件流。
- 用户配置：JSON 文件，提供 `settings.json` 编辑能力。
- 运行态缓存和历史记录：SQLite。

选择 Tauri + Rust 的原因：

- Tauri 使用系统 WebView，启动速度和安装包体积通常优于 Electron。
- Rust 适合管理 SSH/SFTP 长连接、并发任务、流控、取消和资源回收。
- 前端可以使用成熟 Web 生态构建复杂面板和终端界面。
- 连接能力集中在 Rust 后端，避免把长连接逻辑放进前端渲染进程。

## 产品结构

第一版工作台由三个主要区域组成：

- 左侧连接面板：服务器连接、分组、快速打开。
- 中央工作区：SSH 终端标签页、SFTP 文件标签页和设置标签页。
- 底部状态栏：连接面板开关和后续任务状态入口。

前端整体体验参考 Zed，但不是复制 Zed 编辑器功能。第一版借鉴的是工作台结构、命令优先交互、紧凑面板、JSON 配置和键盘友好体验。

## 工作台设计

- 工作台采用左侧停靠面板、中央工作区、底部状态栏的结构。
- 连接面板可以折叠，宽度写入 `settings.json`。
- 使用命令入口打开常见操作，例如打开设置。
- 终端、SFTP、设置都以标签页形式进入工作区。
- 主题、字体、布局和快捷键都通过设置面板和 JSON 配置控制。

核心前端组件：

- `AppShell`：整体工作台骨架。
- `DockPanel`：左侧连接停靠面板。
- `WorkspaceTabs`：中央标签栏。
- `StatusBar`：连接面板开关和状态入口。
- `CommandPalette`：打开设置等基础命令入口。
- `ConnectionList`：连接分组、服务器列表和打开终端/SFTP 操作。
- `TerminalWorkspace`：终端标签、xterm.js 实例、终端输入输出。
- `SftpWorkspace`：远程文件管理器、目录导航、文件操作和传输任务列表。
- `SettingsPanel`：图形化设置。
- `SettingsJsonEditor`：编辑 `settings.json`，展示校验错误。
- `KeymapEditor`：快捷键配置占位。

## 设置面板

设置面板参考 Zed 的配置体验，提供图形化设置入口，同时允许用户直接编辑 `settings.json`。图形界面适合常见配置，JSON 文件适合迁移、备份和批量修改。

设置面板包含：

- 外观设置：主题、界面字体、界面字号、终端字体、终端字号。
- 布局设置：连接面板宽度。
- 连接设置：展示连接配置摘要，连接新增入口位于连接面板。
- 快捷键设置：保留 `keymap.json` 入口。

第一版必须支持：

- 设置图形面板。
- 打开 `settings.json` 的入口。
- 保存后校验 JSON 结构。
- 清晰展示配置错误。
- 新安装后复制配置文件即可恢复工作环境。

## 配置文件

配置以可复制的 JSON 文件为主，目标是新安装后复制配置文件即可恢复大部分工作环境。

配置文件：

- `settings.json`：主配置，包含 UI、布局和连接配置。
- `keymap.json`：快捷键配置，便于后续独立管理快捷键冲突和上下文。

默认位置：

- Windows：`%APPDATA%\DevHub\settings.json` 和 `%APPDATA%\DevHub\keymap.json`。
- macOS：`~/Library/Application Support/DevHub/settings.json` 和 `~/Library/Application Support/DevHub/keymap.json`。
- Linux：`~/.config/devhub/settings.json` 和 `~/.config/devhub/keymap.json`。

`settings.json` 可以保存：

- 主题、字体、字号。
- 连接面板宽度。
- 连接名称、分组、主机、端口、用户名、认证方式。
- SSH 密码。
- 私钥路径和私钥口令引用。

`settings.json` 不保存：

- 私钥内容。
- 不属于连接认证结构的散落敏感字段。

示例：

```json
{
  "appearance": {
    "theme": "dark",
    "ui_font_family": "Inter",
    "ui_font_size": 13,
    "terminal_font_family": "JetBrains Mono",
    "terminal_font_size": 14
  },
  "layout": {
    "connection_sidebar_width": 280
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
        "type": "password",
        "password": "plain-password"
      }
    }
  ]
}
```

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

SFTP 在第一版中按基础文件管理器实现，而不是只做目录列表。目标是让用户能在 SFTP 标签页完成常见远程文件操作，并且关闭标签时释放对应 SFTP 会话。

第一版必须支持：

- 打开 SFTP 标签时创建后端 SFTP 会话。
- 关闭 SFTP 标签时关闭后端 SFTP 会话。
- 浏览远程目录。
- 双击文件夹进入目录。
- 地址栏输入路径并跳转。
- 后退、前进、刷新。
- 上传文件。
- 下载文件。
- 新建目录。
- 新建空文件。
- 删除文件或目录。
- 重命名文件或目录。
- 复制远程路径到剪贴板。
- 右键菜单按空白处、文件夹、文件展示不同操作。
- 展示权限错误。
- 传输队列和基础任务状态。

第一版暂不支持：

- 压缩。
- 解压缩。
- 上传文件夹。
- 拖拽上传。
- 批量操作。
- 远程编辑文件内容。
- SFTP sudo 写入。

SFTP 使用当前 SSH 登录用户权限。不做 sudo 写入。如果用户没有权限写入目录，界面展示失败原因，不自动尝试提权。

SFTP 右键菜单：

- 空白处：上传文件、刷新、新建文件夹、新建文件。
- 文件夹：打开、下载、重命名、复制路径、删除。
- 文件：下载、重命名、复制路径、删除。

路径导航规则：

- 双击文件夹进入目录时，当前路径进入后退栈，前进栈清空。
- 点击后退时，当前路径进入前进栈，并切换到后退栈顶部路径。
- 点击前进时，当前路径进入后退栈，并切换到前进栈顶部路径。
- 地址栏直接跳转路径时，当前路径进入后退栈，前进栈清空。
- 刷新只重新读取当前路径，不改变后退和前进栈。

传输队列：

- 上传和下载都进入传输队列。
- 任务至少展示文件名、方向、状态、错误信息。
- 标签关闭时取消该 SFTP 标签关联的未完成任务，并关闭后端 SFTP 会话。

## Rust 后端模块

- `credential_store`：系统凭据存储读写，保留给私钥口令等后续凭据场景。
- `settings_store`：读取、写入、校验 `settings.json` 和 `keymap.json`。
- `ssh::client`：SSH 连接和认证 helper。
- `ssh::session_manager`：SSH 终端通道、输入输出、尺寸同步和会话生命周期。
- `ssh::sftp_manager`：SFTP 会话、目录读取、文件操作、上传下载和传输任务。
- `commands`：Tauri 命令边界。
- `models`：前后端命令使用的可序列化请求和响应模型。

## 数据流

SSH 终端数据流：

1. 用户点击连接并打开终端。
2. 前端请求 Rust 后端创建 SSH 会话。
3. Rust 后端读取连接配置。
4. Rust 后端建立 SSH 连接和远程 shell 通道。
5. 前端输入通过 Tauri 命令发送给后端。
6. 后端读取远程输出，通过事件推送给前端。
7. 前端把输出写入 xterm.js。

SFTP 数据流：

1. 用户打开 SFTP 标签。
2. 前端请求后端创建 SFTP 会话，获得 `sftp_session_id`。
3. 前端使用 `sftp_session_id` 请求列目录、上传、下载、新建、重命名或删除。
4. 后端复用 SFTP 会话执行操作，返回目录条目、任务状态或错误。
5. 前端更新当前路径、历史栈、文件列表和传输队列。
6. 用户关闭 SFTP 标签时，前端调用后端关闭 SFTP 会话，并取消该标签未完成任务。

设置数据流：

1. 用户在设置面板修改配置，或直接编辑 `settings.json`。
2. 前端把配置提交给后端。
3. 后端执行结构校验和敏感字段检查。
4. 校验通过后写入 JSON 文件。
5. 前端刷新工作台配置。

## 性能目标

- 应用冷启动要快，避免 Electron 级别的常驻内存开销。
- 10 个 SSH 终端同时连接时，UI 不明显卡顿。
- 同时运行 3 个 SFTP 传输任务时，终端输入不被阻塞。
- 单个连接卡住或断开时，不影响其他会话。
- 单个 SFTP 任务失败不会影响其他会话。
- 关闭 SFTP 标签后，后端会释放对应 SFTP 会话和未完成任务。

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
- 远程命令或路径不可用。
- 用户关闭标签导致任务取消。

设置错误：

- JSON 语法错误。
- 结构校验失败。
- 字体或主题值非法。
- 连接配置缺少必要字段。
- 敏感字段误写入 `settings.json`。

## 后续路线

第二阶段建议：

- 数据库连接管理：MySQL、PostgreSQL。
- Redis 管理。
- 跳板机。
- SSH agent。
- SSH tunnel。
- SFTP 压缩和解压缩。
- SFTP 上传文件夹和拖拽上传。
- Docker 管理。
- 更完整的快捷键和命令入口。

## 验收标准

- 能在 Windows、macOS、Linux 上构建桌面应用。
- 启动速度快于常规 Electron 工具。
- 能通过设置面板修改字体、主题和布局。
- 能直接编辑 `settings.json` 并在保存时校验。
- 能复制 `settings.json` 和 `keymap.json` 恢复工作环境。
- 能用密码、私钥、带口令私钥连接 SSH。
- 能在终端中正常处理 sudo 交互。
- 能通过 SFTP 浏览目录、进入文件夹、后退、前进、刷新、上传、下载、删除、重命名、新建目录、新建文件和复制路径。
- 关闭 SFTP 标签后能释放对应 SFTP 会话。
- 多 SSH 标签和 SFTP 任务并发时 UI 不明显卡顿。
