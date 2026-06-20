# 数据库管理 A 版设计文档

## 背景

数据库管理是 DevHub 在 SSH、SFTP 和 Redis 之后的下一阶段能力。第一版目标不是完整数据库 IDE，而是先打通日常开发运维最常用的闭环：连接数据库、浏览库表结构、写 SQL、查看查询结果和复用查询历史。

数据库 A 版优先保证稳定、快速和界面一致性。复杂能力如表数据编辑、结构变更、导入导出、执行计划和 SSH tunnel 放到后续 B/C 版。

## 范围

A 版支持：

- MySQL。
- PostgreSQL。
- 直连数据库。
- 用户名密码认证。
- 密码按当前产品约定直接保存到 `settings.json`。
- 连接测试。
- 连接面板展示数据库连接，并支持分组。
- 双击数据库连接打开数据库工作区标签。
- 数据库对象树：连接、数据库或 Schema、表、视图、字段。
- SQL 编辑器。
- 执行任意 SQL。
- 危险 SQL 执行前二次确认。
- 查询结果表格。
- 查询结果默认限制 200 行，工具栏可修改。
- 双击表打开表数据视图，默认执行带 `LIMIT 200` 的查询。
- 查询历史保存到本地 SQLite，每个连接保留最近 100 条。

A 版不支持：

- SSH tunnel。
- 跳板机。
- SSL 证书配置。
- Kerberos、IAM 等高级认证。
- 表数据新增、编辑、删除。
- 建表、改表、索引、约束、触发器管理。
- 导入导出。
- 执行计划。
- 备份和恢复。
- 多 SQL 子标签。

## 连接配置

数据库连接沿用当前 `settings.json` 的连接数组，新增两类连接：

- `kind: "mysql"`。
- `kind: "postgresql"`。

字段：

- `id`：连接唯一标识。
- `kind`：数据库类型。
- `name`：连接显示名称。
- `group`：连接分组，可为空。
- `host`：主机。
- `port`：端口，MySQL 默认 3306，PostgreSQL 默认 5432。
- `username`：用户名。
- `password`：真实密码，按当前产品约定直接保存。
- `database`：默认数据库，可为空。

示例：

```json
{
  "kind": "mysql",
  "id": "mysql-dev",
  "name": "开发 MySQL",
  "group": "开发环境",
  "host": "127.0.0.1",
  "port": 3306,
  "username": "root",
  "password": "plain-password",
  "database": "app"
}
```

```json
{
  "kind": "postgresql",
  "id": "pg-dev",
  "name": "开发 PostgreSQL",
  "group": "开发环境",
  "host": "127.0.0.1",
  "port": 5432,
  "username": "postgres",
  "password": "plain-password",
  "database": "app"
}
```

## 连接面板

连接面板继续统一承载 SSH、Redis 和数据库连接。

数据库连接项行为：

- 名称前显示数据库类型图标。
- 副标题显示 `mysql://host:port/database` 或 `postgresql://host:port/database`。
- 双击打开数据库工作区标签。
- 右键菜单第一版包含：连接、测试连接、编辑、复制、移动到分组。

添加连接弹窗增加数据库类型：

- SSH。
- Redis。
- MySQL。
- PostgreSQL。

选择 MySQL 或 PostgreSQL 后显示数据库连接字段。测试连接按钮放在弹窗底部左侧，错误信息显示在弹窗内，不写到连接面板。

## 工作区

数据库工作区采用单标签结构，一个连接对应一个数据库工作区标签。

工作区区域：

- 左侧对象树。
- 右侧 SQL 编辑器。
- 结果工具栏。
- 查询结果表格。
- 查询历史入口。

第一版不做数据库工作区内部多子标签。双击表、执行 SQL、查看历史都在当前工作区内切换内容。

## 对象树

对象树按数据库类型适配。

MySQL：

- 连接。
- Database。
- 表。
- 视图。
- 字段。

PostgreSQL：

- 连接。
- Database。
- Schema。
- 表。
- 视图。
- 字段。

字段信息：

- 字段名。
- 类型。
- 是否可空。
- 是否主键。

对象树加载规则：

- 打开数据库标签后先加载顶层 database/schema 摘要。
- 展开节点时再按需加载下一级。
- 节点加载失败时只在该节点显示错误，不影响整个工作区。
- 刷新对象树时保留当前连接和 SQL 内容。

## 表数据浏览

双击表时：

1. 自动生成 `SELECT * FROM <table> LIMIT 200`。
2. 填入 SQL 编辑器。
3. 执行查询。
4. 查询结果显示在结果表格。

表名和字段名必须按数据库类型正确引用：

- MySQL 使用反引号。
- PostgreSQL 使用双引号。

默认限制 200 行。工具栏允许用户修改限制值，例如 200、500、1000 或自定义。

## SQL 编辑器

A 版 SQL 编辑器目标是够用、稳定，不追求完整 IDE 能力。

第一版能力：

- 多行 SQL 输入。
- 执行当前 SQL。
- 显示执行状态、耗时和影响行数。
- 支持任意 SQL。
- 危险 SQL 二次确认。

危险 SQL 包括：

- `INSERT`
- `UPDATE`
- `DELETE`
- `DROP`
- `TRUNCATE`
- `ALTER`
- `CREATE`
- `REPLACE`
- `GRANT`
- `REVOKE`

危险判断只做第一条有效语句的保守识别。识别不确定时按危险处理。

## 查询限制

查询结果默认限制 200 行。

规则：

