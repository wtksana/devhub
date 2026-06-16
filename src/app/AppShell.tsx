import { useState } from "react";
import { CommandPalette } from "./CommandPalette";
import { DockPanel } from "./DockPanel";
import { StatusBar } from "./StatusBar";
import { WorkspaceTabs } from "./WorkspaceTabs";
import { AiPanel } from "../features/ai/AiPanel";
import { ConnectionList } from "../features/connections/ConnectionList";
import { SettingsPanel } from "../features/settings/SettingsPanel";
import { useSettings } from "../features/settings/useSettings";
import { SftpWorkspace } from "../features/sftp/SftpWorkspace";
import { TerminalWorkspace } from "../features/terminal/TerminalWorkspace";

type Workspace = "terminal" | "sftp" | "settings";

export function AppShell() {
  const { settings } = useSettings();
  const [workspace, setWorkspace] = useState<Workspace>("settings");
  const [activeConnectionId, setActiveConnectionId] = useState<string | null>(null);

  return (
    <main className="app-shell">
      <CommandPalette onOpenSettings={() => setWorkspace("settings")} />
      <div className="app-shell__body">
        <DockPanel side="left" label="连接列表">
          <ConnectionList
            connections={settings.connections}
            onOpenTerminal={(connectionId) => {
              setActiveConnectionId(connectionId);
              setWorkspace("terminal");
            }}
            onOpenSftp={(connectionId) => {
              setActiveConnectionId(connectionId);
              setWorkspace("sftp");
            }}
          />
        </DockPanel>
        <section className="workspace" aria-label="工作区">
          <WorkspaceTabs active={workspace} onSelect={setWorkspace} />
          {workspace === "terminal" ? <TerminalWorkspace connectionId={activeConnectionId} /> : null}
          {workspace === "sftp" ? <SftpWorkspace connectionId={activeConnectionId} /> : null}
          {workspace === "settings" ? <SettingsPanel /> : null}
        </section>
        <DockPanel side="right" label="AI 面板">
          <AiPanel />
        </DockPanel>
      </div>
      <StatusBar activeConnectionId={activeConnectionId} />
    </main>
  );
}
