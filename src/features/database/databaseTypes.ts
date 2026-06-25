export interface DatabaseWorkspaceProps {
  connectionId: string;
  initialDatabase?: string;
  theme: "dark" | "light";
  fontFamily: string;
  fontSize: number;
  queryTimeoutMs?: number;
}

export interface DatabaseTreeNode {
  id: string;
  name: string;
  kind: string;
  has_children: boolean;
  detail?: string | null;
}

export type DatabaseCellValue =
  | { kind: "null" }
  | { kind: "text"; value: string }
  | { kind: "number"; value: string }
  | { kind: "bool"; value: boolean };

export interface DatabaseResultColumn {
  name: string;
  data_type: string;
  nullable?: boolean | null;
  has_default?: boolean | null;
  generated?: boolean | null;
}

export interface DatabaseQueryResult {
  columns: DatabaseResultColumn[];
  rows: DatabaseCellValue[][];
  affected_rows: number;
  duration_ms: number;
  limited: boolean;
}

export interface DatabaseSqlFile {
  name: string;
  content: string;
}

export interface DatabaseSqlFilePreview {
  path: string;
  file_name: string;
  size_bytes: number;
  preview: string;
  estimated_statement_count: number;
  dangerous: boolean;
}

export interface DatabaseSqlFileExecutionResult {
  executed_statements: number;
  affected_rows: number;
  duration_ms: number;
  failed_statement_index?: number | null;
  failed_statement_preview?: string | null;
}

export type DatabaseResultExportFormat = "csv" | "insert_sql";

export interface DatabaseResultExportResult {
  exported_rows: number;
  duration_ms: number;
}

export interface ExportDatabaseResultRequest {
  connection_id: string;
  database: string;
  table: string | null;
  path: string;
  format: DatabaseResultExportFormat;
  include_header: boolean;
  columns: DatabaseResultColumn[];
  rows: DatabaseCellValue[][];
}

export interface DatabaseTableDdlResult {
  ddl: string;
  duration_ms: number;
}

export interface TableStructureColumnDefinition {
  name: string;
  data_type: string;
  nullable: boolean;
}

export type TableStructureOperation =
  | { kind: "add_column"; column: TableStructureColumnDefinition }
  | { kind: "modify_column"; original_name: string; column: TableStructureColumnDefinition }
  | { kind: "drop_column"; name: string };

export interface DatabaseTableStructureUpdateResult {
  ddl: string;
  duration_ms: number;
}

export type DatabaseSortDirection = "asc" | "desc";

export interface DatabaseTablePageResult {
  columns: DatabaseResultColumn[];
  rows: DatabaseCellValue[][];
  total_rows: number;
  page: number;
  page_size: number;
  duration_ms: number;
  primary_key_columns: string[];
  editable: boolean;
}

export interface DatabaseTableBrowserTarget {
  database: string;
  table: string;
}

export interface DatabaseTableUpdateRow {
  primary_key_values: Record<string, DatabaseCellValue>;
  changes: Record<string, DatabaseCellValue>;
}

export interface DatabaseTableInsertRow {
  values: Record<string, DatabaseCellValue>;
}

export interface InsertDatabaseTableRowsRequest {
  connection_id: string;
  database: string;
  table: string;
  rows: DatabaseTableInsertRow[];
}

export interface DatabaseTableDeleteRow {
  primary_key_values: Record<string, DatabaseCellValue>;
}

export interface DeleteDatabaseTableRowsRequest {
  connection_id: string;
  database: string;
  table: string;
  primary_key_columns: string[];
  rows: DatabaseTableDeleteRow[];
}

export interface UpdateDatabaseTableRowsRequest {
  connection_id: string;
  database: string;
  table: string;
  primary_key_columns: string[];
  rows: DatabaseTableUpdateRow[];
}

export interface DatabaseTableUpdateResult {
  updated_rows: number;
  updated_fields: number;
  duration_ms: number;
}
