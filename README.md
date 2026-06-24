# DevHub

DevHub 是一个跨平台开发运维桌面工具。当前第一版聚焦服务器连接体验，提供 SSH 终端、SFTP 文件管理、连接管理和可迁移设置能力。项目使用 Tauri 2、Rust、React 和 TypeScript 构建，目标是在保持桌面体验的同时降低启动和运行开销。

## 当前状态

项目处于 MVP 阶段，核心 SSH 和 SFTP 能力已经进入可用状态。Redis 已支持连接配置、PING 测试、key 浏览、新建 key、key 内容查看、`string` 和集合类型编辑、TTL 管理、批量操作、删除和重命名等基础管理能力。数据库已支持 MySQL / PostgreSQL 直连、连接测试、对象树、SQL 查询、SQL 文件、危险 SQL 确认、结果表格和基础表数据编辑；工作区已支持多面板拆分、面板尺寸拖动和标签跨面板拖动。Docker、跳板机、SSH tunnel 和 AI 功能暂不在当前版本范围内。

当前已实现：

- SSH 远程终端和本地终端。
- 密码认证、私钥认证、私钥口令字段。
- 多终端标签和标签右键菜单。
- 终端复制、粘贴、清屏。
- 终端在检测到 `tail` 日志命令时支持当前激活标签内的日志高亮。
- SFTP 目录浏览、路径跳转、后退、前进、刷新。
- SFTP 上传、下载、文件夹上传、文件夹下载、拖拽上传。
- SFTP 新建文件、新建文件夹、重命名、删除、复制路径。
- SFTP 多选、批量下载、批量删除、批量复制路径、批量压缩。
- SFTP `.tar.gz` / `.tgz` 解压。
- SFTP 小于 5MB 的文本文件查看和编辑。
- SFTP 传输队列、进度显示、失败信息和取消传输。
- 连接分组、添加连接、编辑连接、复制连接、移动分组和排序菜单。
- Redis 连接配置保存、测试连接、key 浏览、新建 key、key 内容查看、`string` 和集合类型编辑、TTL 管理、批量操作、删除和重命名。
- MySQL / PostgreSQL 连接配置保存、测试连接、对象树、SQL 执行、SQL 文件、结果表格、双击表查询和基础表数据编辑。
- 工作区向右 / 向下拆分、多面板尺寸拖动、标签跨面板移动和同面板标签排序。
- Zed 风格的紧凑工作台、可滚动标签栏和主题切换。
- 简体中文 / English 界面语言切换。
- 图形化设置面板和 `settings.json` 双向编辑。
- 本地应用操作日志，便于排查连接、SFTP、Redis 和数据库问题。
- 窗口尺寸保存和恢复。

## 技术栈

- 桌面框架：Tauri 2
- 后端语言：Rust
- 前端框架：React + TypeScript + Vite
- 终端渲染：xterm.js
- 设置编辑：Monaco Editor
- 配置校验：Zod + Rust serde
- SSH / SFTP：Rust 后端基于 `ssh2` / libssh2 管理
- Redis：Rust 后端基于 `redis-rs` 测试连接、扫描 key 和读取 key 内容
- 本地终端：`portable-pty`
- 本地数据库：`rusqlite`
- 剪贴板和文件选择：Tauri 插件

## 功能说明

### 工作台

DevHub 使用左侧连接面板、中间工作区和底部状态栏的布局。终端、SFTP、Redis、数据库和设置页都以工作区标签打开。标签栏支持横向滚动，标签标题完整展示，不压缩标签宽度。

工作区支持多面板布局。标签右键可以向右或向下拆分当前面板，拆分时默认复制当前标签为新的独立标签实例；面板之间的分割线可以拖动调整当前会话内的尺寸；标签可以在同一面板内拖动排序，也可以拖到其他面板标签栏中移动。新连接默认打开到当前聚焦面板，面板内所有标签关闭后会自动关闭空面板。

### 连接管理

连接面板支持：

