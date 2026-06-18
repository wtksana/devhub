import { useI18n } from "../i18n/useI18n";

interface StatusBarProps {
  isConnectionPanelVisible: boolean;
  onToggleConnectionPanel: () => void;
}

export function StatusBar({
  isConnectionPanelVisible,
  onToggleConnectionPanel,
}: StatusBarProps) {
  const { t } = useI18n();
  const connectionToggle = (
    <div className="status-bar__group">
      <button
        type="button"
        aria-label={t("status.toggle_connection_panel")}
        aria-pressed={isConnectionPanelVisible}
        onClick={onToggleConnectionPanel}
      >
        {t("status.toggle_connection_panel")}
      </button>
    </div>
  );

  return (
    <footer className="status-bar" aria-label={t("status.label")}>
      <div className="status-bar__side status-bar__side--left" aria-label={t("status.left")}>
        {connectionToggle}
      </div>
      <div className="status-bar__spacer" />
      <div className="status-bar__side status-bar__side--right" aria-label={t("status.right")} />
    </footer>
  );
}
