import { useRef, useState, type CSSProperties } from "react";
import { CommandPalette } from "./CommandPalette";
import { ContextMenu, type ContextMenuState } from "./ContextMenu";
import { DockPanel } from "./DockPanel";
import { StatusBar } from "./StatusBar";
import { WorkspaceTabs, type WorkspaceTabItem } from "./WorkspaceTabs";
import { ConnectionList } from "../features/connections/ConnectionList";
import { RedisWorkspace } from "../features/redis/RedisWorkspace";
import { SettingsPanel } from "../features/settings/SettingsPanel";
import type { RedisConnectionSettings } from "../features/settings/settingsTypes";
import { SftpWorkspace } from "../features/sftp/SftpWorkspace";
import { useSettings } from "../features/settings/useSettings";
import { TerminalWorkspace } from "../features/terminal/TerminalWorkspace";
import { I18nProvider } from "../i18n/I18nProvider";
import { useI18n } from "../i18n/useI18n";

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

interface RedisWorkspaceTab extends WorkspaceTabItem {
  kind: "redis";
  connectionId: string;
}

type AppWorkspaceTab = SettingsWorkspaceTab | TerminalWorkspaceTab | SftpWorkspaceTab | RedisWorkspaceTab;

function mergeConnectionGroups(groups: string[], group?: string) {
  const nextGroup = group?.trim();
  if (!nextGroup || groups.includes(nextGroup)) return groups;
  return [...groups, nextGroup];
}

function connectionTitle(connectionId: string, settings: ReturnType<typeof useSettings>["settings"], localTitle: string) {
  if (connectionId === "local") return localTitle;
  return settings.connections.find((connection) => connection.id === connectionId)?.name ?? connectionId;
}

function redisConnection(connectionId: string, settings: ReturnType<typeof useSettings>["settings"]): RedisConnectionSettings | null {
  const connection = settings.connections.find((item) => item.id === connectionId);
  return connection?.kind === "redis" ? connection : null;
}

export function AppShell() {
  const settingsState = useSettings();
  const { settings } = settingsState;

  return (
    <I18nProvider language={settings.appearance.language}>
      <AppShellContent settingsState={settingsState} />
    </I18nProvider>
  );
}

