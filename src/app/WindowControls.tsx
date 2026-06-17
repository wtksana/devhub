import { getSafeCurrentWindow } from "./windowRuntime";

export function WindowControls() {
  const appWindow = getSafeCurrentWindow();
  const isDisabled = appWindow === null;

  return (
    <div
      className="window-controls"
      aria-label="窗口控制"
      onMouseDown={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
    >
      <button
        type="button"
        aria-label="最小化窗口"
        disabled={isDisabled}
        onClick={() => void getSafeCurrentWindow()?.minimize()}
      >
        -
      </button>
      <button
        type="button"
        aria-label="最大化窗口"
        disabled={isDisabled}
        onClick={() => void getSafeCurrentWindow()?.toggleMaximize()}
      >
        □
      </button>
      <button
        type="button"
        aria-label="关闭窗口"
        disabled={isDisabled}
        onClick={() => void getSafeCurrentWindow()?.close()}
      >
        ×
      </button>
    </div>
  );
}
