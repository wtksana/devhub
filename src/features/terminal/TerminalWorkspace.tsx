import { TerminalTab } from "./TerminalTab";

interface TerminalWorkspaceProps {
  connectionId: string | null;
}

export function TerminalWorkspace({ connectionId }: TerminalWorkspaceProps) {
  if (!connectionId) {
    return <section>未选择连接</section>;
  }

  return (
    <section className="terminal-workspace">
      <TerminalTab connectionId={connectionId} />
    </section>
  );
}