function AppShellContent({ settingsState }: { settingsState: ReturnType<typeof useSettings> }) {
  const { settings } = settingsState;
  const { t } = useI18n();
  const [workspaceTabs, setWorkspaceTabs] = useState<AppWorkspaceTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [isConnectionPanelVisible, setIsConnectionPanelVisible] = useState(true);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const nextWorkspaceTabSerialRef = useRef(1);
  const theme = settings.appearance.theme === "system" ? "dark" : settings.appearance.theme;
  const uiFontSize = settings.appearance.ui_font_size;
  const activeTab = workspaceTabs.find((tab) => tab.id === activeTabId) ?? workspaceTabs[workspaceTabs.length - 1] ?? null;
  const effectiveActiveTabId = activeTab?.id ?? null;
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
          title: connectionTitle(connectionId, settings, t("connections.local_terminal")),
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
            title: connectionTitle(connectionId, settings, t("connections.local_terminal")),
          },
        ];
      }

      const count = existingCount + 1;
      const tabId = `terminal:${connectionId}:${nextWorkspaceTabSerialRef.current++}`;
      const title = `${connectionTitle(connectionId, settings, t("connections.local_terminal"))} ${count}`;
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
          title: `${connectionTitle(connectionId, settings, t("connections.local_terminal"))} SFTP`,
        },
      ];
    });
    setActiveTabId(tabId);
  }

  function openRedisTab(connectionId: string) {
    const tabId = `redis:${connectionId}`;
    setWorkspaceTabs((tabs) => {
      if (tabs.some((tab) => tab.id === tabId)) return tabs;
      return [
        ...tabs,
        {
          id: tabId,
          kind: "redis",
          connectionId,
          title: connectionTitle(connectionId, settings, t("connections.type_redis")),
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
          title: t("app.settings"),
        },
      ];
    });
    setActiveTabId("settings");
  }

  function toggleTheme() {
    void settingsState.saveSettings({
      ...settings,
      appearance: {
        ...settings.appearance,
        theme: theme === "dark" ? "light" : "dark",
      },
    });
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
        { label: t("app.close"), onSelect: () => closeTab(tabId) },
        { label: t("app.close_others"), onSelect: () => closeTabs(workspaceTabs.filter((tab) => tab.id !== tabId).map((tab) => tab.id)) },
        {
          label: t("app.close_left"),
          onSelect: () => {
            const tabIndex = workspaceTabs.findIndex((tab) => tab.id === tabId);
            closeTabs(workspaceTabs.slice(0, tabIndex).map((tab) => tab.id));
          },
        },
        {
          label: t("app.close_right"),
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
        { label: t("app.open_settings"), onSelect: openSettingsTab },
        { label: t("app.show_connection_panel"), onSelect: () => setIsConnectionPanelVisible(true) },
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
        "--ui-font-family": settings.appearance.ui_font_family,
        "--ui-font-size": `${uiFontSize}px`,
        "--ui-font-size-small": `${Math.max(10, uiFontSize - 1)}px`,
        "--ui-font-size-large": `${uiFontSize + 2}px`,
        "--connection-sidebar-width": `${settings.layout.connection_sidebar_width}px`,
        "--terminal-font-family": settings.appearance.terminal_font_family,
        "--terminal-font-size": `${settings.appearance.terminal_font_size}px`,
      } as CSSProperties}
    >
      <CommandPalette onOpenSettings={openSettingsTab} onToggleTheme={toggleTheme} />
      <div className={bodyClassName}>
        {isConnectionPanelVisible ? (
          <DockPanel side="left" label={t("app.connections")}>
            <ConnectionList
              connections={settings.connections}
              connectionGroups={settings.connection_groups}
              onUpdateConnectionGroups={(connectionGroups) => {
                void settingsState.saveSettings({
                  ...settings,
                  connection_groups: connectionGroups,
                });
              }}
              onAddConnection={(connection) => {
                void settingsState.saveSettings({
                  ...settings,
                  connection_groups: mergeConnectionGroups(settings.connection_groups, connection.group),
                  connections: [...settings.connections, connection],
                });
              }}
              onUpdateConnection={(connection) => {
                void settingsState.saveSettings({
                  ...settings,
                  connection_groups: mergeConnectionGroups(settings.connection_groups, connection.group),
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
              onOpenRedis={(connectionId) => {
                openRedisTab(connectionId);
              }}
            />
          </DockPanel>
        ) : null}
        <section className="workspace" aria-label={t("app.workspace")}>
          <WorkspaceTabs
            tabs={workspaceTabs}
            activeTabId={effectiveActiveTabId}
            onSelect={setActiveTabId}
            onClose={closeTab}
            onContextMenu={openTabContextMenu}
          />
          {workspaceTabs.map((tab) => (
            <div
              key={tab.id}
              aria-hidden={effectiveActiveTabId !== tab.id}
              data-active={effectiveActiveTabId === tab.id}
              className="workspace-tab-panel"
            >
              {tab.kind === "terminal" ? (
                <TerminalWorkspace
                  connectionId={tab.connectionId}
                  fontFamily={settings.appearance.terminal_font_family}
                  fontSize={settings.appearance.terminal_font_size}
                  theme={theme}
                  isActive={effectiveActiveTabId === tab.id}
                  terminalSettings={settings.terminal}
                />
              ) : null}
              {tab.kind === "sftp" ? (
                <SftpWorkspace connectionId={tab.connectionId} sizeUnit={settings.sftp.file_size_unit} />
              ) : null}
              {tab.kind === "redis" ? (
                <RedisWorkspace
                  connectionId={tab.connectionId}
                  initialDatabase={redisConnection(tab.connectionId, settings)?.database ?? 0}
                />
              ) : null}
              {tab.kind === "settings" ? <SettingsPanel settingsState={settingsState} /> : null}
            </div>
          ))}
          {!activeTab ? (
            <section className="workspace-empty" onContextMenu={openEmptyWorkspaceContextMenu}>
              <h2>{t("app.no_tabs")}</h2>
              <p>{t("app.empty_workspace_hint")}</p>
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
