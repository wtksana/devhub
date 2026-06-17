import { WindowControls } from "./WindowControls";
import { getSafeCurrentWindow } from "./windowRuntime";

interface CommandPaletteProps {
  onOpenSettings: () => void;
}

export function CommandPalette({ onOpenSettings }: CommandPaletteProps) {
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
        onMouseDown={(event) => event.stopPropagation()}
        onDoubleClick={(event) => event.stopPropagation()}
        onClick={onOpenSettings}
      >
        打开设置
      </button>
      <WindowControls />
    </section>
  );
}
