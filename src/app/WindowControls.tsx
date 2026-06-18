import { useI18n } from "../i18n/useI18n";
import { getSafeCurrentWindow } from "./windowRuntime";

export function WindowControls() {
  const appWindow = getSafeCurrentWindow();
  const isDisabled = appWindow === null;
  const { t } = useI18n();

  return (
    <div
      className="window-controls"
      aria-label={t("window.controls")}
      onMouseDown={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
    >
      <button
        type="button"
        aria-label={t("window.minimize")}
        disabled={isDisabled}
        onClick={() => void getSafeCurrentWindow()?.minimize()}
      >
        -
      </button>
      <button
        type="button"
        aria-label={t("window.maximize")}
        disabled={isDisabled}
        onClick={() => void getSafeCurrentWindow()?.toggleMaximize()}
      >
        □
      </button>
      <button
        type="button"
        aria-label={t("window.close")}
        disabled={isDisabled}
        onClick={() => void getSafeCurrentWindow()?.close()}
      >
        ×
      </button>
    </div>
  );
}
