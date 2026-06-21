# 数据库 B 版第一批：表数据分页浏览设计

## 背景

数据库 A 版已经支持 MySQL / PostgreSQL 连接、对象树、SQL 文件、Monaco SQL 编辑器、执行选中 SQL、危险 SQL 确认和结果表格。下一步要把“双击表查看数据”从一次性 SQL 查询升级为更接近数据库管理工具的只读表数据浏览能力。

B 版第一批只做只读浏览，不做表数据新增、编辑、删除。这样可以先解决日常看表、翻页、排序和筛选需求，同时避免过早引入主键识别、事务、类型编辑、批量提交和误修改风险。

## 目标

- 双击表或视图后打开表数据浏览模式。
- 表数据支持分页加载。
- 表数据支持按单列排序。
- 表数据支持简单筛选。
- 表数据浏览不覆盖当前 SQL 文件内容。
- 保留 SQL 编辑器和自由 SQL 查询能力。
- MySQL 和 PostgreSQL 都支持第一版分页浏览。

## 不做范围

- 表数据编辑。
- 新增行、删除行。
- 多列排序。
- 可视化复杂条件构建器。
- 结构管理、建表改表、索引管理。
- 导入导出。
- 执行计划。
- SSH tunnel 和 SSL 证书配置。

## 推荐方案

采用“SQL 查询结果”和“表数据浏览状态”并存的方案。

- SQL 编辑器继续负责自由 SQL。
- 双击表时不再把 `SELECT * FROM table LIMIT 200` 写入 SQL 编辑器。
- 工作区结果区域进入表数据浏览模式，内部维护表名、页码、每页条数、排序列、排序方向和筛选文本。
- 用户执行自由 SQL 后，结果区域切回普通查询结果模式。

这个方案的优点是边界清晰：SQL 文件内容不会被表浏览动作覆盖，表数据浏览也可以拥有自己的分页和筛选状态。缺点是前端状态会比 A 版多一层模式判断，但复杂度可控。

## 交互设计

### 打开表

用户在左侧表列表双击表或视图：

- 结果区域显示表数据浏览面板。
- 顶部显示当前表名。
- 默认加载第 1 页。
- 默认每页 200 条。
- 默认无排序。
- 默认无筛选。

### 表数据工具栏

表数据面板顶部工具栏：

```text
表 <table_name>    第 [1] 页    每页 [200] 条    共 x 条    [筛选条件]    刷新
```

第一版筛选条件使用单行文本输入，作为一个简单 SQL 条件片段，例如：

```sql
status = 'SUCCESS'
```

如果筛选为空，不追加 `WHERE`。如果筛选不为空，后端拼接为：

```sql
WHERE <filter>
```

筛选输入失去焦点或按 Enter 后生效。筛选错误由后端 SQL 错误返回并显示在表数据面板中。

### 分页

分页控件包含：

- 上一页。
- 下一页。
- 页码输入。
- 每页条数输入。
- 总行数。

不能上一页或下一页时，对应按钮禁用。

每页条数限制：

- 最小 1。
- 最大 10000。
- 默认 200。

### 排序

点击表头列名切换排序：

1. 第一次点击：升序。
2. 第二次点击：降序。
3. 第三次点击：取消排序。

排序只支持单列。列名必须由后端根据当前表元数据或查询结果列名做标识符引用，前端不直接拼接排序 SQL。

## 后端设计

新增 Tauri command：

```rust
load_database_table_page(request) -> DatabaseTablePageResult
```

请求字段：

- `connection_id`
- `database`
- `table`
- `page`
- `page_size`
- `sort_column`
- `sort_direction`
- `filter`

响应字段：

- `columns`
- `rows`
- `total_rows`
- `page`
- `page_size`
- `duration_ms`

MySQL 查询示例：

```sql
select count(*) from `table` where <filter>;
select * from `table` where <filter> order by `column` asc limit ? offset ?;
```

PostgreSQL 查询示例：

```sql
select count(*) from "table" where <filter>;
select * from "table" where <filter> order by "column" asc limit $1 offset $2;
```

第一版的筛选条件是高级用户能力，不做 SQL 解析器。安全边界：

- 表名和排序列必须通过后端标识符引用函数处理。
- `page`、`page_size`、`limit`、`offset` 使用数值参数或后端数值生成。
- 筛选条件允许用户输入 SQL 条件片段，错误直接返回给用户。
- 筛选条件不进入设置文件。

## 前端设计

在 `DatabaseWorkspace` 中增加结果模式：

- `query_result`：普通 SQL 查询结果。
- `table_page`：表数据分页浏览结果。

新增表数据浏览组件：

```text
DatabaseTableBrowser
```

职责：

- 渲染表数据工具栏。
- 维护页码、每页条数、排序和筛选输入。
- 调用 `load_database_table_page`。
- 复用现有结果表格样式展示列和行。

自由 SQL 执行成功后，结果区域切换为 `query_result`。双击表后切换为 `table_page`。

## 错误处理

- 连接失败、SQL 语法错误、权限不足：显示在表数据面板顶部。
- `page_size` 超出范围：前端限制，后端再次 clamp。
- 筛选条件错误：保留当前旧数据，并显示错误信息。
- 表不存在或切换数据库后表失效：显示后端错误，用户可刷新对象树。

## 测试策略

Rust 测试：

- MySQL / PostgreSQL 表分页 SQL 生成。
- 标识符引用。
- page / page_size 边界处理。
- 排序参数校验。

前端测试：

- 双击表进入表数据浏览模式，不覆盖 SQL 编辑器内容。
- 切换上一页、下一页会调用新 command。
- 点击列名切换升序、降序、取消排序。
- 筛选输入按 Enter 生效。
- 执行自由 SQL 后切回普通查询结果模式。

## 验收标准

- 双击表可以看到第 1 页数据。
- 可以翻页并看到不同页的查询请求参数。
- 可以修改每页条数。
- 可以点击列名排序。
- 可以输入简单筛选条件并刷新。
- SQL 文件内容不会因为双击表被覆盖。
- 现有数据库 A 版测试继续通过。
