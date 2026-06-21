import { useEffect, useState } from "react";
import { useI18n } from "../../i18n/useI18n";
import { callBackend } from "../../lib/tauri";
import type {
  DatabaseCellValue,
  DatabaseSortDirection,
  DatabaseTableBrowserTarget,
  DatabaseTablePageResult,
  DatabaseTableUpdateResult,
} from "./databaseTypes";

const DEFAULT_PAGE_SIZE = 200;

interface DatabaseTableBrowserProps {
  connectionId: string;
  target: DatabaseTableBrowserTarget;
}

type DirtyRows = Record<number, Record<string, DatabaseCellValue>>;
type EditingCell = { rowIndex: number; columnName: string; value: string } | null;

export function DatabaseTableBrowser({ connectionId, target }: DatabaseTableBrowserProps) {
  const { t } = useI18n();
  const [page, setPage] = useState(1);
  const [pageInput, setPageInput] = useState("1");
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [pageSizeInput, setPageSizeInput] = useState(String(DEFAULT_PAGE_SIZE));
  const [sortColumn, setSortColumn] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<DatabaseSortDirection | null>(null);
  const [filterInput, setFilterInput] = useState("");
  const [filter, setFilter] = useState("");
  const [result, setResult] = useState<DatabaseTablePageResult | null>(null);
  const [dirtyRows, setDirtyRows] = useState<DirtyRows>({});
  const [editingCell, setEditingCell] = useState<EditingCell>(null);
  const [confirmDialog, setConfirmDialog] = useState<"save" | "discard" | null>(null);
  const [pendingAction, setPendingAction] = useState<(() => void) | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    setPage(1);
    setPageInput("1");
    setPageSize(DEFAULT_PAGE_SIZE);
    setPageSizeInput(String(DEFAULT_PAGE_SIZE));
    setSortColumn(null);
    setSortDirection(null);
    setFilterInput("");
    setFilter("");
    setDirtyRows({});
    setEditingCell(null);
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
          page_size: pageSize,
          sort_column: sortColumn,
          sort_direction: sortDirection,
          filter: filter || null,
        },
      });
      setResult(nextResult);
      setEditingCell(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setIsLoading(false);
    }
  }

  function applyFilter() {
    runAfterDiscardConfirmation(() => {
      setPage(1);
      setPageInput("1");
      setFilter(filterInput.trim());
    });
  }

  function applyPageInput() {
    runAfterDiscardConfirmation(() => {
      const nextPage = normalizePage(pageInput);
      setPage(nextPage);
      setPageInput(String(nextPage));
    });
  }

  function applyPageSizeInput() {
    runAfterDiscardConfirmation(() => {
      const nextPageSize = normalizePageSize(pageSizeInput);
      setPage(1);
      setPageInput("1");
      setPageSize(nextPageSize);
      setPageSizeInput(String(nextPageSize));
    });
  }

  function toggleSort(columnName: string) {
    runAfterDiscardConfirmation(() => {
      if (sortColumn !== columnName) {
        setSortColumn(columnName);
        setSortDirection("asc");
        setPage(1);
        setPageInput("1");
        return;
      }
      if (sortDirection === "asc") {
        setSortDirection("desc");
        setPage(1);
        setPageInput("1");
        return;
      }
      setSortColumn(null);
      setSortDirection(null);
      setPage(1);
      setPageInput("1");
    });
  }

  const totalPages = result ? Math.max(1, Math.ceil(result.total_rows / result.page_size)) : 1;
  const canGoPrevious = page > 1 && !isLoading;
  const canGoNext = Boolean(result && page < totalPages && !isLoading);

  function goToPage(nextPage: number) {
    runAfterDiscardConfirmation(() => {
      const normalizedPage = normalizePage(String(nextPage));
      setPage(normalizedPage);
      setPageInput(String(normalizedPage));
    });
  }

  function cellText(cell: DatabaseCellValue) {
    if (cell.kind === "null") return "NULL";
    if (cell.kind === "bool") return String(cell.value);
    return cell.value;
  }

  function isPrimaryKeyColumn(columnName: string) {
    return result?.primary_key_columns.includes(columnName) ?? false;
  }

  function editableCell(columnName: string) {
    return Boolean(result?.editable && !isPrimaryKeyColumn(columnName));
  }

  function displayedCell(rowIndex: number, columnName: string, original: DatabaseCellValue) {
    return dirtyRows[rowIndex]?.[columnName] ?? original;
  }

  function commitEditingCell() {
    if (!editingCell || !result) return;
    setDirtyRows((current) => ({
      ...current,
      [editingCell.rowIndex]: {
        ...(current[editingCell.rowIndex] ?? {}),
        [editingCell.columnName]: { kind: "text", value: editingCell.value },
      },
    }));
    setEditingCell(null);
  }

  function runAfterDiscardConfirmation(action: () => void) {
    if (dirtyFieldCount === 0) {
      action();
      return;
    }
    setPendingAction(() => action);
    setConfirmDialog("discard");
  }

  function buildUpdateRows() {
    if (!result) return [];
    return Object.entries(dirtyRows).map(([rowIndexText, changes]) => {
      const rowIndex = Number(rowIndexText);
      const row = result.rows[rowIndex];
      const primary_key_values = Object.fromEntries(
        result.primary_key_columns.map((columnName) => {
          const index = result.columns.findIndex((column) => column.name === columnName);
          return [columnName, row[index]];
        }),
      );
      return { primary_key_values, changes };
    });
  }

  async function saveChanges() {
    if (!result || dirtyFieldCount === 0) return;
    setIsSaving(true);
    setError(null);
    try {
      await callBackend<DatabaseTableUpdateResult>("update_database_table_rows", {
        request: {
          connection_id: connectionId,
          database: target.database,
          table: target.table,
          primary_key_columns: result.primary_key_columns,
          rows: buildUpdateRows(),
        },
      });
      setDirtyRows({});
      setConfirmDialog(null);
      await loadPage();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setIsSaving(false);
    }
  }

  function discardChanges() {
    setDirtyRows({});
    setConfirmDialog(null);
    const action = pendingAction;
    setPendingAction(null);
    action?.();
  }

  const dirtyRowCount = Object.keys(dirtyRows).length;
  const dirtyFieldCount = Object.values(dirtyRows).reduce((total, row) => total + Object.keys(row).length, 0);

  return (
    <section className="database-table-browser" aria-label={t("database.table_browser")}>
      <header className="database-table-browser__toolbar">
        <span>{t("database.table_label", { table: target.table })}</span>
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
        <span>{result ? t("database.total_rows", { total: result.total_rows }) : t("database.total_rows", { total: 0 })}</span>
        <button type="button" disabled={dirtyFieldCount === 0 || isSaving} onClick={() => setConfirmDialog("save")}>
          {t("database.save_changes")}
        </button>
        <button type="button" disabled={dirtyFieldCount === 0 || isSaving} onClick={() => setConfirmDialog("discard")}>
          {t("database.discard_changes")}
        </button>
        {dirtyFieldCount > 0 ? (
          <span>{t("database.unsaved_changes", { rows: dirtyRowCount, fields: dirtyFieldCount })}</span>
        ) : null}
        {result && !result.editable ? (
          <span className="database-table-browser__readonly">
            {t("database.readonly_no_primary_key")}
          </span>
        ) : null}
        <button type="button" disabled={!canGoPrevious} onClick={() => goToPage(Math.max(1, page - 1))}>
          {t("database.previous_page")}
        </button>
        <label>
          <span>{t("database.page")}</span>
          <input
            aria-label={t("database.page")}
            type="number"
            min="1"
            value={pageInput}
            onBlur={applyPageInput}
            onChange={(event) => setPageInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") applyPageInput();
            }}
          />
        </label>
        <button type="button" disabled={!canGoNext} onClick={() => goToPage(page + 1)}>
          {t("database.next_page")}
        </button>
        <label>
          <span>{t("database.page_size")}</span>
          <input
            aria-label={t("database.page_size")}
            type="number"
            min="1"
            max="10000"
            value={pageSizeInput}
            onBlur={applyPageSizeInput}
            onChange={(event) => setPageSizeInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") applyPageSizeInput();
            }}
          />
        </label>
        <button type="button" disabled={isLoading} onClick={() => runAfterDiscardConfirmation(() => void loadPage())}>
          {isLoading ? t("database.loading") : t("database.refresh")}
        </button>
      </header>
      {error ? <p className="database-table-browser__error" role="alert">{error}</p> : null}
      {result ? (
        <div className="database-result__table-wrap database-table-browser__table-wrap">
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
                  {row.map((cell, cellIndex) => {
                    const column = result.columns[cellIndex];
                    const displayed = displayedCell(rowIndex, column.name, cell);
                    const isDirty = Boolean(dirtyRows[rowIndex]?.[column.name]);
                    const isEditing = editingCell?.rowIndex === rowIndex && editingCell.columnName === column.name;
                    return (
                      <td
                        key={cellIndex}
                        className={isDirty ? "database-table-browser__cell--dirty" : undefined}
                        onDoubleClick={() => {
                          if (!editableCell(column.name)) return;
                          setEditingCell({ rowIndex, columnName: column.name, value: cellText(displayed) });
                        }}
                      >
                        {isEditing ? (
                          <input
                            aria-label={`编辑 ${column.name}`}
                            autoFocus
                            value={editingCell.value}
                            onBlur={commitEditingCell}
                            onChange={(event) => setEditingCell({ ...editingCell, value: event.target.value })}
                            onKeyDown={(event) => {
                              if (event.key === "Enter") commitEditingCell();
                              if (event.key === "Escape") setEditingCell(null);
                            }}
                          />
                        ) : formatCellValue(displayed)}
                      </td>
                    );
                  })}
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
      {confirmDialog ? (
        <div className="connection-dialog__backdrop">
          <div
            className="connection-dialog database-dialog"
            role="dialog"
            aria-modal="true"
            aria-label={confirmDialog === "save" ? t("database.confirm_save_changes") : t("database.confirm_discard_changes")}
          >
            <header className="database-dialog__header">
              <h2>{confirmDialog === "save" ? t("database.confirm_save_changes") : t("database.confirm_discard_changes")}</h2>
            </header>
            <p>
              {confirmDialog === "save"
                ? t("database.confirm_save_changes_message", { rows: dirtyRowCount, fields: dirtyFieldCount })
                : pendingAction
                  ? t("database.confirm_discard_before_action")
                  : t("database.confirm_discard_changes_message")}
            </p>
            <div className="database-dialog__actions">
              <button type="button" onClick={() => {
                setConfirmDialog(null);
                setPendingAction(null);
              }}>
                {t("database.cancel")}
              </button>
              <button type="button" disabled={isSaving} onClick={() => {
                if (confirmDialog === "save") {
                  void saveChanges();
                  return;
                }
                discardChanges();
              }}>
                {t("database.confirm")}
              </button>
            </div>
          </div>
        </div>
      ) : null}
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
