# 应用操作日志补全设计

## 背景

DevHub 已经完成应用操作日志第一版：后端有 `core::app_logger`，日志按天写入应用配置目录下的 JSON Lines 文件；设置页支持日志开关、级别、保留天数、是否记录完整 SQL，并提供打开日志目录和复制日志路径入口。

第一版的问题是覆盖面还不够完整。当前主要记录设置保存、终端打开/关闭、SFTP session 和部分传输、Redis 测试连接和 key 扫描、数据库测试连接、SQL 执行和表数据加载。实际排查问题时，还需要看到更多写操作、前端调用错误和结构化上下文。

这一轮目标是补全日志记录能力，而不是做日志查看器。

## 目标

- 补齐 Redis、SFTP、数据库和连接配置的关键操作日志。
- 记录前端关键路径错误，尤其是后端调用失败但后端没有机会写日志的场景。
- 所有日志写入统一经过脱敏和长度截断，避免泄露密码、口令、私钥内容、过长文本和默认完整 SQL。
- 日志继续使用现有 JSON Lines 文件，不新增日志数据库。
- 日志失败不能影响业务操作。

## 不做范围

- 不做日志查看器、搜索、过滤和导出界面。
- 不做远程上传日志。
- 不记录终端原始输出。
- 不记录 SFTP 文件内容。
- 不默认记录完整 SQL。
- 不把日志写入 SQLite。

## 日志覆盖范围

### Redis

补齐以下 Tauri command：

- `get_redis_key_value`
- `set_redis_string_value`
- `set_redis_hash_field`
- `delete_redis_hash_field`
- `set_redis_list_item`
- `append_redis_list_item`
- `delete_redis_list_item`
- `add_redis_set_member`
- `delete_redis_set_member`
- `set_redis_zset_member`
- `delete_redis_zset_member`
- `create_redis_key`
- `delete_redis_key`
- `delete_redis_keys`
- `set_redis_key_ttl`
- `set_redis_keys_ttl`
- `persist_redis_key`
- `persist_redis_keys`
- `rename_redis_key`

日志 target 使用：

```text
<connection_id>:db<database>:<key>
```

批量操作 target 使用：

```text
<connection_id>:db<database>:<count> keys
```

不记录 Redis value、hash field value、list item value、set member 值、zset member 值。key 名称允许记录，因为它是操作目标；如果后续用户认为 key 也敏感，再增加单独配置。

### SFTP

补齐以下 Tauri command：

- `close_sftp_session`
- `delete_sftp_path`
- `rename_sftp_path`
- `create_sftp_directory`
- `create_sftp_file`
- `compress_sftp_path`
- `compress_sftp_paths`
- `extract_sftp_archive`
- `read_sftp_text_file`
- `write_sftp_text_file`
- `upload_sftp_directory`
- `download_sftp_directory`
- 兼容旧入口：`list_directory`、`delete_path`、`rename_path`、`create_directory`

日志 target 使用：

```text
<session_id>:<remote_path>
```

批量压缩 target 使用：

```text
<session_id>:<count> paths -> <archive_name>
```

不记录本地文件内容、远程文件内容或文本编辑内容。上传/下载可以记录本地路径和远程路径中的路径字符串，但不记录文件内容。

### 数据库

补齐以下 Tauri command：

- `list_database_objects`
- `update_database_table_rows`
- `insert_database_table_rows`
- `delete_database_table_rows`
- `get_database_table_ddl`
- `list_database_sql_files`
- `save_database_sql_file`

日志 target 使用：

```text
<connection_id>:<database>:<table>
```

SQL 文件操作 target 使用：

```text
<connection_id>:<database>:<sql_file_name>
```

数据库表数据写操作记录行数和字段数等结构化 metadata，但不记录单元格值。`save_database_sql_file` 默认不记录 SQL 文件内容。

`execute_database_query` 保持现有规则：`logging.include_sql = false` 时不记录完整 SQL；为便于排查，可以记录 SQL 类型摘要，例如 `select`、`insert`、`update`、`delete`、`ddl`、`other`。

