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
