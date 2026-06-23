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

interface WorkspacePaneLayoutNode {
  type: "pane";
  paneId: string;
}

interface WorkspaceSplitLayoutNode {
  type: "split";
  id: string;
  direction: WorkspaceSplitDirection;
  sizes: number[];
  children: WorkspaceLayoutNode[];
}

type WorkspaceLayoutNode = WorkspacePaneLayoutNode | WorkspaceSplitLayoutNode;

interface WorkspaceResizeState {
  splitId: string;
  direction: WorkspaceSplitDirection;
  index: number;
  startPointer: number;
  startSizes: number[];
}

interface WorkspaceLayoutBounds {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface WorkspacePaneGeometry extends WorkspaceLayoutBounds {
  paneId: string;
  path: string;
}

interface WorkspaceResizeHandleGeometry extends WorkspaceLayoutBounds {
  splitId: string;
  direction: WorkspaceSplitDirection;
  index: number;
  sizes: number[];
}

const MIN_CONNECTION_SIDEBAR_WIDTH = 220;
const MAX_CONNECTION_SIDEBAR_WIDTH = 520;
const INITIAL_WORKSPACE_PANE_ID = "pane-1";
const MIN_WORKSPACE_PANE_FR = 0.25;
const WORKSPACE_RESIZE_STEP_PX = 500;

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

function createWorkspaceLayout(paneId: string): WorkspaceLayoutNode {
  return { type: "pane", paneId };
}

function normalizeWorkspaceTrackSizes(sizes: number[], count: number) {
  if (sizes.length > count) {
    return Array.from({ length: count }, () => 1);
  }
  return Array.from({ length: count }, (_, index) => sizes[index] ?? 1);
}

function splitWorkspaceLayout(
  node: WorkspaceLayoutNode,
  paneId: string,
  newPaneId: string,
  newSplitId: string,
  direction: WorkspaceSplitDirection,
): WorkspaceLayoutNode {
  if (node.type === "pane") {
    if (node.paneId !== paneId) return node;
    return {
      type: "split",
      id: newSplitId,
      direction,
      sizes: [1, 1],
      children: [node, createWorkspaceLayout(newPaneId)],
    };
  }

  const directPaneIndex = node.children.findIndex((child) => child.type === "pane" && child.paneId === paneId);
  if (directPaneIndex >= 0) {
    if (node.direction === direction) {
      const nextChildren = [...node.children];
      nextChildren.splice(directPaneIndex + 1, 0, createWorkspaceLayout(newPaneId));
      const nextSizes = [...normalizeWorkspaceTrackSizes(node.sizes, node.children.length)];
      nextSizes.splice(directPaneIndex + 1, 0, 1);
      return { ...node, children: nextChildren, sizes: nextSizes };
    }

    const nextChildren = [...node.children];
    nextChildren[directPaneIndex] = {
      type: "split",
      id: newSplitId,
      direction,
      sizes: [1, 1],
      children: [node.children[directPaneIndex], createWorkspaceLayout(newPaneId)],
    };
    return { ...node, children: nextChildren };
  }

  return {
    ...node,
    children: node.children.map((child) => splitWorkspaceLayout(child, paneId, newPaneId, newSplitId, direction)),
  };
}

function removePaneFromWorkspaceLayout(node: WorkspaceLayoutNode, paneId: string): WorkspaceLayoutNode | null {
  if (node.type === "pane") {
    return node.paneId === paneId ? null : node;
  }

  const nextChildren: WorkspaceLayoutNode[] = [];
  const nextSizes: number[] = [];
  const currentSizes = normalizeWorkspaceTrackSizes(node.sizes, node.children.length);
  node.children.forEach((child, index) => {
    const nextChild = removePaneFromWorkspaceLayout(child, paneId);
    if (!nextChild) return;
    nextChildren.push(nextChild);
    nextSizes.push(currentSizes[index] ?? 1);
  });

  if (nextChildren.length === 0) return null;
  if (nextChildren.length === 1) return nextChildren[0];
  return { ...node, children: nextChildren, sizes: normalizeWorkspaceTrackSizes(nextSizes, nextChildren.length) };
}

function updateWorkspaceSplitSizes(node: WorkspaceLayoutNode, splitId: string, sizes: number[]): WorkspaceLayoutNode {
  if (node.type === "pane") return node;
  if (node.id === splitId) {
    return { ...node, sizes: normalizeWorkspaceTrackSizes(sizes, node.children.length) };
  }
  return {
    ...node,
    children: node.children.map((child) => updateWorkspaceSplitSizes(child, splitId, sizes)),
  };
}

function buildWorkspaceLayoutGeometry(
  node: WorkspaceLayoutNode,
  bounds: WorkspaceLayoutBounds = { left: 0, top: 0, width: 100, height: 100 },
  path = "root",
) {
  if (node.type === "pane") {
    return {
      panes: [{ paneId: node.paneId, path, ...bounds }],
      handles: [],
    } satisfies { panes: WorkspacePaneGeometry[]; handles: WorkspaceResizeHandleGeometry[] };
  }

  const sizes = normalizeWorkspaceTrackSizes(node.sizes, node.children.length);
  const totalSize = sizes.reduce((total, size) => total + size, 0) || 1;
  const panes: WorkspacePaneGeometry[] = [];
  const handles: WorkspaceResizeHandleGeometry[] = [];
  let offset = 0;

  node.children.forEach((child, index) => {
    const ratio = sizes[index] / totalSize;
    const childBounds =
      node.direction === "vertical"
        ? {
            left: bounds.left + bounds.width * offset,
            top: bounds.top,
            width: bounds.width * ratio,
            height: bounds.height,
          }
        : {
            left: bounds.left,
            top: bounds.top + bounds.height * offset,
            width: bounds.width,
            height: bounds.height * ratio,
          };
    const childGeometry = buildWorkspaceLayoutGeometry(child, childBounds, `${path}/${node.id}:${index}`);
    panes.push(...childGeometry.panes);
    handles.push(...childGeometry.handles);
    offset += ratio;

    if (index < node.children.length - 1) {
      handles.push({
        splitId: node.id,
        direction: node.direction,
        index,
        sizes,
        left: node.direction === "vertical" ? bounds.left + bounds.width * offset : bounds.left,
        top: node.direction === "vertical" ? bounds.top : bounds.top + bounds.height * offset,
        width: node.direction === "vertical" ? 0 : bounds.width,
        height: node.direction === "vertical" ? bounds.height : 0,
      });
    }
  });

  return { panes, handles };
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
  const [workspaceLayout, setWorkspaceLayout] = useState<WorkspaceLayoutNode>(() => createWorkspaceLayout(INITIAL_WORKSPACE_PANE_ID));
  const [focusedPaneId, setFocusedPaneId] = useState(INITIAL_WORKSPACE_PANE_ID);
  const [isConnectionPanelVisible, setIsConnectionPanelVisible] = useState(true);
  const [connectionSidebarWidth, setConnectionSidebarWidth] = useState(settings.layout.connection_sidebar_width);
  const [isResizingConnectionPanel, setIsResizingConnectionPanel] = useState(false);
  const [workspaceResizeState, setWorkspaceResizeState] = useState<WorkspaceResizeState | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const nextWorkspaceTabSerialRef = useRef(1);
  const nextWorkspacePaneSerialRef = useRef(2);
  const nextWorkspaceSplitSerialRef = useRef(1);
  const connectionResizeRef = useRef({ startX: 0, startWidth: settings.layout.connection_sidebar_width });
  const theme = settings.appearance.theme === "system" ? "dark" : settings.appearance.theme;
  const uiFontSize = settings.appearance.ui_font_size;
  const focusedPane = workspacePanes.find((pane) => pane.id === focusedPaneId) ?? workspacePanes[0] ?? null;
  const activeTab = paneActiveTab(focusedPane);
  const workspaceLayoutVersion = JSON.stringify(workspaceLayout);
  const workspaceLayoutGeometry = buildWorkspaceLayoutGeometry(workspaceLayout);
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

  useEffect(() => {
    if (!workspaceResizeState) return;
    const resizeState = workspaceResizeState;

    function handleMouseMove(event: MouseEvent) {
      const pointer = resizeState.direction === "vertical" ? event.clientX : event.clientY;
      const delta = (pointer - resizeState.startPointer) / WORKSPACE_RESIZE_STEP_PX;
      const nextSizes = [...resizeState.startSizes];
      const leftSize = resizeState.startSizes[resizeState.index] ?? 1;
      const rightSize = resizeState.startSizes[resizeState.index + 1] ?? 1;
      const nextLeftSize = clamp(leftSize + delta, MIN_WORKSPACE_PANE_FR, leftSize + rightSize - MIN_WORKSPACE_PANE_FR);
      nextSizes[resizeState.index] = nextLeftSize;
      nextSizes[resizeState.index + 1] = leftSize + rightSize - nextLeftSize;

      setWorkspaceLayout((layout) => updateWorkspaceSplitSizes(layout, resizeState.splitId, nextSizes));
    }

    function handleMouseUp() {
      setWorkspaceResizeState(null);
    }

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [workspaceResizeState]);

  function startConnectionPanelResize(event: React.MouseEvent) {
    event.preventDefault();
    connectionResizeRef.current = {
      startX: event.clientX,
      startWidth: connectionSidebarWidth,
    };
    setIsResizingConnectionPanel(true);
  }

  function startWorkspaceResize(
    event: React.MouseEvent,
    splitId: string,
    direction: WorkspaceSplitDirection,
    index: number,
    sizes: number[],
  ) {
    event.preventDefault();
    event.stopPropagation();
    setWorkspaceResizeState({
      splitId,
      direction,
      index,
      startPointer: direction === "vertical" ? event.clientX : event.clientY,
      startSizes: sizes,
    });
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
        setWorkspaceLayout((layout) => removePaneFromWorkspaceLayout(layout, paneId) ?? createWorkspaceLayout(nextFocusedPaneId));
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
    const newSplitId = `split-${nextWorkspaceSplitSerialRef.current++}`;
    const newTab = cloneTabForSplit(tab);
    setWorkspacePanes((panes) => [...panes, createWorkspacePane(newPaneId, [newTab])]);
    setWorkspaceLayout((layout) => splitWorkspaceLayout(layout, paneId, newPaneId, newSplitId, direction));
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

  function renderTabPanel(pane: WorkspacePane, tab: AppWorkspaceTab, effectiveActiveTabId: string | null, layoutPath: string) {
    const paneLayoutVersion = `${workspaceLayoutVersion}:${layoutPath}`;
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

  function renderWorkspacePane(geometry: WorkspacePaneGeometry) {
    const { paneId } = geometry;
    const pane = workspacePanes.find((item) => item.id === paneId) ?? createWorkspacePane(paneId);
    const paneIndex = workspacePanes.findIndex((item) => item.id === paneId) + 1;
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
          left: `${geometry.left}%`,
          top: `${geometry.top}%`,
          width: `${geometry.width}%`,
          height: `${geometry.height}%`,
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
        {pane.tabs.map((tab) => renderTabPanel(pane, tab, effectiveActiveTabId, geometry.path))}
        {!activePaneTab ? (
          <section className="workspace-empty" onContextMenu={openEmptyWorkspaceContextMenu}>
            <h2>{t("app.no_tabs")}</h2>
            <p>{t("app.empty_workspace_hint")}</p>
          </section>
        ) : null}
      </section>
    );
  }

  function renderWorkspaceResizeHandle(handle: WorkspaceResizeHandleGeometry) {
    const isVertical = handle.direction === "vertical";
    return (
      <div
        key={`${handle.splitId}-${handle.index}`}
        role="separator"
        aria-label={isVertical ? `调整工作区列 ${handle.index + 1} 宽度` : `调整工作区行 ${handle.index + 1} 高度`}
        aria-orientation={isVertical ? "vertical" : "horizontal"}
        className={`workspace-resize-handle workspace-resize-handle--${isVertical ? "column" : "row"}`}
        style={{
          left: `${handle.left}%`,
          top: `${handle.top}%`,
          width: isVertical ? undefined : `${handle.width}%`,
          height: isVertical ? `${handle.height}%` : undefined,
        }}
        onMouseDown={(event) => startWorkspaceResize(event, handle.splitId, handle.direction, handle.index, handle.sizes)}
      />
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
          <div className="workspace-root">
            {workspaceLayoutGeometry.panes.map((pane) => renderWorkspacePane(pane))}
            {workspaceLayoutGeometry.handles.map((handle) => renderWorkspaceResizeHandle(handle))}
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
