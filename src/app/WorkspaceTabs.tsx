import { useRef } from "react";
import { useI18n } from "../i18n/useI18n";

type WorkspaceTabStatus = "connecting" | "connected" | "failed" | "closed";

export interface WorkspaceTabItem {
  id: string;
  title: string;
  status?: WorkspaceTabStatus;
}

interface WorkspaceTabsProps {
  paneId: string;
  tabs: WorkspaceTabItem[];
  activeTabId: string | null;
  onSelect: (tabId: string) => void;
  onClose: (tabId: string) => void;
  onContextMenu?: (event: React.MouseEvent, tabId: string) => void;
  onTabDragStart?: (tabId: string, event: PointerEvent) => void;
  onTabDragMove?: (event: PointerEvent) => void;
  onTabDragEnd?: (event: PointerEvent) => void;
}

interface PendingTabDrag {
  tabId: string;
  pointerId: number;
  startX: number;
  startY: number;
  started: boolean;
}

const TAB_DRAG_START_DISTANCE = 4;

export function WorkspaceTabs({
  paneId,
  tabs,
  activeTabId,
  onSelect,
  onClose,
  onContextMenu,
  onTabDragStart,
  onTabDragMove,
  onTabDragEnd,
}: WorkspaceTabsProps) {
  const { t } = useI18n();
  const pendingDragRef = useRef<PendingTabDrag | null>(null);
  const statusLabels: Record<WorkspaceTabStatus, string> = {
    connecting: t("app.tab_status_connecting"),
    connected: t("app.tab_status_connected"),
    failed: t("app.tab_status_failed"),
    closed: t("app.tab_status_closed"),
  };
  const handleWheel = (event: React.WheelEvent<HTMLElement>) => {
    const distance = event.deltaX + event.deltaY;
    if (distance === 0) {
      return;
    }

    event.currentTarget.scrollLeft += distance;
    event.preventDefault();
  };

  function finishTabDrag(event: PointerEvent) {
    const pendingDrag = pendingDragRef.current;
    if (!pendingDrag) return;
    pendingDragRef.current = null;
    if (!pendingDrag.started) return;
    onTabDragEnd?.(event);
  }

  function startPendingTabDrag(tabId: string, event: React.PointerEvent) {
    if (event.button !== 0) return;
    pendingDragRef.current = {
      tabId,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      started: false,
    };

    const handlePointerMove = (moveEvent: PointerEvent) => {
      const pendingDrag = pendingDragRef.current;
      if (!pendingDrag || moveEvent.pointerId !== pendingDrag.pointerId) return;
      const movedDistance = Math.abs(moveEvent.clientX - pendingDrag.startX) + Math.abs(moveEvent.clientY - pendingDrag.startY);
      if (!pendingDrag.started && movedDistance >= TAB_DRAG_START_DISTANCE) {
        pendingDrag.started = true;
        onTabDragStart?.(pendingDrag.tabId, moveEvent);
      }
      if (pendingDrag.started) {
        moveEvent.preventDefault();
        onTabDragMove?.(moveEvent);
      }
    };

    const handlePointerUp = (upEvent: PointerEvent) => {
      if (upEvent.pointerId === pendingDragRef.current?.pointerId) {
        finishTabDrag(upEvent);
      }
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerUp);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerUp);
  }

  function closeTabWithMiddleButton(tabId: string, event: React.MouseEvent) {
    if (event.button !== 1) return;
    event.preventDefault();
    event.stopPropagation();
    onClose(tabId);
  }

  return (
    <nav
      className="workspace-tabs"
      aria-label={t("app.workspace_tabs")}
      data-scrollable="true"
      data-wheel-scroll="horizontal"
      data-workspace-tabs-pane-id={paneId}
      onWheel={handleWheel}
    >
      {tabs.map((tab) => (
        <div
          key={tab.id}
          className="workspace-tab"
          data-fixed-width="true"
          data-tab-id={tab.id}
          data-active={activeTabId === tab.id}
          onPointerDown={(event) => startPendingTabDrag(tab.id, event)}
          onAuxClick={(event) => closeTabWithMiddleButton(tab.id, event)}
          onContextMenu={(event) => onContextMenu?.(event, tab.id)}
        >
          {tab.status ? (
            <span
              className="workspace-tab__status"
              data-status={tab.status}
              aria-label={`${tab.title} ${statusLabels[tab.status]}`}
            />
          ) : null}
          <button type="button" className="workspace-tab__select" aria-pressed={activeTabId === tab.id} onClick={() => onSelect(tab.id)}>
            {tab.title}
          </button>
          <button
            type="button"
            className="workspace-tab__close"
            aria-label={t("app.close_tab", { title: tab.title })}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={() => onClose(tab.id)}
          >
            ×
          </button>
        </div>
      ))}
    </nav>
  );
}
