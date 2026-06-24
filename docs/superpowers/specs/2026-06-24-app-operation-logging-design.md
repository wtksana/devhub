# 应用操作日志设计

## 背景

DevHub 现在已经覆盖 SSH、SFTP、Redis 和数据库等长连接操作，但缺少统一日志记录。出现连接失败、文件传输失败、数据库执行异常或前端调用错误时，只能依赖界面提示或开发者控制台，不利于用户复现问题和开发排查。

第一版日志目标是提供可落地的本地诊断能力：记录关键操作、结果、耗时和错误原因，同时避免把密码、私钥口令、完整 SQL 等敏感信息写入日志。

## 目标

- 后端统一写本地日志文件。
- 记录关键操作的开始、成功、失败和取消结果。
- 记录错误信息、耗时、连接 id、模块和动作。
- 支持前端通过 Tauri command 写入关键前端错误日志。
- 支持打开日志目录，便于用户发日志排查问题。
- 日志设置写入 `settings.json`，支持开关、级别、保留天数和是否记录完整 SQL。
- 默认不记录完整 SQL，不记录密码、私钥口令、Redis 密码和数据库密码。

## 不做范围

- 不做完整日志查看器。
- 不做日志搜索、筛选和导出面板。
- 不做远程日志上传。
- 不做日志压缩。
- 不记录终端原始输出内容。
- 不记录 SFTP 传输文件内容。
- 不默认记录完整 SQL 文本。

## 日志位置

日志目录放在 Tauri 应用配置目录下：

```text
<app_config_dir>/logs/
```

Windows 示例：

```text
C:\Users\<user>\AppData\Roaming\DevHub\logs\
```

日志文件按天滚动：

```text
devhub-2026-06-24.log
```

## 日志格式

第一版使用 JSON Lines，每行一条日志，方便人工阅读和后续工具解析。

```json
{"ts":"2026-06-24T12:00:00+08:00","level":"info","module":"sftp","action":"list_directory","target":"prod-web-01:/var/log","result":"success","duration_ms":32}
```

字段：

- `ts`：本地时间 RFC3339 字符串。
- `level`：`debug` / `info` / `warn` / `error`。
- `module`：`app` / `settings` / `terminal` / `sftp` / `redis` / `database` / `frontend`。
- `action`：动作名，例如 `open_terminal`、`list_directory`、`execute_query`。
- `target`：操作目标，允许为空。连接场景记录连接 id，SFTP 可记录连接 id 和远程路径，数据库可记录连接 id 和库表名。
- `result`：`start` / `success` / `failed` / `canceled`。
- `duration_ms`：可选，操作耗时。
- `message`：可选，简短说明。
- `error`：可选，失败原因。
- `metadata`：可选，结构化补充信息。

## 设置项

新增：

```json
"logging": {
  "enabled": true,
  "level": "info",
  "retention_days": 14,
  "include_sql": false
}
```

默认值：

- `enabled`: `true`
- `level`: `info`
- `retention_days`: `14`
- `include_sql`: `false`

`include_sql = false` 时，数据库日志只记录 SQL 类型、耗时、影响行数、错误信息和是否危险 SQL；不记录完整 SQL 文本。后续如果用户手动开启完整 SQL 记录，需要在设置说明中提示可能包含敏感业务数据。

## 脱敏规则

日志写入前必须避免记录：

- SSH 密码。
- 私钥口令。
- Redis 密码。
- 数据库密码。
- 私钥文件内容。

连接配置日志只记录：

- 连接 id。
- 连接类型。
- 连接名称。
- 主机和端口。
- 用户名。
- 数据库编号或默认库名。

SQL 日志默认不记录完整 SQL。错误信息原样记录，但不主动拼接连接密码等敏感字段。

## 后端架构

新增 `core::app_logger`：

- 负责创建日志目录。
- 负责按天追加日志文件。
- 负责 JSON Lines 序列化。
- 负责根据 `LoggingSettings` 过滤日志级别。
- 负责保留天数清理旧日志。

新增 Tauri command：

- `write_app_log(entry)`：前端写入关键错误或操作日志。
- `open_log_directory()`：打开日志目录。
- `get_log_directory()`：返回日志目录字符串，便于复制路径。

后端命令中优先覆盖：

- 设置：`load_settings`、`save_settings`。
- 终端：`open_terminal`、`close_terminal`。
- SFTP：打开/关闭 session、列目录、上传、下载、删除、重命名、新建、压缩、解压、读写文本文件、取消传输。
- Redis：测试连接、扫描 key、读取 key、创建、编辑、删除、重命名、TTL 和批量操作。
- 数据库：测试连接、加载对象树、执行 SQL、打开表数据、保存表格修改、新增行、删除行、DDL。

第一轮实现可以先完成日志基础设施和每个模块的关键入口；后续再补齐细粒度动作。

## 前端入口

设置页增加日志区域：

- 日志开关。
- 日志级别。
- 保留天数。
- 是否记录完整 SQL。
- 打开日志目录按钮。
- 复制日志目录路径按钮。

前端调用 Tauri command 失败时，当前第一版只在关键路径手动写日志，不全局 monkey patch `callBackend`，避免把所有调用都重复记录一遍。

## 测试策略

Rust 测试：

- 默认日志设置序列化和反序列化。
- 日志级别过滤。
- 写入 JSON Lines 文件。
- 按日期生成日志文件名。
- 清理超过保留天数的旧日志。
- 日志条目不包含敏感字段。

前端测试：

- 设置 schema 接受 logging 配置并补默认值。
- 设置页可以修改 logging 配置。
- 设置页点击打开日志目录会调用后端命令。
- 设置页复制日志路径会调用后端命令和剪贴板。

## 验收标准

- 启动应用后能在日志目录看到当天日志文件。
- 执行 SSH/SFTP/Redis/数据库关键操作后能看到对应日志。
- 操作失败时日志包含 `result = failed` 和错误信息。
- 日志中不出现保存的密码或私钥口令。
- 设置页可以关闭日志、修改级别和打开日志目录。
