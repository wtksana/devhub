import { useState } from "react";
import { callBackend } from "../../lib/tauri";
import type { DatabaseCellValue, DatabaseQueryResult, DatabaseWorkspaceProps } from "./databaseTypes";
import { DatabaseObjectTree } from "./DatabaseObjectTree";
import { useI18n } from "../../i18n/useI18n";

const DEFAULT_SQL_LIMIT = 200;
const DANGEROUS_SQL_KEYWORDS = new Set([
  "insert",
  "update",
  "delete",
  "drop",
  "truncate",
  "alter",
  "create",
  "replace",
  "grant",
  "revoke",
]);

export function DatabaseWorkspace({ connectionId }: DatabaseWorkspaceProps) {
  const { t } = useI18n();
  const [sql, setSql] = useState("");
  const [result, setResult] = useState<DatabaseQueryResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isExecuting, setIsExecuting] = useState(false);
  const [dangerousSqlToConfirm, setDangerousSqlToConfirm] = useState<string | null>(null);

  async function requestExecuteSql() {
    const trimmedSql = sql.trim();
    if (!trimmedSql) {
      setError(t("database.sql_required"));
      setResult(null);
      return;
    }
    if (isDangerousSql(trimmedSql)) {
      setDangerousSqlToConfirm(trimmedSql);
      return;
    }
    await executeSql(trimmedSql);
  }

  async function executeSql(sqlToExecute: string) {
    setIsExecuting(true);
    setError(null);
    try {
      const nextResult = await callBackend<DatabaseQueryResult>("execute_database_query", {
        request: {
          connection_id: connectionId,
          database: null,
          sql: sqlToExecute,
          limit: DEFAULT_SQL_LIMIT,
        },
      });
      setResult(nextResult);
    } catch (caught) {
      setResult(null);
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setIsExecuting(false);
    }
  }

  return (
    <section className="database-workspace" aria-label={t("database.workspace")}>
      <DatabaseObjectTree connectionId={connectionId} />
      <div className="database-workspace__main">
        <div className="database-query-panel">
          <label className="database-query-panel__editor">
            <span>{t("database.sql_editor")}</span>
            <textarea
              aria-label={t("database.sql_editor")}
              spellCheck={false}
              value={sql}
              placeholder={t("database.sql_placeholder")}
              onChange={(event) => setSql(event.target.value)}
            />
          </label>
          <div className="database-query-panel__actions">
            <button type="button" disabled={isExecuting} onClick={() => void requestExecuteSql()}>
              {isExecuting ? t("database.executing") : t("database.execute_sql")}
            </button>
            <span>{t("database.default_limit", { limit: DEFAULT_SQL_LIMIT })}</span>
            <span>{connectionId}</span>
          </div>
          {error ? <p className="database-query-panel__error" role="alert">{error}</p> : null}
        </div>
        {result ? <DatabaseResultView result={result} /> : (
          <div className="database-workspace__empty">{t("database.empty_query_result")}</div>
        )}
      </div>
      {dangerousSqlToConfirm ? (
        <div className="connection-dialog__backdrop">
          <div
            className="connection-dialog sftp-dialog"
            role="dialog"
            aria-modal="true"
            aria-label={t("database.confirm_dangerous_sql")}
          >
            <header className="connection-dialog__header">
              <h2>{t("database.confirm_dangerous_sql")}</h2>
            </header>
            <p>{t("database.dangerous_sql_message")}</p>
            <pre className="database-dangerous-sql__preview">{dangerousSqlToConfirm}</pre>
            <div className="sftp-dialog__actions">
              <button type="button" onClick={() => setDangerousSqlToConfirm(null)}>
                {t("database.cancel")}
              </button>
              <button
                type="button"
                className="sftp-dialog__danger-button"
                disabled={isExecuting}
                onClick={() => {
                  const sqlToExecute = dangerousSqlToConfirm;
                  setDangerousSqlToConfirm(null);
                  void executeSql(sqlToExecute);
                }}
              >
                {t("database.confirm_execute")}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function DatabaseResultView({ result }: { result: DatabaseQueryResult }) {
  const { t } = useI18n();
  const summary = result.columns.length > 0
    ? t("database.query_result_summary", {
      rows: result.rows.length,
      duration: result.duration_ms,
      limited: result.limited ? t("database.query_result_limited") : "",
    })
    : t("database.query_affected_summary", {
      affected: result.affected_rows,
      duration: result.duration_ms,
    });

  return (
    <section className="database-result" aria-label={t("database.query_result")}>
      <header>{summary}</header>
      {result.columns.length > 0 ? (
        <div className="database-result__table-wrap">
          <table>
            <thead>
              <tr>
                {result.columns.map((column) => (
                  <th key={column.name} scope="col" aria-label={`${column.name} ${column.data_type}`}>
                    <span>{column.name}</span>
                    <small>{column.data_type}</small>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {result.rows.length > 0 ? result.rows.map((row, rowIndex) => (
                <tr key={rowIndex}>
                  {row.map((cell, cellIndex) => (
                    <td key={cellIndex}>{formatCellValue(cell)}</td>
                  ))}
                </tr>
              )) : (
                <tr>
                  <td colSpan={result.columns.length}>{t("database.query_result_empty")}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}

function formatCellValue(cell: DatabaseCellValue) {
  if (cell.kind === "null") return "NULL";
  if (cell.kind === "bool") return String(cell.value);
  return cell.value;
}

function isDangerousSql(sql: string) {
  const keyword = firstSqlKeyword(sql);
  if (!keyword) return true;
  return DANGEROUS_SQL_KEYWORDS.has(keyword.toLowerCase());
}

function firstSqlKeyword(sql: string) {
  let remaining = sql.trimStart();
  while (remaining.length > 0) {
    if (remaining.startsWith("--")) {
      const newlineIndex = remaining.indexOf("\n");
      if (newlineIndex === -1) return null;
      remaining = remaining.slice(newlineIndex + 1).trimStart();
      continue;
    }
    if (remaining.startsWith("/*")) {
      const endIndex = remaining.indexOf("*/");
      if (endIndex === -1) return null;
      remaining = remaining.slice(endIndex + 2).trimStart();
      continue;
    }
    return remaining.split(/[^a-zA-Z]+/).find(Boolean) ?? null;
  }
  return null;
}
