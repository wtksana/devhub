import { useEffect, useRef, useState, type CSSProperties } from "react";
import { CommandPalette } from "./CommandPalette";
import { ContextMenu, type ContextMenuState } from "./ContextMenu";
import { DockPanel } from "./DockPanel";
import { StatusBar } from "./StatusBar";
import { WorkspaceTabs, type WorkspaceTabItem } from "./WorkspaceTabs";
import { ConnectionList } from "../features/connections/ConnectionList";
import { DatabaseWorkspace } from "../features/database/DatabaseWorkspace";
import { RedisWorkspace } from "../features/redis/RedisWorkspace";
import { SettingsPanel } from "../features/settings/SettingsPanel";
import type { DatabaseConnectionSettings, RedisConnectionSettings } from "../features/settings/settingsTypes";
import { SftpWorkspace } from "../features/sftp/SftpWorkspace";
import { useSettings } from "../features/settings/useSettings";
import { TerminalWorkspace } from "../features/terminal/TerminalWorkspace";
import type { TerminalConnectionStatus } from "../features/terminal/TerminalTab";
import { I18nProvider } from "../i18n/I18nProvider";
import { useI18n } from "../i18n/useI18n";

interface SettingsWorkspaceTab extends WorkspaceTabItem {
  kind: "settings";
}

interface TerminalWorkspaceTab extends WorkspaceTabItem {
  kind: "terminal";
  connectionId: string;
  status?: TerminalConnectionStatus;
}

interface SftpWorkspaceTab extends WorkspaceTabItem {
  kind: "sftp";
  connectionId: string;
}

interface RedisWorkspaceTab extends WorkspaceTabItem {
  kind: "redis";
  connectionId: string;
}

interface DatabaseWorkspaceTab extends WorkspaceTabItem {
  kind: "database";
  connectionId: string;
}

type AppWorkspaceTab = SettingsWorkspaceTab | TerminalWorkspaceTab | SftpWorkspaceTab | RedisWorkspaceTab | DatabaseWorkspaceTab;

type WorkspaceSplitDirection = "horizontal" | "vertical";

interface WorkspacePane {
  id: string;
  tabs: AppWorkspaceTab[];
  activeTabId: string | null;
}

interface WorkspacePanePlacement {
  paneId: string;
  row: number;
  column: number;
  rowSpan: number;
  columnSpan: number;
}

const MIN_CONNECTION_SIDEBAR_WIDTH = 220;
const MAX_CONNECTION_SIDEBAR_WIDTH = 520;
const INITIAL_WORKSPACE_PANE_ID = "pane-1";

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

function databaseConnection(connectionId: string, settings: ReturnType<typeof useSettings>["settings"]): DatabaseConnectionSettings | null {
  const connection = settings.connections.find((item) => item.id === connectionId);
  return connection?.kind === "mysql" || connection?.kind === "postgresql" ? connection : null;
}

function createWorkspacePane(id: string, tabs: AppWorkspaceTab[] = []): WorkspacePane {
  return {
    id,
    tabs,
    activeTabId: tabs[tabs.length - 1]?.id ?? null,
  };
}

function paneActiveTab(pane: WorkspacePane | null | undefined) {
  if (!pane) return null;
  return pane.tabs.find((tab) => tab.id === pane.activeTabId) ?? pane.tabs[pane.tabs.length - 1] ?? null;
}

function createWorkspacePanePlacement(paneId: string): WorkspacePanePlacement {
  return {
    paneId,
    row: 0,
    column: 0,
    rowSpan: 1,
    columnSpan: 1,
  };
}

