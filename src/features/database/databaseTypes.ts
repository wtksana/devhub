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
}

export interface DatabaseTableBrowserTarget {
  database: string;
  table: string;
}
