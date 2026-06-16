import { TerminalTab } from "./TerminalTab";

interface TerminalWorkspaceProps {
  connectionId: string | null;
}

export function TerminalWorkspace({ connectionId }: TerminalWorkspaceProps) {
  if (!connectionId) {
    return (
      <section className="workspace-empty">
        <h2>未选择连接</h2>
        <p>请先在左侧连接列表中打开终端。</p>
      </section>
    );
  }

  return (
    <section className="terminal-workspace">
      <TerminalTab connectionId={connectionId} />
    </section>
  );
}
