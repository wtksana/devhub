export interface DatabaseWorkspaceProps {
  connectionId: string;
  initialDatabase?: string;
  theme: "dark" | "light";
  fontFamily: string;
  fontSize: number;
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

export interface DatabaseQueryResult {
  columns: Array<{
    name: string;
    data_type: string;
  }>;
  rows: DatabaseCellValue[][];
  affected_rows: number;
  duration_ms: number;
  limited: boolean;
}

export interface DatabaseSqlFile {
  name: string;
  content: string;
}

export interface DatabaseTableDdlResult {
  ddl: string;
  duration_ms: number;
}

export type DatabaseSortDirection = "asc" | "desc";

export interface DatabaseTablePageResult {
  columns: Array<{
    name: string;
    data_type: string;
  }>;
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
