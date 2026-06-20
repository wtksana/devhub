import { TerminalTab } from "./TerminalTab";
import type { TerminalConnectionStatus } from "./TerminalTab";
import { useI18n } from "../../i18n/useI18n";
import type { TerminalSettings } from "../settings/settingsTypes";

interface TerminalWorkspaceProps {
  connectionId: string | null;
  fontFamily: string;
  fontSize: number;
  theme: "dark" | "light";
  isActive: boolean;
  terminalSettings: TerminalSettings;
  onStatusChange?: (status: TerminalConnectionStatus) => void;
}

export function TerminalWorkspace({ connectionId, fontFamily, fontSize, theme, isActive, terminalSettings, onStatusChange }: TerminalWorkspaceProps) {
  const { t } = useI18n();

  if (!connectionId) {
    return (
      <section className="workspace-empty">
        <h2>{t("terminal.no_connection")}</h2>
        <p>{t("terminal.no_connection_hint")}</p>
      </section>
    );
  }

  return (
    <section className="terminal-workspace">
      <TerminalTab
        connectionId={connectionId}
        fontFamily={fontFamily}
        fontSize={fontSize}
        theme={theme}
        isActive={isActive}
        terminalSettings={terminalSettings}
        onStatusChange={onStatusChange}
      />
    </section>
  );
}
