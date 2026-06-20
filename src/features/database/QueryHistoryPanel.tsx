import { useEffect, useState } from "react";
import { useI18n } from "../../i18n/useI18n";
import { callBackend } from "../../lib/tauri";
import type { QueryHistoryItem } from "./databaseTypes";

interface QueryHistoryPanelProps {
  connectionId: string;
  onSelectSql: (sql: string) => void;
}

export function QueryHistoryPanel({ connectionId, onSelectSql }: QueryHistoryPanelProps) {
  const { t } = useI18n();
  const [items, setItems] = useState<QueryHistoryItem[]>([]);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    let canceled = false;
    setIsLoading(true);
    setError("");
    callBackend<QueryHistoryItem[]>("list_database_query_history", {
      connection_id: connectionId,
    })
      .then((nextItems) => {
        if (!canceled) setItems(Array.isArray(nextItems) ? nextItems : []);
      })
      .catch((caught) => {
        if (!canceled) setError(caught instanceof Error ? caught.message : String(caught));
      })
      .finally(() => {
        if (!canceled) setIsLoading(false);
      });
    return () => {
      canceled = true;
    };
  }, [connectionId]);

  return (
    <aside className="database-history-panel" aria-label={t("database.query_history")}>
      <header>{t("database.query_history")}</header>
      {isLoading ? <p>{t("database.history_loading")}</p> : null}
      {error ? <p role="alert">{error}</p> : null}
      {!isLoading && !error && items.length === 0 ? <p>{t("database.history_empty")}</p> : null}
      <ul>
        {items.map((item) => (
          <li key={item.id}>
            <button type="button" onClick={() => onSelectSql(item.sql_text)}>
              <span>{item.sql_text}</span>
              <small>
                {item.executed_at} · {item.duration_ms} ms · {item.success ? t("database.history_success") : t("database.history_failed")}
              </small>
            </button>
          </li>
        ))}
      </ul>
    </aside>
  );
}
