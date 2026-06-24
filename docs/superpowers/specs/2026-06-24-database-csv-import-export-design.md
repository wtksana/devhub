# 数据库 CSV 导入导出设计

## 背景

DevHub 当前数据库模块已经支持 MySQL / PostgreSQL 连接、对象树、SQL 编辑器、查询结果、表数据分页浏览和表数据编辑。下一步补齐导入导出能力时，需要先解决日常最常见的“把当前表数据导出给别人看或备份一份”“把 CSV 数据导入当前表”。

第一版不做整库备份恢复，也不做 SQL dump。CSV 表数据导入导出能复用现有表数据浏览、批量插入和数据库连接池能力，风险更低，也更容易在 UI 上做确认和错误提示。

## 目标

- 在表数据浏览面板支持导出当前表数据为 CSV。
- 导出范围为当前表在当前筛选、排序、Order By 条件下的全部匹配数据，不只导出当前页。
- 在表数据浏览面板支持从 CSV 导入到当前表。
- 导入前展示预览、列匹配和基础校验结果。
- 导入时按批次插入，避免大文件一次性占用过多内存。
- 导入导出操作写入操作日志，不记录完整数据内容。
- 保持现有 SQL 编辑器、表数据编辑和分页浏览行为不变。

## 不做范围

- 整库导出、整库导入。
- 多表导出、跨表导入。
- DDL 导出或结构恢复。
- SQL dump 文件生成或执行。
- Excel `.xlsx` 导入导出。
- 导入时更新已有行、按主键 upsert、忽略重复键等高级冲突策略。
- 导入时复杂类型编辑器，例如 JSON、Geometry、Blob 专用处理。
- 导入进度队列和取消任务。第一版导入为一次命令，完成后返回结果。

## 交互设计

### 表面板工具栏

在表数据浏览面板顶部工具栏增加两个图标按钮：

- `导出 CSV`
- `导入 CSV`

按钮放在现有刷新、保存更改、放弃更改按钮附近。若当前表有未保存编辑，导入和导出前沿用现有“放弃更改确认”机制，避免用户误以为导出包含未提交修改。

### 导出 CSV

用户点击 `导出 CSV` 后：

1. 打开系统保存文件对话框，默认文件名为 `<database>.<table>.csv`。
2. 用户选择保存路径后，后端按当前表浏览条件导出全部匹配数据。
3. 成功后在表面板显示简短结果，例如：`已导出 1234 行`。
4. 失败时在表面板显示错误信息，并写入操作日志。

CSV 格式：

- UTF-8 without BOM。
- 第一行为列名。
- 字段按 RFC 4180 常见规则转义：包含逗号、双引号、换行时用双引号包裹，双引号写成两个双引号。
- `NULL` 导出为空字段。
- 日期、Decimal、Bool 等按当前后端 `DatabaseCellValue` 字符串表现导出。

导出查询：

- 复用表数据浏览的数据库、表名、筛选、排序、Order By 条件。
- 不使用当前分页参数。
- 后端增加最大导出行数保护，第一版默认 100000 行。超过限制时返回错误提示用户缩小筛选条件。

### 导入 CSV

用户点击 `导入 CSV` 后：

1. 打开系统选择文件对话框，只选择 `.csv`。
2. 后端读取 CSV 表头和前 20 行，返回预览。
3. 前端弹窗展示：
   - 文件路径。
   - 当前目标表。
   - CSV 总列数。
   - 预览前 20 行。
   - 列匹配结果。
   - `首行是表头` 选项，默认开启。
   - `空字段作为 NULL` 选项，默认关闭。
4. 用户确认后，后端重新读取文件并按批次插入。
5. 成功后刷新当前表数据，显示导入结果，例如：`已导入 500 行`。
6. 失败时保留弹窗或在表面板显示错误，提示失败行号和错误信息。

列匹配规则：

- 默认按 CSV 表头和表字段名称匹配。
- 忽略大小写精确匹配，例如 `User_ID` 可匹配 `user_id`。
- 未匹配的 CSV 列默认忽略。
- 表中未出现在 CSV 的列不传值，让数据库默认值、自动生成列或 NULL 规则生效。
- 若没有任何列匹配，阻止确认导入。

