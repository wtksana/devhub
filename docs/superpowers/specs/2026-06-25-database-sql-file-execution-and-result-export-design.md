# 数据库 SQL 文件执行与查询结果导出设计

## 背景

DevHub 当前数据库模块已经支持 MySQL / PostgreSQL 连接、对象树、SQL 编辑器、查询结果、表数据分页浏览和表数据编辑。下一步需要补齐两个日常运维能力：

- 选择本地 `.sql` 文件并执行，执行前预览部分 SQL 内容并确认。
- 将当前查询结果导出为 CSV 文件，或导出为批量 `INSERT` 语句的 SQL 文件。

本版不做 CSV 数据导入。导入类能力先用“执行 SQL 文件”承载，这更符合数据库运维中导入脚本、初始化数据、执行补丁 SQL 的习惯，也避免 CSV 列匹配、类型转换和冲突策略过早复杂化。

## 目标

- 在数据库工作区支持选择并执行本地 SQL 文件。
- 执行 SQL 文件前弹出确认窗口，预览文件开头部分 SQL 内容。
- SQL 文件执行完成后展示执行结果：成功语句数、影响行数、耗时；失败时展示失败位置和错误信息。
- 在查询结果表格支持导出当前查询结果为 CSV 文件。
- 在查询结果表格支持导出当前查询结果为批量 `INSERT` 语句 SQL 文件。
- 导出默认文件名为 `<database>.<table>.<yyyyMMddHHmmss>.csv` 或 `<database>.<table>.<yyyyMMddHHmmss>.sql`。
- 操作写入操作日志，不记录完整 SQL 文件内容或导出数据内容。
- 保持现有 SQL 编辑器、表数据浏览、表数据编辑和分页逻辑不变。

## 不做范围

- CSV 导入。
- 整库导出、整库导入。
- 多表导出。
- DDL 导出或结构恢复。
- `.xlsx` 导入导出。
- SQL 文件执行进度队列和取消任务。第一版执行为一次命令，完成后返回结果。
- SQL 文件断点续跑。
- SQL 文件执行前完整解析所有方言语法。第一版按通用 SQL 分号分割执行，并支持字符串、注释中的分号跳过。
- 导出 Blob / 二进制字段。遇到不支持的值按后端当前字符串化能力处理，无法转换时返回明确错误。

## 交互设计

### 工具栏按钮

在数据库工作区的 SQL 编辑器工具栏或查询结果区域工具栏增加两个图标按钮：

- `执行 SQL 文件`，图标使用 `tabler:file-import`。
- `导出`，图标使用 `mdi:table-export`。

图标实现沿用当前项目 SVG 资产模式：实现时从 Iconify 对应图标下载 SVG，放入 `src/assets/icons/`，再通过 `?react` 引入。

### 执行 SQL 文件

用户点击 `执行 SQL 文件` 后：

1. 打开系统文件选择对话框，只允许选择 `.sql` 文件。
2. 后端读取文件信息和预览内容，返回：
   - 文件路径。
   - 文件大小。
   - 预览内容，默认前 200 行或前 64 KB，取较小者。
   - 估算语句数量。
3. 前端弹出确认窗口：
   - 标题：`执行 SQL 文件`。
   - 展示文件名、路径、大小、估算语句数。
   - 展示只读 SQL 预览。
   - 提示“执行前请确认已选择正确数据库”。
   - 按钮：`取消`、`执行`。
4. 用户确认后，后端执行 SQL 文件。
5. 执行成功后在结果区域显示摘要，例如：`执行完成：12 条语句，影响 350 行，耗时 1280 ms`。
6. 执行失败时显示失败语句序号、失败 SQL 片段和数据库错误。

执行数据库：

- 使用当前数据库工作区选中的数据库。
- 如果当前数据库为空，执行前阻止并提示选择数据库。

危险 SQL：

- SQL 文件执行前不逐条弹危险 SQL 确认，统一由文件确认弹窗承担风险确认。
- 确认弹窗中显示危险关键词提示：如果预览或估算扫描发现 `drop`、`truncate`、`delete`、`update`、`alter` 等关键词，展示醒目的警告文本。

### 导出当前查询结果

导出按钮只针对当前结果表格：

- 如果当前显示的是自由 SQL 查询结果，导出该查询结果中已返回的行。
- 如果当前显示的是表数据浏览结果，导出当前页已加载的行。
- 第一版不重新执行查询，也不导出“全部匹配数据”。这样可以让导出行为和用户眼前看到的数据一致，避免长时间查询和隐藏的大量数据导出。

用户点击 `导出` 后显示菜单：

- `导出为 CSV`
- `导出为 INSERT SQL`

#### 导出为 CSV

1. 打开系统保存文件对话框。
2. 默认文件名：`<database>.<table>.<yyyyMMddHHmmss>.csv`。
3. 用户确认路径后，前端把当前结果列和当前结果行传给后端写出 CSV。
4. 成功后显示：`已导出 x 行`。

CSV 格式：

- UTF-8 without BOM。
- 第一行为列名。
- 字段按 RFC 4180 常见规则转义。
- `NULL` 导出为空字段。
- Bool、Number、Text 使用当前 `DatabaseCellValue` 的字符串表示。

#### 导出为 INSERT SQL