### 连接配置和前端配置操作

连接的新增、编辑、复制和删除目前主要在前端通过 `save_settings` 落库，后端只能看到完整 settings。为了补齐“用户操作层”的日志，在前端连接操作处调用 `write_app_log`：

- `connections.add`
- `connections.edit`
- `connections.copy`
- `connections.delete`
- `connections.move_group`
- `connections.test_config`

日志只记录连接类型、连接 id、连接名称、host、port、username、database/db 编号等非密码字段。不记录 `password`、`auth.password`、`auth.passphrase`。

## 前端错误日志

新增前端 helper：

```ts
logFrontendEvent(entry)
logFrontendError(module, action, error, target?)
```

内部调用 `write_app_log`。调用失败时静默吞掉，避免日志系统导致业务报错。

第一批接入：

- 设置加载和保存失败。
- SFTP 打开会话、加载目录、文件操作、上传/下载失败。
- Redis 列表加载、详情加载、保存/删除/重命名/TTL 失败。
- 数据库对象树加载、SQL 文件加载/保存、SQL 执行、表数据加载/保存失败。
- 连接测试失败、添加/编辑/删除保存失败。

前端日志的 module 使用：

- `frontend.settings`
- `frontend.connections`
- `frontend.sftp`
- `frontend.redis`
- `frontend.database`

## 脱敏与截断

日志写入前统一处理：

- 对 `target`、`message`、`error` 和 `metadata` 字符串做长度截断，单字段默认最多 2000 字符。
- 对明显敏感 key 做脱敏：`password`、`passphrase`、`private_key`、`privateKey`、`secret`、`token`、`authorization`、`api_key`、`apiKey`。
- 对常见 URL 形式中的密码片段做脱敏，例如：

```text
mysql://user:password@host/db
redis://:password@host/db
postgresql://user:password@host/db
```

- 对错误字符串中出现的已知连接密码不主动匹配，因为日志 helper 不应读取并扩散完整连接配置；优先保证不主动拼接密码字段。

脱敏在 `AppLogger::write` 内执行，保证后端和前端写入都经过同一边界。

## 结构化 metadata

`log_operation` 增加可选 metadata，用于记录不会泄密的排查上下文：

- Redis：`database`、`key_type`、`count`。
- SFTP：`path_count`、`transfer_id`、`overwrite`、`max_bytes`。
- 数据库：`database`、`table`、`row_count`、`field_count`、`sql_kind`。
- 前端：`component`、`command`。

metadata 只放标量或简单字符串，不放完整对象和业务数据。

## 测试策略

Rust：

- `AppLogger` 会脱敏 metadata 和字符串字段。
- `AppLogger` 会截断超长字段。
- Redis/SFTP/数据库关键 command 编译通过，并保持现有行为。
- 对至少一个 Redis 写操作、一个 SFTP 写操作、一个数据库写操作补单元测试或 command 层 helper 测试，验证日志目标和敏感字段不会进入 entry。

TypeScript：

- 前端日志 helper 调用 `write_app_log`。
- helper 在写日志失败时不会抛出异常。
- 连接删除、SFTP 错误、Redis 错误、数据库错误中至少覆盖一个 UI 测试，验证会写前端错误日志。

全量验证：

- `pnpm test`
- `pnpm build`
- `pnpm test:rust`
- `git diff --check`

## 验收标准

- Redis 常见查看、编辑、新增、删除、TTL 和批量操作成功或失败时有日志。
- SFTP 常见文件操作和文件夹传输成功或失败时有日志。
- 数据库对象树、DDL、SQL 文件、表数据增删改成功或失败时有日志。
- 前端捕获的关键错误会通过 `write_app_log` 写入日志。
- 日志中不出现密码、私钥口令、Redis 密码、数据库密码、token、authorization 或默认完整 SQL。
- 日志记录失败不会导致原业务操作失败。
