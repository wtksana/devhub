import { TerminalTab } from "./TerminalTab";

interface TerminalWorkspaceProps {
  connectionId: string | null;
  fontFamily: string;
  fontSize: number;
  theme: "dark" | "light";
  isActive: boolean;
}

export function TerminalWorkspace({ connectionId, fontFamily, fontSize, theme, isActive }: TerminalWorkspaceProps) {
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
      <TerminalTab connectionId={connectionId} fontFamily={fontFamily} fontSize={fontSize} theme={theme} isActive={isActive} />
    </section>
  );
}