- 默认本地终端。
- 添加、编辑和复制 SSH 连接。
- 添加、编辑和复制 Redis 连接。
- 添加、编辑和复制 MySQL / PostgreSQL 连接。
- 连接分组。
- 输入新分组或选择已有分组。
- 通过右键菜单移动连接到指定分组。
- 在连接面板空白区域添加连接、添加分组、排序分组和排序连接。
- 双击 SSH 连接直接打开终端。
- 通过 SSH 连接右键菜单打开终端新标签或 SFTP 标签。
- 双击 Redis 连接会打开 Redis 工作区标签；Redis 连接右键菜单提供测试连接。
- 双击 MySQL / PostgreSQL 连接会打开数据库工作区标签；数据库连接右键菜单提供测试连接。

当前产品约定下，SSH 密码、私钥口令、Redis 密码和数据库密码会直接保存到 `settings.json`，便于复制配置恢复工作环境。私钥内容不会写入配置，只保存私钥路径。

### SSH 终端

SSH 终端由 Rust 后端管理连接和 I/O，前端使用 xterm.js 渲染。关闭终端标签时会关闭对应后端会话。终端右键菜单支持复制、粘贴和清屏，剪贴板操作使用 Tauri 插件，避免 WebView 的浏览器剪贴板权限弹窗。终端会保留原始控制序列，兼容 `vim` 等全屏 TUI 程序。

终端支持日志高亮模式。默认会在当前激活标签输入 `tail -f`、`tail -F` 或 `tailf` 命令后，对该标签之后的新输出按配置规则高亮，逐字输入命令也能检测。为了减少性能开销，非激活终端标签不会执行正则高亮；进入 `vim` 等 alternate screen 的输出也不会处理。已有 ANSI 颜色的日志行会保持原样，只对无颜色的普通文本行补充颜色。终端右键菜单也可以手动开启或关闭当前标签的日志高亮模式。

### SFTP 文件管理

SFTP 标签打开后会创建独立后端 SFTP 会话，所有目录和文件操作复用该会话。关闭 SFTP 标签时会取消仍在运行的传输任务，并关闭对应 SFTP 会话。

当前支持：

- 浏览目录和双击进入文件夹。
- 地址栏输入远程路径。
- `~` / `~/` 跳转到远端 home 目录。
- 后退、前进和刷新。
- 文件列表按名称、大小和修改时间排序。
- 修改时间显示为 `yyyy-MM-dd HH:mm:ss`。
- 文件大小按设置显示为字节或自动单位。
- 上传文件、下载文件。
- 上传文件夹、下载文件夹。
- 拖拽上传本地文件或文件夹。
- 新建文件、新建文件夹。
- 重命名、删除、复制路径。
- 压缩文件或目录。
- 解压 `.tar.gz` / `.tgz`。
- 多选后批量下载、删除、复制路径和压缩到同一个包。
- 打开和编辑小于 5MB 的文本类远程文件。
- 传输进度、失败信息和取消传输。

SFTP 使用当前 SSH 登录用户权限，不做 sudo 提权写入。没有权限时会展示错误。

### Redis 连接

Redis 当前实现第一批基础能力：