1. 打开系统保存文件对话框。
2. 默认文件名：`<database>.<table>.<yyyyMMddHHmmss>.sql`。
3. 用户确认路径后，前端把当前结果列和当前结果行传给后端写出批量 `INSERT` SQL。
4. 成功后显示：`已导出 x 行`。

INSERT SQL 生成规则：

- 目标表名使用当前表数据浏览的表名。
- 如果当前结果来自自由 SQL 查询，并且不能确定目标表名，则导出前弹窗要求用户输入目标表名。
- 字段名来自当前结果列名。
- 每 500 行生成一条批量 `INSERT` 语句。
- 字符串按数据库 SQL 字符串规则转义单引号。
- `NULL` 写为 `NULL`。
- 数字不加引号。
- Bool 对 MySQL 写为 `1` / `0`；PostgreSQL 写为 `TRUE` / `FALSE`。

## 后端设计

新增模型：

```rust
pub struct PreviewDatabaseSqlFileRequest {
    pub connection_id: String,
    pub database: String,
    pub path: String,
}

pub struct DatabaseSqlFilePreview {
    pub path: String,
    pub file_name: String,
    pub size_bytes: u64,
    pub preview: String,
    pub estimated_statement_count: u64,
    pub dangerous: bool,
}

pub struct ExecuteDatabaseSqlFileRequest {
    pub connection_id: String,
    pub database: String,
    pub path: String,
}

pub struct DatabaseSqlFileExecutionResult {
    pub executed_statements: u64,
    pub affected_rows: u64,
    pub duration_ms: u128,
}

pub struct ExportDatabaseResultRequest {
    pub connection_id: String,
    pub database: String,
    pub table: Option<String>,
    pub path: String,
    pub format: DatabaseResultExportFormat,
    pub columns: Vec<DatabaseResultColumn>,
    pub rows: Vec<Vec<DatabaseCellValue>>,
}

pub enum DatabaseResultExportFormat {
    Csv,
    InsertSql,
}

pub struct DatabaseResultExportResult {
    pub exported_rows: u64,
    pub duration_ms: u128,
}
```

新增 Tauri commands：

- `preview_database_sql_file`
- `execute_database_sql_file`
- `export_database_result`

文件选择和保存对话框使用前端 Tauri Dialog plugin：

- 执行 SQL 文件：`open`，过滤 `.sql`。
- 导出 CSV / SQL：`save`，按导出格式设置默认文件名和扩展名。

后端只接收明确文件路径，负责读写文件和数据库执行。

## SQL 文件执行策略

### 语句拆分

第一版实现一个轻量 SQL splitter：

- 按分号拆分语句。
- 跳过单引号字符串、双引号字符串、反引号标识符中的分号。
- 跳过 `--` 行注释和 `/* ... */` 块注释中的分号。
- 空语句不执行。

该 splitter 不试图完整理解所有数据库方言。遇到复杂脚本语法不支持时，返回明确错误；后续可按 MySQL delimiter、PostgreSQL dollar quote 等能力扩展。

### 执行

- 同一 SQL 文件在同一连接池连接上顺序执行。
- 第一版不自动包事务，避免不同数据库和脚本里的事务语句冲突。
- 执行到第一条失败语句时停止，返回失败语句序号、SQL 片段和错误。
- 成功时汇总执行语句数和影响行数。

## 日志

新增操作日志 action：

- `preview_database_sql_file`
- `execute_database_sql_file`
- `export_database_result`

metadata 记录：

- connection id。
- database。
- table，如果有。
- 文件名，不记录完整路径。
- 文件大小。
- 导出格式。
- 行数。
- 语句数。
- 耗时。

日志不记录 SQL 文件内容、SQL 预览内容、查询结果数据或完整导出内容。

## 测试设计

前端测试：

- SQL 文件执行按钮使用 `tabler:file-import` 对应 SVG 资产并有可访问名称。
- 导出按钮使用 `mdi:table-export` 对应 SVG 资产并有可访问名称。
- 点击执行 SQL 文件按钮会打开文件选择对话框并调用 `preview_database_sql_file`。
- 预览弹窗展示文件名、大小、估算语句数和预览 SQL。
- 确认执行后调用 `execute_database_sql_file`，成功后显示摘要。
- 导出菜单包含 `导出为 CSV` 和 `导出为 INSERT SQL`。
- 导出当前查询结果为 CSV 时调用保存对话框和 `export_database_result`。
- 自由 SQL 查询结果导出 INSERT SQL 且无表名时，要求输入目标表名。

后端测试：

- SQL splitter 能正确跳过字符串和注释中的分号。
- SQL 文件预览限制为前 200 行或 64 KB。
- 危险关键词检测能识别 `drop`、`truncate`、`delete`、`update`、`alter`。
- 导出 CSV 能正确处理逗号、双引号、换行和 NULL。
- 导出 INSERT SQL 能正确处理字符串单引号、NULL、数字和 Bool。
- SQL 文件执行失败时返回失败语句序号和错误信息。

## 后续扩展

- 支持 MySQL `DELIMITER`。
- 支持 PostgreSQL dollar quoted string。
- SQL 文件执行进度、取消和后台任务队列。
- 导出全部匹配数据，而不是只导出当前结果。
- 多表导出。
- SQL dump 导出。