function compactPanePlacements(placements: WorkspacePanePlacement[]) {
  if (placements.length === 0) return placements;

  const usedRows = new Set<number>();
  const usedColumns = new Set<number>();
  placements.forEach((placement) => {
    for (let row = placement.row; row < placement.row + placement.rowSpan; row += 1) {
      usedRows.add(row);
    }
    for (let column = placement.column; column < placement.column + placement.columnSpan; column += 1) {
      usedColumns.add(column);
    }
  });

  const rowMap = new Map([...usedRows].sort((a, b) => a - b).map((row, index) => [row, index]));
  const columnMap = new Map([...usedColumns].sort((a, b) => a - b).map((column, index) => [column, index]));

  return placements.map((placement) => {
    const rows = Array.from({ length: placement.rowSpan }, (_, index) => rowMap.get(placement.row + index)).filter(
      (row): row is number => row !== undefined,
    );
    const columns = Array.from({ length: placement.columnSpan }, (_, index) => columnMap.get(placement.column + index)).filter(
      (column): column is number => column !== undefined,
    );
    return {
      ...placement,
      row: Math.min(...rows),
      column: Math.min(...columns),
      rowSpan: rows.length,
      columnSpan: columns.length,
    };
  });
}

function removePanePlacement(placements: WorkspacePanePlacement[], paneId: string) {
  const removed = placements.find((placement) => placement.paneId === paneId);
  if (!removed) return placements;

  const remaining = placements.filter((placement) => placement.paneId !== paneId);
  const verticalSibling = remaining.find(
    (placement) =>
      placement.column === removed.column &&
      placement.columnSpan === removed.columnSpan &&
      (placement.row + placement.rowSpan === removed.row || removed.row + removed.rowSpan === placement.row),
  );
  if (verticalSibling) {
    return compactPanePlacements(
      remaining.map((placement) =>
        placement.paneId === verticalSibling.paneId
          ? {
              ...placement,
              row: Math.min(placement.row, removed.row),
              rowSpan: placement.rowSpan + removed.rowSpan,
            }
          : placement,
      ),
    );
  }

  const horizontalSibling = remaining.find(
    (placement) =>
      placement.row === removed.row &&
      placement.rowSpan === removed.rowSpan &&
      (placement.column + placement.columnSpan === removed.column ||
        removed.column + removed.columnSpan === placement.column),
  );
  if (horizontalSibling) {
    return compactPanePlacements(
      remaining.map((placement) =>
        placement.paneId === horizontalSibling.paneId
          ? {
              ...placement,
              column: Math.min(placement.column, removed.column),
              columnSpan: placement.columnSpan + removed.columnSpan,
            }
          : placement,
      ),
    );
  }

  return compactPanePlacements(remaining);
}

