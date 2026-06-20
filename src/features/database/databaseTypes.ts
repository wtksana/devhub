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
