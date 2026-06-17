import themeIcon from "../assets/icons/bi--brilliance.png";
import settingsIcon from "../assets/icons/bi--gear-wide-connected.png";
import { WindowControls } from "./WindowControls";
import { getSafeCurrentWindow } from "./windowRuntime";

interface CommandPaletteProps {
  onOpenSettings: () => void;
  onToggleTheme: () => void;
}

export function CommandPalette({ onOpenSettings, onToggleTheme }: CommandPaletteProps) {
  const appWindow = getSafeCurrentWindow();

  return (
    <section
      className="command-palette"
      aria-label="命令面板"
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
        aria-label="切换主题"
        onMouseDown={(event) => event.stopPropagation()}
        onDoubleClick={(event) => event.stopPropagation()}
        onClick={onToggleTheme}
      >
        <img src={themeIcon} alt="" aria-hidden="true" />
      </button>
      <button
        type="button"
        className="command-palette__icon-button"
        aria-label="打开设置"
        onMouseDown={(event) => event.stopPropagation()}
        onDoubleClick={(event) => event.stopPropagation()}
        onClick={onOpenSettings}
      >
        <img src={settingsIcon} alt="" aria-hidden="true" />
      </button>
      <WindowControls />
    </section>
  );
}