function splitPanePlacements(
  placements: WorkspacePanePlacement[],
  paneId: string,
  newPaneId: string,
  direction: WorkspaceSplitDirection,
) {
  const target = placements.find((placement) => placement.paneId === paneId);
  if (!target) return [...placements, createWorkspacePanePlacement(newPaneId)];

  if (direction === "vertical") {
    if (target.columnSpan > 1) {
      const leftSpan = Math.ceil(target.columnSpan / 2);
      const rightSpan = target.columnSpan - leftSpan;
      return placements
        .map((placement) => (placement.paneId === paneId ? { ...placement, columnSpan: leftSpan } : placement))
        .concat({
          paneId: newPaneId,
          row: target.row,
          column: target.column + leftSpan,
          rowSpan: target.rowSpan,
          columnSpan: rightSpan,
        });
    }

    const insertedColumn = target.column + 1;
    return placements
      .map((placement) => {
        if (placement.paneId === paneId) return placement;
        if (placement.column >= insertedColumn) return { ...placement, column: placement.column + 1 };
        if (placement.column < insertedColumn && placement.column + placement.columnSpan > insertedColumn - 1) {
          return { ...placement, columnSpan: placement.columnSpan + 1 };
        }
        return placement;
      })
      .concat({
        paneId: newPaneId,
        row: target.row,
        column: insertedColumn,
        rowSpan: target.rowSpan,
        columnSpan: 1,
      });
  }

  if (target.rowSpan > 1) {
    const topSpan = Math.ceil(target.rowSpan / 2);
    const bottomSpan = target.rowSpan - topSpan;
    return placements
      .map((placement) => (placement.paneId === paneId ? { ...placement, rowSpan: topSpan } : placement))
      .concat({
        paneId: newPaneId,
        row: target.row + topSpan,
        column: target.column,
        rowSpan: bottomSpan,
        columnSpan: target.columnSpan,
      });
  }

  const insertedRow = target.row + 1;
  return placements
    .map((placement) => {
      if (placement.paneId === paneId) return placement;
      if (placement.row >= insertedRow) return { ...placement, row: placement.row + 1 };
      if (placement.row < insertedRow && placement.row + placement.rowSpan > insertedRow - 1) {
        return { ...placement, rowSpan: placement.rowSpan + 1 };
      }
      return placement;
    })
    .concat({
      paneId: newPaneId,
      row: insertedRow,
      column: target.column,
      rowSpan: 1,
      columnSpan: target.columnSpan,
    });
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
  const [workspacePanes, setWorkspacePanes] = useState<WorkspacePane[]>(() => [createWorkspacePane(INITIAL_WORKSPACE_PANE_ID)]);
  const [workspacePanePlacements, setWorkspacePanePlacements] = useState<WorkspacePanePlacement[]>(() => [
    createWorkspacePanePlacement(INITIAL_WORKSPACE_PANE_ID),
  ]);
  const [focusedPaneId, setFocusedPaneId] = useState(INITIAL_WORKSPACE_PANE_ID);
  const [isConnectionPanelVisible, setIsConnectionPanelVisible] = useState(true);
  const [connectionSidebarWidth, setConnectionSidebarWidth] = useState(settings.layout.connection_sidebar_width);
  const [isResizingConnectionPanel, setIsResizingConnectionPanel] = useState(false);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const nextWorkspaceTabSerialRef = useRef(1);
  const nextWorkspacePaneSerialRef = useRef(2);
  const connectionResizeRef = useRef({ startX: 0, startWidth: settings.layout.connection_sidebar_width });
  const theme = settings.appearance.theme === "system" ? "dark" : settings.appearance.theme;
  const uiFontSize = settings.appearance.ui_font_size;
  const focusedPane = workspacePanes.find((pane) => pane.id === focusedPaneId) ?? workspacePanes[0] ?? null;
  const activeTab = paneActiveTab(focusedPane);
  const panePlacementMap = new Map(workspacePanePlacements.map((placement) => [placement.paneId, placement]));
  const workspaceColumnCount = Math.max(
    1,
    ...workspacePanePlacements.map((placement) => placement.column + placement.columnSpan),
  );
  const workspaceRowCount = Math.max(1, ...workspacePanePlacements.map((placement) => placement.row + placement.rowSpan));
  const bodyClassName = [
    "app-shell__body",
    activeTab?.kind === "settings" ? "app-shell__body--settings" : "",
    !isConnectionPanelVisible ? "app-shell__body--no-connections" : "",
  ]
    .filter(Boolean)
    .join(" ");

  useEffect(() => {
    setConnectionSidebarWidth(settings.layout.connection_sidebar_width);
  }, [settings.layout.connection_sidebar_width]);

  useEffect(() => {
    if (!isResizingConnectionPanel) return;

    function handleMouseMove(event: MouseEvent) {
      const nextWidth = connectionResizeRef.current.startWidth + event.clientX - connectionResizeRef.current.startX;
      setConnectionSidebarWidth(clamp(nextWidth, MIN_CONNECTION_SIDEBAR_WIDTH, MAX_CONNECTION_SIDEBAR_WIDTH));
    }

    function handleMouseUp() {
      setIsResizingConnectionPanel(false);
    }

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isResizingConnectionPanel]);

  function startConnectionPanelResize(event: React.MouseEvent) {
    event.preventDefault();
    connectionResizeRef.current = {
      startX: event.clientX,
      startWidth: connectionSidebarWidth,
    };
    setIsResizingConnectionPanel(true);
  }

  function allWorkspaceTabs(panes = workspacePanes) {
    return panes.flatMap((pane) => pane.tabs);
  }

  function uniqueTabId(baseId: string, panes = workspacePanes) {
    const usedIds = new Set(allWorkspaceTabs(panes).map((tab) => tab.id));
    if (!usedIds.has(baseId)) return baseId;
    let nextId = `${baseId}:${nextWorkspaceTabSerialRef.current++}`;
    while (usedIds.has(nextId)) {
      nextId = `${baseId}:${nextWorkspaceTabSerialRef.current++}`;
    }
    return nextId;
  }

  function tabDuplicateCount(kind: AppWorkspaceTab["kind"], connectionId: string | null, panes = workspacePanes) {
    return allWorkspaceTabs(panes).filter((tab) => {
      if (tab.kind !== kind) return false;
      if (connectionId === null) return tab.kind === "settings";
      return "connectionId" in tab && tab.connectionId === connectionId;
    }).length;
  }

  function addTabToFocusedPane(tab: AppWorkspaceTab, reuseTabId?: string) {
    setWorkspacePanes((panes) =>
      panes.map((pane) => {
        if (pane.id !== focusedPaneId) return pane;
        if (reuseTabId && pane.tabs.some((item) => item.id === reuseTabId)) {
          return { ...pane, activeTabId: reuseTabId };
        }
        return {
          ...pane,
          tabs: [...pane.tabs, tab],
          activeTabId: tab.id,
        };
      }),
    );
    setFocusedPaneId(focusedPaneId);
  }

  function openTerminalTab(connectionId: string) {
    const focused = workspacePanes.find((pane) => pane.id === focusedPaneId);
    const baseId = `terminal:${connectionId}`;
    if (focused?.tabs.some((tab) => tab.id === baseId)) {
      addTabToFocusedPane({
        id: baseId,
        kind: "terminal",
        connectionId,
        title: connectionTitle(connectionId, settings, t("connections.local_terminal")),
        status: "connecting",
      }, baseId);
      return;
    }
    const tabId = uniqueTabId(baseId);
    const count = tabDuplicateCount("terminal", connectionId);
    addTabToFocusedPane({
      id: tabId,
      kind: "terminal",
      connectionId,
      title: count === 0 ? connectionTitle(connectionId, settings, t("connections.local_terminal")) : `${connectionTitle(connectionId, settings, t("connections.local_terminal"))} ${count + 1}`,
      status: "connecting",
    });
  }

  function openNewTerminalTab(connectionId: string) {
    const existingCount = tabDuplicateCount("terminal", connectionId);
    if (existingCount === 0) {
      openTerminalTab(connectionId);
      return;
    }

    const tabId = uniqueTabId(`terminal:${connectionId}`);
    addTabToFocusedPane({
      id: tabId,
      kind: "terminal",
      connectionId,
      title: `${connectionTitle(connectionId, settings, t("connections.local_terminal"))} ${existingCount + 1}`,
      status: "connecting",
    });
  }

  function updateTerminalStatus(tabId: string, status: TerminalConnectionStatus) {
    setWorkspacePanes((panes) =>
      panes.map((pane) => ({
        ...pane,
        tabs: pane.tabs.map((tab) => (tab.id === tabId && tab.kind === "terminal" ? { ...tab, status } : tab)),
      })),
    );
  }

  function openSftpTab(connectionId: string) {
    const focused = workspacePanes.find((pane) => pane.id === focusedPaneId);
    const baseId = `sftp:${connectionId}`;
    if (focused?.tabs.some((tab) => tab.id === baseId)) {
      addTabToFocusedPane({
        id: baseId,
        kind: "sftp",
        connectionId,
        title: `${connectionTitle(connectionId, settings, t("connections.local_terminal"))} SFTP`,
      }, baseId);
      return;
    }
    const count = tabDuplicateCount("sftp", connectionId);
    addTabToFocusedPane({
      id: uniqueTabId(baseId),
      kind: "sftp",
      connectionId,
      title: count === 0 ? `${connectionTitle(connectionId, settings, t("connections.local_terminal"))} SFTP` : `${connectionTitle(connectionId, settings, t("connections.local_terminal"))} SFTP ${count + 1}`,
    });
  }

  function openRedisTab(connectionId: string) {
    const focused = workspacePanes.find((pane) => pane.id === focusedPaneId);
    const baseId = `redis:${connectionId}`;
    if (focused?.tabs.some((tab) => tab.id === baseId)) {
      addTabToFocusedPane({
        id: baseId,
        kind: "redis",
        connectionId,
        title: connectionTitle(connectionId, settings, t("connections.type_redis")),
      }, baseId);
      return;
    }
    const count = tabDuplicateCount("redis", connectionId);
    addTabToFocusedPane({
      id: uniqueTabId(baseId),
      kind: "redis",
      connectionId,
      title: count === 0 ? connectionTitle(connectionId, settings, t("connections.type_redis")) : `${connectionTitle(connectionId, settings, t("connections.type_redis"))} ${count + 1}`,
    });
  }

  function openDatabaseTab(connectionId: string) {
    const focused = workspacePanes.find((pane) => pane.id === focusedPaneId);
    const baseId = `database:${connectionId}`;
    if (focused?.tabs.some((tab) => tab.id === baseId)) {
      addTabToFocusedPane({
        id: baseId,
        kind: "database",
        connectionId,
        title: connectionTitle(connectionId, settings, t("database.workspace")),
      }, baseId);
      return;
    }
    const count = tabDuplicateCount("database", connectionId);
    addTabToFocusedPane({
      id: uniqueTabId(baseId),
      kind: "database",
      connectionId,
      title: count === 0 ? connectionTitle(connectionId, settings, t("database.workspace")) : `${connectionTitle(connectionId, settings, t("database.workspace"))} ${count + 1}`,
    });
  }

  function openSettingsTab() {
    const focused = workspacePanes.find((pane) => pane.id === focusedPaneId);
    const existingSettingsTab = focused?.tabs.find((tab) => tab.kind === "settings");
    if (existingSettingsTab) {
      addTabToFocusedPane({ id: existingSettingsTab.id, kind: "settings", title: t("app.settings") }, existingSettingsTab.id);
      return;
    }
    addTabToFocusedPane({
      id: uniqueTabId("settings"),
      kind: "settings",
      title: t("app.settings"),
    });
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

  function closeTabsInPane(paneId: string, tabIds: string[]) {
    setWorkspacePanes((panes) => {
      const pane = panes.find((item) => item.id === paneId);
      if (!pane) return panes;
      const nextTabs = pane.tabs.filter((tab) => !tabIds.includes(tab.id));
      if (nextTabs.length === 0 && panes.length > 1) {
        const nextPanes = panes.filter((item) => item.id !== paneId);
        const nextFocusedPaneId = nextPanes[nextPanes.length - 1]?.id ?? INITIAL_WORKSPACE_PANE_ID;
        setWorkspacePanePlacements((placements) => removePanePlacement(placements, paneId));
        setFocusedPaneId(nextFocusedPaneId);
        return nextPanes;
      }

      return panes.map((item) => {
        if (item.id !== paneId) return item;
        const activeStillOpen = item.activeTabId ? nextTabs.some((tab) => tab.id === item.activeTabId) : false;
        return {
          ...item,
          tabs: nextTabs,
          activeTabId: activeStillOpen ? item.activeTabId : nextTabs[nextTabs.length - 1]?.id ?? null,
        };
      });
    });
  }

  function closeTab(paneId: string, tabId: string) {
    closeTabsInPane(paneId, [tabId]);
  }

  function closeTabs(paneId: string, tabIds: string[]) {
    closeTabsInPane(paneId, tabIds);
  }

  function cloneTabForSplit(tab: AppWorkspaceTab) {
    if (tab.kind === "terminal") {
      const count = tabDuplicateCount("terminal", tab.connectionId);
      const title = connectionTitle(tab.connectionId, settings, t("connections.local_terminal"));
      return {
        ...tab,
        id: uniqueTabId(`terminal:${tab.connectionId}`),
        title: count === 0 ? title : `${title} ${count + 1}`,
        status: "connecting" as TerminalConnectionStatus,
      };
    }
    if (tab.kind === "sftp") {
      const count = tabDuplicateCount("sftp", tab.connectionId);
      const title = `${connectionTitle(tab.connectionId, settings, t("connections.local_terminal"))} SFTP`;
      return {
        ...tab,
        id: uniqueTabId(`sftp:${tab.connectionId}`),
        title: count === 0 ? title : `${title} ${count + 1}`,
      };
    }
    if (tab.kind === "redis") {
      const count = tabDuplicateCount("redis", tab.connectionId);
      const title = connectionTitle(tab.connectionId, settings, t("connections.type_redis"));
      return {
        ...tab,
        id: uniqueTabId(`redis:${tab.connectionId}`),
        title: count === 0 ? title : `${title} ${count + 1}`,
      };
    }
    if (tab.kind === "database") {
      const count = tabDuplicateCount("database", tab.connectionId);
      const title = connectionTitle(tab.connectionId, settings, t("database.workspace"));
      return {
        ...tab,
        id: uniqueTabId(`database:${tab.connectionId}`),
        title: count === 0 ? title : `${title} ${count + 1}`,
      };
    }
    return {
      ...tab,
      id: uniqueTabId("settings"),
      title: t("app.settings"),
    };
  }

  function splitTab(paneId: string, tabId: string, direction: WorkspaceSplitDirection) {
    const pane = workspacePanes.find((item) => item.id === paneId);
    const tab = pane?.tabs.find((item) => item.id === tabId);
    if (!tab) return;
    const newPaneId = `pane-${nextWorkspacePaneSerialRef.current++}`;
    const newTab = cloneTabForSplit(tab);
    setWorkspacePanes((panes) => [...panes, createWorkspacePane(newPaneId, [newTab])]);
    setWorkspacePanePlacements((placements) => splitPanePlacements(placements, paneId, newPaneId, direction));
    setFocusedPaneId(newPaneId);
  }

  function openTabContextMenu(event: React.MouseEvent, paneId: string, tabId: string) {
    event.preventDefault();
    const pane = workspacePanes.find((item) => item.id === paneId);
    const paneTabs = pane?.tabs ?? [];
    setContextMenu({
      x: event.clientX,
      y: event.clientY,
      items: [
        { label: t("app.split_right"), onSelect: () => splitTab(paneId, tabId, "vertical") },
        { label: t("app.split_down"), onSelect: () => splitTab(paneId, tabId, "horizontal") },
        { type: "separator" },
        { label: t("app.close"), onSelect: () => closeTab(paneId, tabId) },
        { label: t("app.close_others"), onSelect: () => closeTabs(paneId, paneTabs.filter((tab) => tab.id !== tabId).map((tab) => tab.id)) },
        {
          label: t("app.close_left"),
          onSelect: () => {
            const tabIndex = paneTabs.findIndex((tab) => tab.id === tabId);
            closeTabs(paneId, paneTabs.slice(0, tabIndex).map((tab) => tab.id));
          },
        },
        {
          label: t("app.close_right"),
          onSelect: () => {
            const tabIndex = paneTabs.findIndex((tab) => tab.id === tabId);
            closeTabs(paneId, paneTabs.slice(tabIndex + 1).map((tab) => tab.id));
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

  function renderTabPanel(pane: WorkspacePane, tab: AppWorkspaceTab, effectiveActiveTabId: string | null) {
    const panePlacement = panePlacementMap.get(pane.id) ?? createWorkspacePanePlacement(pane.id);
    const paneLayoutVersion = `${panePlacement.row}:${panePlacement.column}:${panePlacement.rowSpan}:${panePlacement.columnSpan}`;
    return (
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
            isActive={focusedPaneId === pane.id && effectiveActiveTabId === tab.id}
            isVisible={effectiveActiveTabId === tab.id}
            layoutVersion={paneLayoutVersion}
            terminalSettings={settings.terminal}
            onStatusChange={(status) => updateTerminalStatus(tab.id, status)}
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
        {tab.kind === "database" ? (
          <DatabaseWorkspace
            connectionId={tab.connectionId}
            initialDatabase={databaseConnection(tab.connectionId, settings)?.database}
            theme={theme}
            fontFamily={settings.appearance.terminal_font_family}
            fontSize={settings.appearance.terminal_font_size}
          />
        ) : null}
        {tab.kind === "settings" ? <SettingsPanel settingsState={settingsState} /> : null}
      </div>
    );
  }

  function renderWorkspacePane(paneId: string) {
    const pane = workspacePanes.find((item) => item.id === paneId) ?? createWorkspacePane(paneId);
    const paneIndex = workspacePanes.findIndex((item) => item.id === paneId) + 1;
    const panePlacement = panePlacementMap.get(paneId) ?? createWorkspacePanePlacement(paneId);
    const activePaneTab = paneActiveTab(pane);
    const effectiveActiveTabId = activePaneTab?.id ?? null;
    return (
      <section
        key={paneId}
        className="workspace-pane"
        data-focused={focusedPaneId === paneId}
        aria-label={t("app.workspace_pane", { index: paneIndex })}
        onMouseDown={() => setFocusedPaneId(paneId)}
        style={{
          gridColumn: `${panePlacement.column + 1} / span ${panePlacement.columnSpan}`,
          gridRow: `${panePlacement.row + 1} / span ${panePlacement.rowSpan}`,
        }}
      >
        <WorkspaceTabs
          tabs={pane.tabs}
          activeTabId={effectiveActiveTabId}
          onSelect={(tabId) => {
            setFocusedPaneId(paneId);
            setWorkspacePanes((panes) =>
              panes.map((item) => (item.id === paneId ? { ...item, activeTabId: tabId } : item)),
            );
          }}
          onClose={(tabId) => closeTab(paneId, tabId)}
          onContextMenu={(event, tabId) => openTabContextMenu(event, paneId, tabId)}
        />
        {pane.tabs.map((tab) => renderTabPanel(pane, tab, effectiveActiveTabId))}
        {!activePaneTab ? (
          <section className="workspace-empty" onContextMenu={openEmptyWorkspaceContextMenu}>
            <h2>{t("app.no_tabs")}</h2>
            <p>{t("app.empty_workspace_hint")}</p>
          </section>
        ) : null}
      </section>
    );
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
        "--connection-sidebar-width": `${connectionSidebarWidth}px`,
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
              onOpenDatabase={(connectionId) => {
                openDatabaseTab(connectionId);
              }}
            />
          </DockPanel>
        ) : null}
        {isConnectionPanelVisible ? (
          <div
            role="separator"
            aria-label="调整连接面板宽度"
            aria-orientation="vertical"
            className="panel-resize-handle panel-resize-handle--connection"
            onMouseDown={startConnectionPanelResize}
          />
        ) : null}
        <section className="workspace" aria-label={t("app.workspace")}>
          <div
            className="workspace-root"
            style={{
              "--workspace-pane-columns": workspaceColumnCount,
              "--workspace-pane-rows": workspaceRowCount,
            } as CSSProperties}
          >
            {workspacePanes.map((pane) => renderWorkspacePane(pane.id))}
          </div>
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

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