- 表数据浏览生成的 SQL 直接带 `LIMIT 200`。
- 用户手写 `SELECT` 时，如果没有显式限制，执行前按当前工具栏限制追加限制。
- 用户 SQL 已包含 `LIMIT` 时尊重用户 SQL。
- 非 `SELECT` 语句不追加限制。
- 结果超过限制时显示“结果已限制为 N 行”。

如果后续发现自动追加限制对复杂 SQL 兼容性不足，可以改为后端读取最多 N 行并提示截断；A 版先选择更直观的限制行为。

## 查询结果表格

结果表格显示：

- 列名。
- 行号。
- 单元格文本。
- NULL 值标记。
- 查询耗时。
- 影响行数。
- 错误信息。

第一版只读显示，不支持单元格编辑。

性能约束：

- 默认只显示最多 200 行。
- 结果表格应使用稳定高度和滚动区域。
- 大文本单元格默认截断显示，点击可在弹窗查看完整内容。

## 查询历史

查询历史使用本地 SQLite 保存。

项目已经引入 `rusqlite`，不新增额外数据库依赖。SQLite 不作为常驻服务运行，只在读写历史时打开本地数据库连接。

存储位置：

- 应用数据目录下的 `devhub.db`。

第一版表：

```sql
CREATE TABLE IF NOT EXISTS query_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  connection_id TEXT NOT NULL,
  database_kind TEXT NOT NULL,
  database_name TEXT,
  sql_text TEXT NOT NULL,
  executed_at TEXT NOT NULL,
  duration_ms INTEGER NOT NULL,
  success INTEGER NOT NULL,
  error_message TEXT
);

CREATE INDEX IF NOT EXISTS idx_query_history_connection_time
ON query_history(connection_id, executed_at DESC);
```

规则：

- 每次执行 SQL 后写入历史。
- 每个连接只保留最近 100 条。
- 历史不写入 `settings.json`。
- 历史面板按时间倒序显示。
- 点击历史项可把 SQL 填回编辑器。

## Rust 后端设计

新增数据库模块建议放在：

- `src-tauri/src/db/`
- `src-tauri/src/models/database.rs`
- `src-tauri/src/commands/database.rs`

后端职责：

- 读取连接配置。
- 测试连接。
- 管理数据库连接。
- 加载对象树元数据。
- 执行 SQL。
- 归一化 MySQL 和 PostgreSQL 的结果结构。
- 写入和读取查询历史。

建议依赖：

- MySQL：`mysql_async` 或 `sqlx`。
- PostgreSQL：`tokio-postgres` 或 `sqlx`。

推荐优先评估 `sqlx`：

- 同时支持 MySQL 和 PostgreSQL。
- 统一连接池和行读取模型。
- 适合后续扩展更多数据库能力。

如果 `sqlx` 编译体积或复杂度明显不合适，再拆成 `mysql_async` + `tokio-postgres`。

## 前端模块设计

新增前端模块建议：

- `src/features/database/DatabaseWorkspace.tsx`
- `src/features/database/DatabaseObjectTree.tsx`
- `src/features/database/SqlEditor.tsx`
- `src/features/database/QueryResultTable.tsx`
- `src/features/database/QueryHistoryPanel.tsx`
- `src/features/database/databaseTypes.ts`

`AppShell` 增加数据库工作区标签类型：

- `kind: "database"`。
- `connectionId`。
- `title`。

`ConnectionList` 支持数据库连接展示、双击打开和右键菜单。

## 错误处理

连接错误：

- 主机不可达。
- 端口拒绝连接。
- 用户名或密码错误。
- 默认数据库不存在。

对象树错误：

- 权限不足。
- schema/database 不存在。
- 元数据查询失败。

SQL 执行错误：

- SQL 语法错误。
- 权限不足。
- 超时。
- 连接断开。
- 返回结果过大。

错误展示原则：

- 添加连接或测试连接错误显示在弹窗内。
- 数据库工作区错误显示在当前工作区，不影响其他标签。
- 单个对象树节点加载失败，不清空整棵树。

## 性能目标

- 打开数据库标签不阻塞其他终端或 Redis 标签。
- 对象树按需加载，不一次性加载所有字段。
- 查询结果默认 200 行，避免大表拖慢前端。
- 查询历史每个连接最多 100 条，避免本地历史无限增长。
- 后端数据库连接异常时移除旧连接，下次操作重新连接。

## 验收标准

- 可以添加 MySQL 连接并保存到 `settings.json`。
- 可以添加 PostgreSQL 连接并保存到 `settings.json`。
- 可以在添加连接弹窗测试数据库连接。
- 数据库连接显示在连接面板中并支持分组。
- 双击数据库连接打开数据库工作区标签。
- 对象树能展示 database/schema、表、视图和字段。
- 双击表能执行默认 `LIMIT 200` 查询并展示结果。
- SQL 编辑器可以执行 SELECT 并展示结果。
- SQL 编辑器可以执行非 SELECT，并展示影响行数。
- 危险 SQL 执行前有二次确认。
- 查询结果默认限制 200 行，工具栏可修改限制。
- 查询历史保存到本地 SQLite，并能按连接查看最近 100 条。
- 点击历史项能把 SQL 回填到编辑器。
- 数据库工作区关闭后释放前端状态，后端连接可按管理器策略复用或回收。

## 后续 B/C 版方向

B 版：

- 表数据分页筛选。
- 表数据新增、编辑、删除。
- 只读/可写连接模式。
- 事务提交和回滚。

C 版：

- 建表和改表。
- 索引、约束和触发器管理。
- 导入导出。
- 执行计划。
- SSH tunnel。
- SSL 证书配置。
- 备份和恢复。
