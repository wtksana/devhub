import { useState, type CSSProperties } from "react";
import { CommandPalette } from "./CommandPalette";
import { ContextMenu, type ContextMenuState } from "./ContextMenu";
import { DockPanel } from "./DockPanel";
import { StatusBar } from "./StatusBar";
import { WorkspaceTabs, type WorkspaceTabItem } from "./WorkspaceTabs";
import { ConnectionList } from "../features/connections/ConnectionList";
import { SettingsPanel } from "../features/settings/SettingsPanel";
import { SftpWorkspace } from "../features/sftp/SftpWorkspace";
import { useSettings } from "../features/settings/useSettings";
import { TerminalWorkspace } from "../features/terminal/TerminalWorkspace";

interface SettingsWorkspaceTab extends WorkspaceTabItem {
  kind: "settings";
}

interface TerminalWorkspaceTab extends WorkspaceTabItem {
  kind: "terminal";
  connectionId: string;
}

interface SftpWorkspaceTab extends WorkspaceTabItem {
  kind: "sftp";
  connectionId: string;
}

type AppWorkspaceTab = SettingsWorkspaceTab | TerminalWorkspaceTab | SftpWorkspaceTab;

function connectionTitle(connectionId: string, settings: ReturnType<typeof useSettings>["settings"]) {
  if (connectionId === "local") return "本地终端";
  return settings.connections.find((connection) => connection.id === connectionId)?.name ?? connectionId;
}

