interface TerminalWorkspaceProps {
  connectionId: string | null;
}

export function TerminalWorkspace({ connectionId }: TerminalWorkspaceProps) {
  return <section>{connectionId ? `终端：${connectionId}` : "未选择连接"}</section>;
}
