import { useEffect, useState } from "react";
import { useI18n } from "../../i18n/useI18n";
import { callBackend } from "../../lib/tauri";
import type {
  DatabaseCellValue,
  DatabaseSortDirection,
  DatabaseTableBrowserTarget,
  DatabaseTablePageResult,
} from "./databaseTypes";

const DEFAULT_PAGE_SIZE = 200;

interface DatabaseTableBrowserProps {
  connectionId: string;
  target: DatabaseTableBrowserTarget;
}

export function DatabaseTableBrowser({ connectionId, target }: DatabaseTableBrowserProps) {
  const { t } = useI18n();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(String(DEFAULT_PAGE_SIZE));
  const [sortColumn, setSortColumn] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<DatabaseSortDirection | null>(null);
  const [filterInput, setFilterInput] = useState("");
  const [filter, setFilter] = useState("");
  const [result, setResult] = useState<DatabaseTablePageResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    setPage(1);
    setSortColumn(null);
    setSortDirection(null);
    setFilterInput("");
    setFilter("");
  }, [target.database, target.table]);

  useEffect(() => {
    void loadPage();
  }, [connectionId, target.database, target.table, page, pageSize, sortColumn, sortDirection, filter]);

  async function loadPage() {
    setIsLoading(true);
    setError(null);
    try {
      const nextResult = await callBackend<DatabaseTablePageResult>("load_database_table_page", {
        request: {
          connection_id: connectionId,
          database: target.database,
          table: target.table,
          page,
          page_size: normalizePageSize(pageSize),
          sort_column: sortColumn,
          sort_direction: sortDirection,
          filter: filter || null,
        },
      });
      setResult(nextResult);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setIsLoading(false);
    }
  }

  function applyFilter() {
    setPage(1);
    setFilter(filterInput.trim());
  }

  function toggleSort(columnName: string) {
    if (sortColumn !== columnName) {
      setSortColumn(columnName);
      setSortDirection("asc");
      setPage(1);
      return;
    }
    if (sortDirection === "asc") {
      setSortDirection("desc");
      setPage(1);
      return;
    }
    setSortColumn(null);
    setSortDirection(null);
    setPage(1);
  }

  const totalPages = result ? Math.max(1, Math.ceil(result.total_rows / result.page_size)) : 1;
  const canGoPrevious = page > 1 && !isLoading;
  const canGoNext = Boolean(result && page < totalPages && !isLoading);

  return (
    <section className="database-table-browser" aria-label={t("database.table_browser")}>
      <header className="database-table-browser__toolbar">
        <span>{t("database.table_label", { table: target.table })}</span>
        <button type="button" disabled={!canGoPrevious} onClick={() => setPage((current) => Math.max(1, current - 1))}>
          {t("database.previous_page")}
        </button>
        <label>
          <span>{t("database.page")}</span>
          <input
            aria-label={t("database.page")}
            type="number"
            min="1"
            value={page}
            onChange={(event) => setPage(normalizePage(event.target.value))}
          />
        </label>
        <button type="button" disabled={!canGoNext} onClick={() => setPage((current) => current + 1)}>
          {t("database.next_page")}
        </button>
        <label>
          <span>{t("database.page_size")}</span>
          <input
            aria-label={t("database.page_size")}
            type="number"
            min="1"
            max="10000"
            value={pageSize}
            onBlur={() => setPageSize(String(normalizePageSize(pageSize)))}
            onChange={(event) => {
              setPage(1);
              setPageSize(event.target.value);
            }}
          />
        </label>
        <span>{result ? t("database.total_rows", { total: result.total_rows }) : t("database.total_rows", { total: 0 })}</span>
        <label className="database-table-browser__filter">
          <span>{t("database.filter")}</span>
          <input
            aria-label={t("database.filter")}
            value={filterInput}
            placeholder={t("database.filter_placeholder")}
            onBlur={applyFilter}
            onChange={(event) => setFilterInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") applyFilter();
            }}
          />
        </label>
        <button type="button" disabled={isLoading} onClick={() => void loadPage()}>
          {isLoading ? t("database.loading") : t("database.refresh")}
        </button>
      </header>
      {error ? <p className="database-table-browser__error" role="alert">{error}</p> : null}
      {result ? (
        <div className="database-result__table-wrap">
          <table>
            <thead>
              <tr>
                {result.columns.map((column) => (
                  <th key={column.name} scope="col" aria-label={`${column.name} ${column.data_type}`}>
                    <button type="button" aria-label={sortButtonLabel(column.name, column.data_type, sortColumn === column.name ? sortDirection : null)} onClick={() => toggleSort(column.name)}>
                      <span>{column.name}</span>
                      <small>{column.data_type}</small>
                      {sortColumn === column.name && sortDirection ? <span>{sortDirection === "asc" ? "↑" : "↓"}</span> : null}
                    </button>
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
      ) : (
        <div className="database-workspace__empty">{t("database.loading")}</div>
      )}
    </section>
  );
}

function normalizePage(value: string) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return 1;
  return parsed;
}

function normalizePageSize(value: string) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return DEFAULT_PAGE_SIZE;
  return Math.min(parsed, 10_000);
}

function formatCellValue(cell: DatabaseCellValue) {
  if (cell.kind === "null") return "NULL";
  if (cell.kind === "bool") return String(cell.value);
  return cell.value;
}

function sortButtonLabel(columnName: string, dataType: string, direction: DatabaseSortDirection | null) {
  const suffix = direction === "asc" ? " ↑" : direction === "desc" ? " ↓" : "";
  return `${columnName} ${dataType}${suffix}`;
}
