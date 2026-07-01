import { useEffect, useMemo, useState } from "react";
import { useI18n } from "../../i18n/useI18n";
import {
  listStoredCommandHistories,
  removeCommandHistoryEntry,
  type StoredCommandHistory,
} from "./commandHistory";

interface CommandHistoryRecord {
  connectionId: string;
  command: string;
}

function readHistories() {
  if (typeof window === "undefined") return [];
  return listStoredCommandHistories(window.localStorage);
}

function flattenHistories(histories: StoredCommandHistory[]) {
  return histories.flatMap((history) =>
    history.commands.map((command) => ({
      connectionId: history.connectionId,
      command,
    })),
  );
}

export function CommandHistoryViewer() {
  const { t } = useI18n();
  const [histories, setHistories] = useState<StoredCommandHistory[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [connectionId, setConnectionId] = useState("all");
  const [keyword, setKeyword] = useState("");

  function loadHistories() {
    setHistories(readHistories());
    setSelectedIndex(0);
  }

  function deleteCommand(record: CommandHistoryRecord) {
    if (typeof window === "undefined") return;
    removeCommandHistoryEntry(window.localStorage, record.connectionId, record.command);
    loadHistories();
  }

  useEffect(() => {
    loadHistories();
  }, []);

  const records = useMemo(() => flattenHistories(histories), [histories]);
  const connectionIds = useMemo(() => histories.map((history) => history.connectionId), [histories]);
  const filteredRecords = useMemo(() => {
    const normalizedKeyword = keyword.trim().toLowerCase();
    return records.filter((record) => {
      if (connectionId !== "all" && record.connectionId !== connectionId) return false;
      if (!normalizedKeyword) return true;
      return `${record.connectionId} ${record.command}`.toLowerCase().includes(normalizedKeyword);
    });
  }, [connectionId, keyword, records]);
  const selectedRecord = filteredRecords[Math.min(selectedIndex, filteredRecords.length - 1)] ?? null;

  useEffect(() => {
    if (selectedIndex >= filteredRecords.length) {
      setSelectedIndex(0);
    }
  }, [filteredRecords.length, selectedIndex]);

  return (
    <section className="log-viewer command-history-viewer" aria-label={t("command_history.title")}>
      <header className="log-viewer__toolbar">
        <h2>{t("command_history.title")}</h2>
        <label>
          <span>{t("command_history.connection")}</span>
          <select
            aria-label={t("command_history.connection_filter")}
            value={connectionId}
            onChange={(event) => setConnectionId(event.target.value)}
          >
            <option value="all">{t("command_history.all_connections")}</option>
            {connectionIds.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </label>
        <input
          type="search"
          aria-label={t("command_history.keyword_filter")}
          placeholder={t("command_history.keyword_placeholder")}
          value={keyword}
          onChange={(event) => setKeyword(event.target.value)}
        />
        <button type="button" onClick={loadHistories}>
          {t("command_history.refresh")}
        </button>
      </header>
      <div className="log-viewer__body">
        <div className="log-viewer__list">
          <table>
            <colgroup>
              <col className="command-history-viewer__column--connection" />
              <col className="command-history-viewer__column--command" />
            </colgroup>
            <thead>
              <tr>
                <th>{t("command_history.connection")}</th>
                <th>{t("command_history.command")}</th>
              </tr>
            </thead>
            <tbody>
              {filteredRecords.map((record, index) => (
                <tr key={`${record.connectionId}:${record.command}`}>
                  <td title={record.connectionId}>{record.connectionId}</td>
                  <td>
                    <button
                      type="button"
                      aria-label={record.command}
                      className="log-viewer__row-button"
                      data-active={selectedRecord === record}
                      onClick={() => setSelectedIndex(index)}
                    >
                      {record.command}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {filteredRecords.length === 0 ? <p className="log-viewer__empty">{t("command_history.empty")}</p> : null}
        </div>
        <aside className="log-viewer__detail" aria-label={t("command_history.detail")}>
          {selectedRecord ? (
            <>
              <header>
                <h3>{selectedRecord.command}</h3>
                <button type="button" onClick={() => deleteCommand(selectedRecord)}>
                  {t("command_history.delete")}
                </button>
              </header>
              <dl>
                <dt>{t("command_history.connection")}</dt>
                <dd>{selectedRecord.connectionId}</dd>
                <dt>{t("command_history.command")}</dt>
                <dd>{selectedRecord.command}</dd>
              </dl>
            </>
          ) : (
            <p>{t("command_history.no_selection")}</p>
          )}
        </aside>
      </div>
    </section>
  );
}