- 在添加连接弹窗中选择 Redis 类型。
- 配置名称、分组、主机、端口、数据库编号和密码。
- Redis 密码按当前产品约定直接保存到 `settings.json`。
- 右键选择测试连接时，由 Rust 后端连接 Redis 并执行 `PING`。
- 双击 Redis 连接打开 Redis 工作区标签。
- Redis 工作区支持选择数据库编号、输入关键字模糊匹配并刷新扫描。
- Redis 工作区支持设置 key 分隔符，默认 `:`，已加载 key 会按分隔符展示为目录树。
- Redis 工作区显示当前 DB 的 key 总数，以及本次已加载数量；一次加载数量默认 5000，可在工具栏修改。
- key 列表显示 key 名称、类型和 TTL。
- 双击 key 会打开详情弹窗。
- key 详情支持查看 `string`、`hash`、`list`、`set` 和 `zset`。
- `string` 内容默认最多读取 5MB，集合类默认最多读取 500 条，避免大 key 阻塞界面。
- 支持新建 `string`、`hash`、`list`、`set` 和 `zset` 类型 key，新建时不会覆盖已有 key。
- key 详情弹窗支持按 ESC 关闭。
- `string` 类型支持在详情弹窗中编辑并保存内容。
- `hash` 支持新增字段、编辑字段值和删除字段。
- `list` 支持编辑指定下标元素、尾部追加元素和删除指定下标元素。
- `set` 支持新增成员和删除成员。
- `zset` 支持新增成员、编辑成员分数和删除成员。
- key 详情支持设置 TTL、移除 TTL、重命名和删除 key，删除前会二次确认。
- key 列表行右键菜单支持编辑、重命名和删除，删除前会二次确认。
- key 列表支持多选，也支持按目录选择已加载 key；右键菜单支持批量删除、批量设置 TTL 和批量移除 TTL；批量删除前会二次确认。
- key 重命名使用 Redis `RENAMENX`，目标 key 已存在时不会覆盖。
- Rust 后端使用 `DBSIZE` 获取总数，使用 `SCAN` 分段扫描 key，并通过 pipeline 批量读取类型和 TTL。
- Redis 命令复用 Rust 后端连接管理器中的连接；失败时会移除旧连接并在下次操作重新连接。
- Redis key 列表使用虚拟滚动渲染，并缓存选中集合和目录到 key 的映射，减少大量 key 场景下的界面开销。

暂不支持 Redis 发布订阅或监控面板。

### 数据库管理

数据库 A 版面向日常开发运维查询场景，当前支持 MySQL 和 PostgreSQL 直连。

当前支持：

- 在添加连接弹窗中选择 MySQL 或 PostgreSQL 类型。
- 配置名称、分组、主机、端口、用户名、密码和默认数据库。
- 数据库密码按当前产品约定直接保存到 `settings.json`。
- 在添加连接弹窗或连接右键菜单中测试连接。
- 双击数据库连接打开数据库工作区标签。
- 左侧对象树按需加载 database / schema、表、视图和字段。
- 右侧 Monaco SQL 编辑器执行选中 SQL，默认 SELECT 自动追加 `LIMIT 200`。
- 每个连接和数据库维护独立 SQL 文件，默认 SQL 文件名为 `default`。
- SQL 文件内容保存到本地 SQLite，不写入 `settings.json`。
- SQL 编辑器支持收起，便于把更多空间留给查询结果。
- 查询结果表格显示列名、数据类型、NULL、布尔值、耗时和影响行数，并复用表数据网格的显示、选择和复制体验。
- `INSERT`、`UPDATE`、`DELETE`、`DROP`、`TRUNCATE`、`ALTER`、`CREATE`、`REPLACE`、`GRANT`、`REVOKE` 等危险 SQL 执行前会弹出项目内确认框。
- 双击表或视图会打开表数据浏览模式，支持分页、单列排序和简单 SQL 条件筛选，不会覆盖当前 SQL 文件内容。
- 有主键的普通表支持双击单元格编辑已有行、新增行、删除行、键盘导航、拖选复制和从 Excel / DataGrip 等工具粘贴 TSV 表格数据；保存前二次确认，保存成功后刷新当前页。
- SQL 自由查询结果保持只读；需要编辑数据时通过双击表进入表数据浏览模式。
- 表数据粘贴只写入当前已加载范围内的可编辑单元格，不自动新增行，不覆盖主键和只读列，不越界写入；无主键表和视图保持只读。
- MySQL 查询结果会按列类型优先解析数值，避免 `count(1)` 等 `BIGINT` 结果显示为布尔值。

当前不支持建表改表、导入导出、执行计划、SSH tunnel 和 SSL 证书配置。

### 设置

设置支持图形化编辑和 `settings.json` 直接编辑。配置目标是可迁移：复制 `settings.json` 和 `keymap.json` 后，可以快速恢复主题、字体、布局、连接和分组等环境。

常见设置包括：

