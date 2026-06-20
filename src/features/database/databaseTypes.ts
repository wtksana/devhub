export interface DatabaseWorkspaceProps {
  connectionId: string;
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

export interface QueryHistoryItem {
  id: number;
  connection_id: string;
  database_kind: string;
  database_name?: string | null;
  sql_text: string;
  executed_at: string;
  duration_ms: number;
  success: boolean;
  error_message?: string | null;
}
