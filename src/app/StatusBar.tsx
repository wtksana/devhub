interface StatusBarProps {
  isConnectionPanelVisible: boolean;
  onToggleConnectionPanel: () => void;
}

export function StatusBar({
  isConnectionPanelVisible,
  onToggleConnectionPanel,
}: StatusBarProps) {
  const connectionToggle = (
    <div className="status-bar__group">
      <button
        type="button"
        aria-label="切换连接面板"
        aria-pressed={isConnectionPanelVisible}
        onClick={onToggleConnectionPanel}
      >
        切换连接面板
      </button>
    </div>
  );

  return (
    <footer className="status-bar" aria-label="状态栏">
      <div className="status-bar__side status-bar__side--left" aria-label="状态栏左侧区域">
        {connectionToggle}
      </div>
      <div className="status-bar__spacer" />
      <div className="status-bar__side status-bar__side--right" aria-label="状态栏右侧区域" />
    </footer>
  );
}