export function AppShell() {
  const settingsState = useSettings();
  const { settings } = settingsState;
  const [workspaceTabs, setWorkspaceTabs] = useState<AppWorkspaceTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [isConnectionPanelVisible, setIsConnectionPanelVisible] = useState(true);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const theme = settings.appearance.theme === "system" ? "dark" : settings.appearance.theme;
  const uiFontSize = settings.appearance.ui_font_size;
  const activeTab = workspaceTabs.find((tab) => tab.id === activeTabId) ?? null;
  const bodyClassName = [
    "app-shell__body",
    activeTab?.kind === "settings" ? "app-shell__body--settings" : "",
    !isConnectionPanelVisible ? "app-shell__body--no-connections" : "",
  ]
    .filter(Boolean)
    .join(" ");

  function openTerminalTab(connectionId: string) {
    const tabId = `terminal:${connectionId}`;
    setWorkspaceTabs((tabs) => {
      if (tabs.some((tab) => tab.id === tabId)) return tabs;
      return [
        ...tabs,
        {
          id: tabId,
          kind: "terminal",
          connectionId,
          title: connectionTitle(connectionId, settings),
        },
      ];
    });
    setActiveTabId(tabId);
  }

  function openNewTerminalTab(connectionId: string) {
    setWorkspaceTabs((tabs) => {
      const existingCount = tabs.filter((tab) => tab.kind === "terminal" && tab.connectionId === connectionId).length;
      if (existingCount === 0) {
        const tabId = `terminal:${connectionId}`;
        setActiveTabId(tabId);
        return [
          ...tabs,
          {
            id: tabId,
            kind: "terminal",
            connectionId,
            title: connectionTitle(connectionId, settings),
          },
        ];
      }

      const count = existingCount + 1;
      const tabId = `terminal:${connectionId}:${Date.now()}`;
      const title = `${connectionTitle(connectionId, settings)} ${count}`;
      setActiveTabId(tabId);
      return [
        ...tabs,
        {
          id: tabId,
          kind: "terminal",
          connectionId,
          title,
        },
      ];
    });
  }

  function openSftpTab(connectionId: string) {
    const tabId = `sftp:${connectionId}`;
    setWorkspaceTabs((tabs) => {
      if (tabs.some((tab) => tab.id === tabId)) return tabs;
      return [
        ...tabs,
        {
          id: tabId,
          kind: "sftp",
          connectionId,
          title: `${connectionTitle(connectionId, settings)} SFTP`,
        },
      ];
    });
    setActiveTabId(tabId);
  }

  function openSettingsTab() {
    setWorkspaceTabs((tabs) => {
      if (tabs.some((tab) => tab.id === "settings")) return tabs;
      return [
        ...tabs,
        {
          id: "settings",
          kind: "settings",
          title: "设置",
        },
      ];
    });
    setActiveTabId("settings");
  }

  function closeTab(tabId: string) {
    setWorkspaceTabs((tabs) => {
      const nextTabs = tabs.filter((tab) => tab.id !== tabId);
      if (activeTabId === tabId) {
        setActiveTabId(nextTabs[nextTabs.length - 1]?.id ?? null);
      }
      return nextTabs;
    });
  }

  function closeTabs(tabIds: string[]) {
    setWorkspaceTabs((tabs) => {
      const nextTabs = tabs.filter((tab) => !tabIds.includes(tab.id));
      if (activeTabId && tabIds.includes(activeTabId)) {
        setActiveTabId(nextTabs[nextTabs.length - 1]?.id ?? null);
      }
      return nextTabs;
    });
  }

  function openTabContextMenu(event: React.MouseEvent, tabId: string) {
    event.preventDefault();
    setContextMenu({
      x: event.clientX,
      y: event.clientY,
      items: [
        { label: "关闭", onSelect: () => closeTab(tabId) },
        { label: "关闭其他", onSelect: () => closeTabs(workspaceTabs.filter((tab) => tab.id !== tabId).map((tab) => tab.id)) },
        {
          label: "关闭左侧",
          onSelect: () => {
            const tabIndex = workspaceTabs.findIndex((tab) => tab.id === tabId);
            closeTabs(workspaceTabs.slice(0, tabIndex).map((tab) => tab.id));
          },
        },
        {
          label: "关闭右侧",
          onSelect: () => {
            const tabIndex = workspaceTabs.findIndex((tab) => tab.id === tabId);
            closeTabs(workspaceTabs.slice(tabIndex + 1).map((tab) => tab.id));
          },
        },
      ],
    });
  }

  function openEmptyWorkspaceContextMenu(event: React.MouseEvent) {
    event.preventDefault();
    setContextMenu({
      x: event.clientX,
      y: event.clientY,
      items: [
        { label: "打开设置", onSelect: openSettingsTab },
        { label: "显示连接面板", onSelect: () => setIsConnectionPanelVisible(true) },
      ],
    });
  }

  return (
    <main
      className="app-shell"
      data-theme={theme}
      onContextMenu={(event) => event.preventDefault()}
      style={{
        fontFamily: settings.appearance.ui_font_family,
        fontSize: `${uiFontSize}px`,
        "--ui-font-size": `${uiFontSize}px`,
        "--ui-font-size-small": `${Math.max(10, uiFontSize - 1)}px`,
        "--ui-font-size-large": `${uiFontSize + 2}px`,
        "--connection-sidebar-width": `${settings.layout.connection_sidebar_width}px`,
        "--terminal-font-family": settings.appearance.terminal_font_family,
        "--terminal-font-size": `${settings.appearance.terminal_font_size}px`,
      } as CSSProperties}
    >
      <CommandPalette onOpenSettings={openSettingsTab} />
      <div className={bodyClassName}>
        {isConnectionPanelVisible ? (
          <DockPanel side="left" label="连接列表">
            <ConnectionList
              connections={settings.connections}
              onAddConnection={(connection) => {
                void settingsState.saveSettings({
                  ...settings,
                  connections: [...settings.connections, connection],
                });
              }}
              onUpdateConnection={(connection) => {
                void settingsState.saveSettings({
                  ...settings,
                  connections: settings.connections.map((item) => (item.id === connection.id ? connection : item)),
                });
              }}
              onOpenTerminal={(connectionId) => {
                openTerminalTab(connectionId);
              }}
              onOpenNewTerminal={(connectionId) => {
                openNewTerminalTab(connectionId);
              }}
              onOpenSftp={(connectionId) => {
                openSftpTab(connectionId);
              }}
            />
          </DockPanel>
        ) : null}
        <section className="workspace" aria-label="工作区">
          <WorkspaceTabs
            tabs={workspaceTabs}
            activeTabId={activeTabId}
            onSelect={setActiveTabId}
            onClose={closeTab}
            onContextMenu={openTabContextMenu}
          />
          {workspaceTabs.map((tab) => (
            <div key={tab.id} hidden={activeTabId !== tab.id} className="workspace-tab-panel">
              {tab.kind === "terminal" ? (
                <TerminalWorkspace
                  connectionId={tab.connectionId}
                  fontFamily={settings.appearance.terminal_font_family}
                  fontSize={settings.appearance.terminal_font_size}
                  theme={theme}
                  isActive={activeTabId === tab.id}
                />
              ) : null}
              {tab.kind === "sftp" ? <SftpWorkspace connectionId={tab.connectionId} /> : null}
              {tab.kind === "settings" ? <SettingsPanel settingsState={settingsState} /> : null}
            </div>
          ))}
          {!activeTab ? (
            <section className="workspace-empty" onContextMenu={openEmptyWorkspaceContextMenu}>
              <h2>未打开标签</h2>
              <p>请从左侧连接列表打开终端。</p>
            </section>
          ) : null}
        </section>
      </div>
      <StatusBar
        isConnectionPanelVisible={isConnectionPanelVisible}
        onToggleConnectionPanel={() => setIsConnectionPanelVisible((visible) => !visible)}
      />
      <ContextMenu menu={contextMenu} onClose={() => setContextMenu(null)} />
    </main>
  );
}
