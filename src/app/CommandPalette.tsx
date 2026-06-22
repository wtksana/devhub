import ThemeIcon from "../assets/icons/bi--brilliance.svg?react";
import SettingsIcon from "../assets/icons/bi--gear-wide-connected.svg?react";
import { useI18n } from "../i18n/useI18n";
import { AppIcon } from "./AppIcon";
import { WindowControls } from "./WindowControls";
import { getSafeCurrentWindow } from "./windowRuntime";

interface CommandPaletteProps {
  onOpenSettings: () => void;
  onToggleTheme: () => void;
}

export function CommandPalette({ onOpenSettings, onToggleTheme }: CommandPaletteProps) {
  const appWindow = getSafeCurrentWindow();
  const { t } = useI18n();

  return (
    <section
      className="command-palette"
      aria-label={t("app.command_palette")}
      data-tauri-drag-region
      onDoubleClick={() => void appWindow?.toggleMaximize()}
      onMouseDown={(event) => {
        if (event.button === 0 && event.detail === 1) {
          void appWindow?.startDragging();
        }
      }}
    >
      <span className="command-palette__title" data-tauri-drag-region>
        DevHub
      </span>
      <button
        type="button"
        className="command-palette__icon-button"
        aria-label={t("app.toggle_theme")}
        onMouseDown={(event) => event.stopPropagation()}
        onDoubleClick={(event) => event.stopPropagation()}
        onClick={onToggleTheme}
      >
        <AppIcon icon={ThemeIcon} decorative />
      </button>
      <button
        type="button"
        className="command-palette__icon-button"
        aria-label={t("app.open_settings")}
        onMouseDown={(event) => event.stopPropagation()}
        onDoubleClick={(event) => event.stopPropagation()}
        onClick={onOpenSettings}
      >
        <AppIcon icon={SettingsIcon} decorative />
      </button>
      <WindowControls />
    </section>
  );
}
