import { useEffect, useMemo, useState } from "react";
import { useI18n } from "../../i18n/useI18n";
import { writeClipboardText } from "../../lib/clipboard";
import { callBackend } from "../../lib/tauri";

interface AppLogRecord {
  file_name: string;
  line_number: number;
  raw: string;
  ts?: string | null;
  level?: string | null;
  module?: string | null;
  action?: string | null;
  target?: string | null;
  result?: string | null;
  duration_ms?: number | null;
  message?: string | null;
  error?: string | null;
  metadata?: unknown;
}

const logLevels = ["all", "debug", "info", "warn", "error"] as const;

export function LogViewer() {
  const { t } = useI18n();
  const [logs, setLogs] = useState<AppLogRecord[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [level, setLevel] = useState<(typeof logLevels)[number]>("all");
  const [module, setModule] = useState("all");
  const [keyword, setKeyword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  async function loadLogs() {
    setIsLoading(true);
    setError(null);
    try {
      const entries = await callBackend<AppLogRecord[]>("list_app_logs", { limit: 500 });
      setLogs(entries);
      setSelectedIndex(0);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    void loadLogs();
  }, []);

  const modules = useMemo(() => {
    return Array.from(new Set(logs.map((log) => log.module).filter(Boolean) as string[])).sort((left, right) =>
      left.localeCompare(right),
    );
  }, [logs]);

  const filteredLogs = useMemo(() => {
    const normalizedKeyword = keyword.trim().toLowerCase();
    return logs.filter((log) => {
      if (level !== "all" && log.level !== level) return false;
      if (module !== "all" && log.module !== module) return false;
      if (!normalizedKeyword) return true;
      return logSearchText(log).toLowerCase().includes(normalizedKeyword);
    });
  }, [keyword, level, logs, module]);

  const selectedLog = filteredLogs[Math.min(selectedIndex, filteredLogs.length - 1)] ?? null;

  useEffect(() => {
    if (selectedIndex >= filteredLogs.length) {
      setSelectedIndex(0);
    }
  }, [filteredLogs.length, selectedIndex]);

  return (
    <section className="log-viewer" aria-label={t("logs.title")}>
      <header className="log-viewer__toolbar">
        <h2>{t("logs.title")}</h2>
        <label>
          <span>{t("logs.level")}</span>
          <select aria-label={t("logs.level_filter")} value={level} onChange={(event) => setLevel(event.target.value as typeof level)}>
            {logLevels.map((item) => (
              <option key={item} value={item}>
                {item === "all" ? t("logs.all_levels") : item}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>{t("logs.module")}</span>
          <select aria-label={t("logs.module_filter")} value={module} onChange={(event) => setModule(event.target.value)}>
            <option value="all">{t("logs.all_modules")}</option>
            {modules.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </label>
        <input
          type="search"
          aria-label={t("logs.keyword_filter")}
          placeholder={t("logs.keyword_placeholder")}
          value={keyword}
          onChange={(event) => setKeyword(event.target.value)}
        />
        <button type="button" onClick={() => void loadLogs()} disabled={isLoading}>
          {isLoading ? t("logs.refreshing") : t("logs.refresh")}
        </button>
      </header>
      {error ? <p role="alert" className="log-viewer__error">{error}</p> : null}
      <div className="log-viewer__body">
        <div className="log-viewer__list">
          <table>
            <colgroup>
              <col className="log-viewer__column--time" />
              <col className="log-viewer__column--level" />
              <col className="log-viewer__column--module" />
              <col className="log-viewer__column--action" />
              <col className="log-viewer__column--result" />
            </colgroup>
            <thead>
              <tr>
                <th>{t("logs.time")}</th>
                <th>{t("logs.level")}</th>
                <th>{t("logs.module")}</th>
                <th>{t("logs.action")}</th>
                <th>{t("logs.result")}</th>
              </tr>
            </thead>
            <tbody>
              {filteredLogs.map((log, index) => (
                <tr key={`${log.file_name}:${log.line_number}`}>
                  <td>
                    <button
                      type="button"
                      aria-label={`${log.module ?? "-"} ${log.action ?? "-"}`}
                      className="log-viewer__row-button"
                      data-active={selectedLog === log}
                      onClick={() => setSelectedIndex(index)}
                    >
                      {formatTimestamp(log.ts)}
                    </button>
                  </td>
                  <td>
                    <span className="log-viewer__level" data-level={log.level ?? "info"}>
                      {log.level ?? "-"}
                    </span>
                  </td>
                  <td title={log.module ?? undefined}>{log.module ?? "-"}</td>
                  <td title={log.action ?? undefined}>{log.action ?? "-"}</td>
                  <td title={log.result ?? undefined}>{log.result ?? "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {filteredLogs.length === 0 ? <p className="log-viewer__empty">{t("logs.empty")}</p> : null}
        </div>
        <aside className="log-viewer__detail" aria-label={t("logs.detail")}>
          {selectedLog ? (
            <>
              <header>
                <h3>{selectedLog.action ?? "-"}</h3>
                <button type="button" onClick={() => void writeClipboardText(selectedLog.raw)}>
                  {t("logs.copy")}
                </button>
              </header>
              <dl>
                <dt>{t("logs.time")}</dt>
                <dd>{formatTimestamp(selectedLog.ts)}</dd>
                <dt>{t("logs.target")}</dt>
                <dd>{selectedLog.target ?? "-"}</dd>
                <dt>{t("logs.duration")}</dt>
                <dd>{selectedLog.duration_ms == null ? "-" : `${selectedLog.duration_ms} ms`}</dd>
                <dt>{t("logs.message")}</dt>
                <dd>{selectedLog.message ?? "-"}</dd>
                <dt>{t("logs.error")}</dt>
                <dd>{selectedLog.error ?? "-"}</dd>
              </dl>
              <pre>{formatMetadata(selectedLog.metadata)}</pre>
            </>
          ) : (
            <p>{t("logs.no_selection")}</p>
          )}
        </aside>
      </div>
    </section>
  );
}

function logSearchText(log: AppLogRecord) {
  return [
    log.ts,
    log.level,
    log.module,
    log.action,
    log.target,
    log.result,
    log.message,
    log.error,
    log.raw,
  ]
    .filter(Boolean)
    .join(" ");
}

function formatTimestamp(value?: string | null) {
  if (!value) return "-";
  return value.replace("T", " ").replace(/\.\d+/, "").replace(/\s?([+-]\d\d:\d\d|Z)$/, "");
}

function formatMetadata(metadata: unknown) {
  if (metadata == null) return "-";
  return JSON.stringify(metadata, null, 2);
}
