interface StatusBarProps {
  activeConnectionId: string | null;
}

export function StatusBar({ activeConnectionId }: StatusBarProps) {
  return (
    <footer className="status-bar" aria-label="状态栏">
      <span>{activeConnectionId ? `连接：${activeConnectionId}` : "未连接"}</span>
      <span>AI: BYOK</span>
    </footer>
  );
}
