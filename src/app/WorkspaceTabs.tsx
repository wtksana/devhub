export interface WorkspaceTabItem {
  id: string;
  title: string;
}

interface WorkspaceTabsProps {
  tabs: WorkspaceTabItem[];
  activeTabId: string | null;
  onSelect: (tabId: string) => void;
  onClose: (tabId: string) => void;
  onContextMenu?: (event: React.MouseEvent, tabId: string) => void;
}

export function WorkspaceTabs({ tabs, activeTabId, onSelect, onClose, onContextMenu }: WorkspaceTabsProps) {
  return (
    <nav className="workspace-tabs" aria-label="工作区标签">
      {tabs.map((tab) => (
        <div
          key={tab.id}
          className="workspace-tab"
          data-active={activeTabId === tab.id}
          onContextMenu={(event) => onContextMenu?.(event, tab.id)}
        >
          <button type="button" className="workspace-tab__select" aria-pressed={activeTabId === tab.id} onClick={() => onSelect(tab.id)}>
            {tab.title}
          </button>
          <button type="button" className="workspace-tab__close" aria-label={`关闭 ${tab.title}`} onClick={() => onClose(tab.id)}>
            ×
          </button>
        </div>
      ))}
    </nav>
  );
}