- 主题。
- 界面语言，支持跟随系统、简体中文和 English。
- 界面字体和字号。
- 终端字体和字号。
- 终端日志高亮的 tail 自动检测、右键手动切换、大小写匹配和正则颜色规则列表。
- 连接面板宽度。
- 文件大小显示方式。
- 连接配置。
- 操作日志开关、日志级别、保留天数和是否记录完整 SQL。
- 数据库 SQL 文件保存在本地 SQLite，不写入 `settings.json`。
- 空分组列表。

### 操作日志

DevHub 会把关键操作写入本地日志目录，便于排查连接、SFTP、Redis 和数据库问题。日志默认开启，按天写入 `<app_config_dir>/logs/devhub-YYYY-MM-DD.log`，格式为 JSON Lines。设置页可以打开日志目录或复制日志目录路径。

默认配置如下：

```json
"logging": {
  "enabled": true,
  "level": "info",
  "retention_days": 14,
  "include_sql": false
}
```

日志覆盖 Redis key 查看、编辑、新增、删除、TTL 和批量操作，SFTP 目录、文件、压缩、解压和传输操作，数据库对象树、DDL、SQL 文件、SQL 执行和表数据增删改，以及前端关键错误。默认不记录完整 SQL；只有开启 `logging.include_sql` 后，数据库查询日志才会包含完整 SQL。

日志写入前会统一对密码、口令、token、authorization、URL 密码片段和超长字段做脱敏或截断。日志写入失败不会影响原业务操作。

## 配置文件位置

配置文件由 Tauri 应用数据目录管理。

- Windows：`%APPDATA%\DevHub\settings.json`
- macOS：`~/Library/Application Support/DevHub/settings.json`
- Linux：`~/.config/devhub/settings.json`

快捷键配置文件为同目录下的 `keymap.json`。

## 开发环境

需要安装：

- Node.js
- pnpm
- Rust
- Tauri 2 所需系统依赖

安装依赖：

```powershell
pnpm install
```

启动开发环境：

```powershell
pnpm tauri dev
```

前端开发服务器：

```powershell
pnpm dev
```

构建前端：

```powershell
pnpm build
```

构建桌面应用：

```powershell
pnpm tauri build
```

## 验证

常用验证命令：

```powershell
pnpm test
pnpm build
pnpm test:rust
cargo fmt --manifest-path src-tauri\Cargo.toml --check
cargo clippy --manifest-path src-tauri\Cargo.toml --all-targets -- -D warnings
```

手动验收清单见：

- `docs/testing/manual-mvp-checklist.md`

## 项目结构

```text
src/
  app/                 # 工作台骨架、标签栏、右键菜单
  features/            # 设置、连接、终端、SFTP 等前端功能模块
  lib/                 # 前端 Tauri 调用封装和工具函数
  styles/              # 全局样式
src-tauri/
  src/
    commands/          # Tauri 命令边界
    core/              # 设置存储、凭据存储等通用后端能力
    models/            # 前后端共享请求/响应模型
    ssh/               # SSH、终端、SFTP 会话和传输管理
docs/
  superpowers/         # 设计文档和实施计划
  testing/             # 手动验收清单
```

## 路线图

后续优先级建议：

1. 数据库后续能力：建表改表、导入导出、执行计划、SSH tunnel 和 SSL 证书配置。
2. Redis 发布订阅和监控面板。
3. SSH tunnel。
4. 跳板机。
5. SSH agent。
6. Docker 管理。
7. 更完整的快捷键和命令入口。

AI 功能已从当前产品范围移除，后续是否重新引入需要重新设计。

## 安全说明

当前为了方便复制配置恢复环境，SSH 密码、私钥口令、Redis 密码和数据库密码按产品约定直接保存在 `settings.json` 中。请不要把包含真实密码、私钥口令或生产连接信息的配置文件提交到公共仓库。

私钥内容不会写入 `settings.json`，只保存私钥路径。

## 许可证

本项目代码使用 MIT License，详见 `LICENSE`。

项目名称、图标、Logo 和其他品牌资产不因代码许可证自动授权。第三方图标和依赖遵循其各自许可证。
