interface SftpWorkspaceProps {
  connectionId: string | null;
}

export function SftpWorkspace({ connectionId }: SftpWorkspaceProps) {
  return <section>{connectionId ? `SFTP：${connectionId}` : "未选择连接"}</section>;
}