第一版不提供图形化列重映射。后续可以在预览弹窗中增加每列目标字段选择框。

## 后端设计

新增模型：

```rust
pub struct PreviewDatabaseCsvImportRequest {
    pub connection_id: String,
    pub database: String,
    pub table: String,
    pub path: String,
    pub has_header: bool,
}

pub struct DatabaseCsvImportPreview {
    pub path: String,
    pub columns: Vec<String>,
    pub matched_columns: Vec<DatabaseCsvColumnMatch>,
    pub preview_rows: Vec<Vec<String>>,
}

pub struct DatabaseCsvColumnMatch {
    pub source: String,
    pub target: Option<String>,
}

pub struct ImportDatabaseCsvRequest {
    pub connection_id: String,
    pub database: String,
    pub table: String,
    pub path: String,
    pub has_header: bool,
    pub empty_as_null: bool,
}

pub struct DatabaseCsvImportResult {
    pub inserted_rows: u64,
    pub duration_ms: u128,
}

pub struct ExportDatabaseCsvRequest {
    pub connection_id: String,
    pub database: String,
    pub table: String,
    pub path: String,
    pub sort_column: Option<String>,
    pub sort_direction: Option<String>,
    pub order_by: Option<String>,
    pub filter: Option<String>,
}

pub struct DatabaseCsvExportResult {
    pub exported_rows: u64,
    pub duration_ms: u128,
}
```

新增 Tauri commands：

- `preview_database_csv_import`
- `import_database_csv`
- `export_database_csv`

文件对话框使用 Tauri Dialog plugin 的前端 API 选择路径，后端只接收明确路径并执行读写。

CSV 解析和生成优先使用 Rust `csv` crate。它成熟、体积较小，能处理引号、换行和逗号转义，避免手写 CSV 解析。

导入写入复用现有 `insert_database_table_rows` 的底层构造方式，但后端应提供批量流式执行，避免把大 CSV 全量转成前端请求。每批默认 500 行。

## 数据库行为

### MySQL

- 表名和列名继续走现有后端标识符引用逻辑。
- 导出查询使用 `SELECT <columns> FROM <table> ...`。
- 导入使用批量 `INSERT INTO <table> (<columns>) VALUES ...`。

### PostgreSQL

第一版导入导出接口预留 PostgreSQL，但如果底层已有引用和批量插入能力不足，允许先对 MySQL 交付完整能力，PostgreSQL 返回明确错误：`PostgreSQL CSV import/export is not supported yet`。实现时优先复用现有数据库方言能力，避免引入不完整 SQL 拼接。

## 错误处理

- 文件不存在、无读取权限、无写入权限：返回文件错误。
- CSV 格式错误：返回行号和解析错误。
- 无匹配列：导入预览阶段返回可读错误。
- 数据库插入失败：返回批次起始行号和数据库错误。
- 导出超过最大行数：返回超过限制的提示。
- 所有错误写入操作日志，日志 metadata 只记录连接、库、表、路径文件名、行数、耗时，不记录数据内容。

## 测试设计

前端测试：

- 表面板显示导入、导出按钮。
- 点击导出按钮会调用保存文件对话框，并调用 `export_database_csv`。
- 点击导入按钮会调用选择文件对话框，并打开预览弹窗。
- 导入预览无匹配列时确认按钮禁用。
- 导入成功后刷新当前表。

后端测试：

- CSV 写出能正确处理逗号、双引号、换行和 NULL。
- CSV 预览能按表字段匹配列名。
- 空字段默认作为空字符串，开启 `empty_as_null` 后作为 NULL。
- 导入无匹配列返回错误。
- 导出超过最大行数返回错误。

## 后续扩展

- 导入时提供列映射 UI。
- 支持导入冲突策略：跳过、覆盖、upsert。
- 支持 SQL dump 导出。
- 支持多表导入导出任务队列、进度和取消。
- 支持 `.xlsx`。
