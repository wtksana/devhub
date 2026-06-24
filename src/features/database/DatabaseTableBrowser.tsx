import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { useI18n } from "../../i18n/useI18n";
import { logFrontendError } from "../../lib/appLogging";
import { callBackend } from "../../lib/tauri";
import { AppIcon } from "../../app/AppIcon";
import { readClipboardText, writeClipboardText } from "../../lib/clipboard";
import FirstPageIcon from "../../assets/icons/material-symbols--first-page-rounded.svg?react";
import LastPageIcon from "../../assets/icons/material-symbols--last-page-rounded.svg?react";
import NextPageIcon from "../../assets/icons/material-symbols--chevron-right-rounded.svg?react";
import PageSizeIcon from "../../assets/icons/material-symbols--keyboard-arrow-down-rounded.svg?react";
import PreviousPageIcon from "../../assets/icons/material-symbols--chevron-left-rounded.svg?react";
import RefreshIcon from "../../assets/icons/solar--refresh-bold.svg?react";
import SaveChangesIcon from "../../assets/icons/material-symbols--upload.svg?react";
import DiscardChangesIcon from "../../assets/icons/material-symbols--undo.svg?react";
import AddRowIcon from "../../assets/icons/material-symbols--add-rounded.svg?react";
import type {
  DatabaseCellValue,
  DatabaseResultColumn,
  DatabaseSortDirection,
  DatabaseTableBrowserTarget,
  DatabaseTableDeleteRow,
  DatabaseTableInsertRow,
  DatabaseTablePageResult,
  DatabaseTableUpdateResult,
} from "./databaseTypes";
import {
  cellText,
  DatabaseDataGrid,
  formatCellValue,
  type DatabaseDataGridContextMenuItem,
  type DatabaseDataGridNewRowState,
} from "./DatabaseDataGrid";

const DEFAULT_PAGE_SIZE = 200;
const PAGE_SIZE_OPTIONS = [10, 100, 200, 400, 500, 1000];

interface DatabaseTableBrowserProps {
  connectionId: string;
  target: DatabaseTableBrowserTarget;
}

type DirtyRows = Record<number, Record<string, DatabaseCellValue>>;
type EditingCell = { rowIndex: number; columnName: string; value: string } | null;
type NewRow = { id: string; values: Record<string, DatabaseCellValue> };
type DeleteTarget = { rowIndex: number } | null;
type DatabaseTablePageRequest = {
  connection_id: string;
  database: string;
  table: string;
  page: number;
  page_size: number;
  sort_column: string | null;
  sort_direction: DatabaseSortDirection | null;
  order_by: string | null;
  filter: string | null;
};

const pendingTablePageRequests = new Map<string, Promise<DatabaseTablePageResult>>();

function loadDatabaseTablePageOnce(request: DatabaseTablePageRequest) {
  const requestKey = JSON.stringify(request);
  const pendingRequest = pendingTablePageRequests.get(requestKey);
  if (pendingRequest) return pendingRequest;

  const requestPromise = callBackend<DatabaseTablePageResult>("load_database_table_page", { request }).finally(() => {
    pendingTablePageRequests.delete(requestKey);
  });
  pendingTablePageRequests.set(requestKey, requestPromise);
  return requestPromise;
}

export function DatabaseTableBrowser({ connectionId, target }: DatabaseTableBrowserProps) {
  const { t } = useI18n();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [sortColumn, setSortColumn] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<DatabaseSortDirection | null>(null);
  const [filterInput, setFilterInput] = useState("");
  const [filter, setFilter] = useState("");
  const [orderByInput, setOrderByInput] = useState("");
  const [orderBy, setOrderBy] = useState("");
  const [result, setResult] = useState<DatabaseTablePageResult | null>(null);
  const [dirtyRows, setDirtyRows] = useState<DirtyRows>({});
  const [newRows, setNewRows] = useState<NewRow[]>([]);
  const [editingCell, setEditingCell] = useState<EditingCell>(null);
  const [confirmDialog, setConfirmDialog] = useState<"save" | "discard" | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget>(null);
  const [pendingAction, setPendingAction] = useState<(() => void) | null>(null);
  const [isPageSizeMenuOpen, setIsPageSizeMenuOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const editingCellRef = useRef<EditingCell>(null);
  const editingInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setPage(1);
    setPageSize(DEFAULT_PAGE_SIZE);
    setSortColumn(null);
    setSortDirection(null);
    setFilterInput("");
    setFilter("");
    setOrderByInput("");
    setOrderBy("");
    setDirtyRows({});
    setNewRows([]);
    setActiveEditingCell(null);
    setIsPageSizeMenuOpen(false);
  }, [target.database, target.table]);

  useEffect(() => {
    editingCellRef.current = editingCell;
  }, [editingCell]);

  useEffect(() => {
    void loadPage();
  }, [connectionId, target.database, target.table, page, pageSize, sortColumn, sortDirection, filter, orderBy]);

  useEffect(() => {
    if (!isPageSizeMenuOpen) return;

    function handlePointerDown(event: PointerEvent) {
      if (!(event.target instanceof Element)) return;
      if (event.target.closest(".database-table-browser__page-size")) return;
      setIsPageSizeMenuOpen(false);
    }

    window.addEventListener("pointerdown", handlePointerDown);
    return () => window.removeEventListener("pointerdown", handlePointerDown);
  }, [isPageSizeMenuOpen]);

  useEffect(() => {
    if (!editingCell) return;
    editingInputRef.current?.select();
  }, [editingCell?.rowIndex, editingCell?.columnName]);

  async function loadPage() {
    setIsLoading(true);
    setError(null);
    try {
      const nextResult = await loadDatabaseTablePageOnce({
        connection_id: connectionId,
        database: target.database,
        table: target.table,
        page,
        page_size: pageSize,
        sort_column: sortColumn,
        sort_direction: sortDirection,
        order_by: orderBy || null,
        filter: filter || null,
      });
      setResult(nextResult);
      setActiveEditingCell(null);
      setNewRows([]);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
      void logFrontendError("frontend.database", "load_database_table_page", caught, `${connectionId}:${target.database}:${target.table}`, {
        database: target.database,
        table: target.table,
      });
    } finally {
      setIsLoading(false);
    }
  }

  function applyFilter() {
    runAfterDiscardConfirmation(() => {
      setPage(1);
      setFilter(filterInput.trim());
    });
  }

  function applyOrderBy() {
    runAfterDiscardConfirmation(() => {
      setPage(1);
      setSortColumn(null);
      setSortDirection(null);
      setOrderBy(orderByInput.trim());
    });
  }

  function toggleSort(columnName: string) {
    runAfterDiscardConfirmation(() => {
      setOrderByInput("");
      setOrderBy("");
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
    });
  }

  const totalPages = result ? Math.max(1, Math.ceil(result.total_rows / result.page_size)) : 1;
  const canGoPrevious = page > 1 && !isLoading;
  const canGoNext = Boolean(result && page < totalPages && !isLoading);
  const pageStart = result && result.total_rows > 0 ? (result.page - 1) * result.page_size + 1 : 0;
  const pageEnd = result ? Math.min(result.page * result.page_size, result.total_rows) : 0;

  function goToPage(nextPage: number) {
    runAfterDiscardConfirmation(() => {
      const normalizedPage = normalizePage(String(nextPage));
      setPage(normalizedPage);
    });
  }

  function selectPageSize(nextPageSize: number) {
    setIsPageSizeMenuOpen(false);
    runAfterDiscardConfirmation(() => {
      setPage(1);
      setPageSize(nextPageSize);
    });
  }

  function newRowIndex(rowIndex: number) {
    if (!result || rowIndex < result.rows.length) return -1;
    return rowIndex - result.rows.length;
  }

  function isNewRow(rowIndex: number) {
    return newRowIndex(rowIndex) >= 0;
  }

  function displayedRows() {
    if (!result) return [];
    return [
      ...result.rows,
      ...newRows.map((row) => result.columns.map((column) => row.values[column.name] ?? { kind: "text", value: "" } as DatabaseCellValue)),
    ];
  }

  function addRow() {
    if (!result) return;
    const values = Object.fromEntries(result.columns.map((column) => [column.name, { kind: "text", value: "" } as DatabaseCellValue]));
    setNewRows((current) => [...current, { id: `new-${Date.now()}-${current.length}`, values }]);
  }

  function setActiveEditingCell(nextEditingCell: EditingCell) {
    editingCellRef.current = nextEditingCell;
    setEditingCell(nextEditingCell);
  }

  function commitEditingBeforeOutsidePointerDown(event: ReactMouseEvent) {
    const currentEditingCell = editingCellRef.current;
    if (!currentEditingCell) return;
    if (event.target instanceof Element && event.target.closest("input, textarea, select, [contenteditable='true']")) return;
    commitEditingCell(editingInputRef.current?.value ?? currentEditingCell.value);
  }

  function cellContextMenuItems(
    rowIndex: number,
    column: DatabaseResultColumn,
    displayed: DatabaseCellValue,
    copySelectedRange: () => void,
  ): DatabaseDataGridContextMenuItem[] {
    if (!result) return [];
    return [
      {
        label: t("database.copy_cell"),
        onSelect: () => void writeClipboardText(formatCellValue(displayed)),
      },
      {
        label: t("database.copy_selected_cells"),
        onSelect: copySelectedRange,
      },
      {
        label: t("database.copy_row"),
        onSelect: () => void writeClipboardText(formatTableRow(result, rowIndex, dirtyRows, newRows)),
      },
      {
        label: t("database.copy_column_name"),
        onSelect: () => void writeClipboardText(column.name),
      },
      {
        label: t("database.delete_row"),
        disabled: !result.editable,
        onSelect: () => requestDeleteRow(rowIndex),
      },
    ];
  }

  function isPrimaryKeyColumn(columnName: string) {
    return result?.primary_key_columns.includes(columnName) ?? false;
  }

  function editableCell(columnName: string) {
    return Boolean(result?.editable && !isPrimaryKeyColumn(columnName));
  }

  function displayedCell(rowIndex: number, columnName: string, original: DatabaseCellValue) {
    const newIndex = newRowIndex(rowIndex);
    if (newIndex >= 0) return newRows[newIndex]?.values[columnName] ?? original;
    return dirtyRows[rowIndex]?.[columnName] ?? original;
  }

  function requestEditCell(rowIndex: number, column: DatabaseResultColumn, displayed: DatabaseCellValue) {
    if (!editableCell(column.name) && !isNewRow(rowIndex)) return;
    setActiveEditingCell({ rowIndex, columnName: column.name, value: cellText(displayed) });
  }

  function clearCell(rowIndex: number, column: DatabaseResultColumn) {
    if (!result) return;
    if (!editableCell(column.name) && !isNewRow(rowIndex)) return;
    const newIndex = newRowIndex(rowIndex);
    if (newIndex >= 0) {
      setNewRows((current) => current.map((row, index) => {
        if (index !== newIndex) return row;
        return {
          ...row,
          values: {
            ...row.values,
            [column.name]: { kind: "text", value: "" },
          },
        };
      }));
      return;
    }
    const columnIndex = result.columns.findIndex((currentColumn) => currentColumn.name === column.name);
    const original = result.rows[rowIndex]?.[columnIndex];
    if (!original) return;
    if (cellText(original) === "") {
      setDirtyRows((current) => removeDirtyCell(current, rowIndex, column.name));
      return;
    }
    setDirtyRows((current) => ({
      ...current,
      [rowIndex]: {
        ...(current[rowIndex] ?? {}),
        [column.name]: { kind: "text", value: "" },
      },
    }));
  }

  async function pasteClipboardIntoCells(rowIndex: number, columnIndex: number) {
    if (!result) return;
    const text = await readClipboardText();
    const values = parseClipboardTable(text);
    if (values.length === 0) return;
    const rowCount = displayedRows().length;
    const updates: DirtyRows = {};
    const removals: Array<{ rowIndex: number; columnName: string }> = [];
    const nextNewRows = [...newRows];
    let hasNewRowUpdates = false;

    values.forEach((rowValues, rowOffset) => {
      const nextRowIndex = rowIndex + rowOffset;
      if (nextRowIndex >= rowCount) return;
      rowValues.forEach((value, columnOffset) => {
        const nextColumnIndex = columnIndex + columnOffset;
        const column = result.columns[nextColumnIndex];
        if (!column) return;
        if (!editableCell(column.name) && !isNewRow(nextRowIndex)) return;
        const newIndex = newRowIndex(nextRowIndex);
        if (newIndex >= 0) {
          nextNewRows[newIndex] = {
            ...nextNewRows[newIndex],
            values: {
              ...nextNewRows[newIndex].values,
              [column.name]: { kind: "text", value },
            },
          };
          hasNewRowUpdates = true;
          return;
        }
        const original = result.rows[nextRowIndex]?.[nextColumnIndex];
        if (!original) return;
        if (value === cellText(original)) {
          removals.push({ rowIndex: nextRowIndex, columnName: column.name });
          return;
        }
        updates[nextRowIndex] = {
          ...(updates[nextRowIndex] ?? {}),
          [column.name]: { kind: "text", value },
        };
      });
    });

    if (Object.keys(updates).length === 0 && removals.length === 0 && !hasNewRowUpdates) return;
    setDirtyRows((current) => {
      const cleaned = removals.reduce((next, removal) => removeDirtyCell(next, removal.rowIndex, removal.columnName), current);
      return mergeDirtyRows(cleaned, updates);
    });
    if (hasNewRowUpdates) {
      setNewRows(nextNewRows);
    }
  }

  function commitEditingCell(nextValue = editingCellRef.current?.value ?? "") {
    const currentEditingCell = editingCellRef.current;
    if (!currentEditingCell || !result) return;
    const newIndex = newRowIndex(currentEditingCell.rowIndex);
    if (newIndex >= 0) {
      setNewRows((current) => current.map((row, index) => {
        if (index !== newIndex) return row;
        return {
          ...row,
          values: {
            ...row.values,
            [currentEditingCell.columnName]: { kind: "text", value: nextValue },
          },
        };
      }));
      setActiveEditingCell(null);
      return;
    }
    const columnIndex = result.columns.findIndex((column) => column.name === currentEditingCell.columnName);
    const original = result.rows[currentEditingCell.rowIndex]?.[columnIndex];
    if (original && nextValue === cellText(original)) {
      setDirtyRows((current) => removeDirtyCell(current, currentEditingCell.rowIndex, currentEditingCell.columnName));
      setActiveEditingCell(null);
      return;
    }
    setDirtyRows((current) => ({
      ...current,
      [currentEditingCell.rowIndex]: {
        ...(current[currentEditingCell.rowIndex] ?? {}),
        [currentEditingCell.columnName]: { kind: "text", value: nextValue },
      },
    }));
    setActiveEditingCell(null);
  }

  function runAfterDiscardConfirmation(action: () => void) {
    if (dirtyFieldCount === 0 && newRows.length === 0) {
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

  function buildInsertRows(): DatabaseTableInsertRow[] {
    return newRows.map((row) => ({
      values: Object.fromEntries(
        Object.entries(row.values).filter(([, value]) => !isEmptyInsertCell(value)),
      ),
    }));
  }

  function buildDeleteRows(rowIndex: number): DatabaseTableDeleteRow[] {
    if (!result) return [];
    const row = result.rows[rowIndex];
    return [{
      primary_key_values: Object.fromEntries(result.primary_key_columns.map((columnName) => {
        const index = result.columns.findIndex((column) => column.name === columnName);
        return [columnName, row[index]];
      })),
    }];
  }

  async function saveChanges() {
    if (!result || (dirtyFieldCount === 0 && newRows.length === 0)) return;
    setIsSaving(true);
    setError(null);
    try {
      if (newRows.length > 0) {
        await callBackend<DatabaseTableUpdateResult>("insert_database_table_rows", {
          request: {
            connection_id: connectionId,
            database: target.database,
            table: target.table,
            rows: buildInsertRows(),
          },
        });
      }
      if (dirtyFieldCount > 0) {
        await callBackend<DatabaseTableUpdateResult>("update_database_table_rows", {
          request: {
            connection_id: connectionId,
            database: target.database,
            table: target.table,
            primary_key_columns: result.primary_key_columns,
            rows: buildUpdateRows(),
          },
        });
      }
      setDirtyRows({});
      setNewRows([]);
      setConfirmDialog(null);
      await loadPage();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
      void logFrontendError("frontend.database", "save_database_table_rows", caught, `${connectionId}:${target.database}:${target.table}`, {
        database: target.database,
        table: target.table,
        row_count: changedRowCount,
      });
    } finally {
      setIsSaving(false);
    }
  }

  function discardChanges() {
    setDirtyRows({});
    setNewRows([]);
    setConfirmDialog(null);
    const action = pendingAction;
    setPendingAction(null);
    action?.();
  }

  function requestDeleteRow(rowIndex: number) {
    if (isNewRow(rowIndex)) {
      const nextNewRows = newRows.filter((_, index) => index !== newRowIndex(rowIndex));
      setNewRows(nextNewRows);
      return;
    }
    setDeleteTarget({ rowIndex });
  }

  async function deleteRow() {
    if (!result || !deleteTarget) return;
    setIsSaving(true);
    setError(null);
    try {
      await callBackend<DatabaseTableUpdateResult>("delete_database_table_rows", {
        request: {
          connection_id: connectionId,
          database: target.database,
          table: target.table,
          primary_key_columns: result.primary_key_columns,
          rows: buildDeleteRows(deleteTarget.rowIndex),
        },
      });
      setDeleteTarget(null);
      await loadPage();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
      void logFrontendError("frontend.database", "delete_database_table_rows", caught, `${connectionId}:${target.database}:${target.table}`, {
        database: target.database,
        table: target.table,
        row_count: 1,
      });
    } finally {
      setIsSaving(false);
    }
  }

  const dirtyRowCount = Object.keys(dirtyRows).length;
  const dirtyFieldCount = Object.values(dirtyRows).reduce((total, row) => total + Object.keys(row).length, 0);
  const changedRowCount = dirtyRowCount + newRows.length;
  const changedFieldCount = dirtyFieldCount + newRows.reduce((total, row) => total + Object.keys(row.values).length, 0);

  return (
    <section
      className="database-table-browser"
      aria-label={t("database.table_browser")}
      onMouseDownCapture={commitEditingBeforeOutsidePointerDown}
    >
      <header className="database-table-browser__toolbar">
        <span>{t("database.table_label", { table: target.table })}</span>
        <button
          type="button"
          className="database-icon-button database-icon-button--ghost"
          aria-label={t("database.add_row")}
          title={t("database.add_row")}
          disabled={!result?.editable || isSaving}
          onClick={addRow}
        >
          <AppIcon icon={AddRowIcon} decorative />
        </button>
        <button
          type="button"
          className="database-icon-button database-icon-button--ghost"
          aria-label={t("database.save_changes")}
          title={t("database.save_changes")}
          disabled={changedFieldCount === 0 || isSaving}
          onClick={() => setConfirmDialog("save")}
        >
          <AppIcon icon={SaveChangesIcon} decorative />
        </button>
        <button
          type="button"
          className="database-icon-button database-icon-button--ghost"
          aria-label={t("database.discard_changes")}
          title={t("database.discard_changes")}
          disabled={changedFieldCount === 0 || isSaving}
          onClick={() => setConfirmDialog("discard")}
        >
          <AppIcon icon={DiscardChangesIcon} decorative />
        </button>
        {changedFieldCount > 0 ? (
          <span>{t("database.unsaved_changes", { rows: changedRowCount, fields: changedFieldCount })}</span>
        ) : null}
        {result && !result.editable ? (
          <span className="database-table-browser__readonly">
            {t("database.readonly_no_primary_key")}
          </span>
        ) : null}
        <button
          type="button"
          className="database-icon-button database-icon-button--ghost"
          aria-label={t("database.refresh")}
          title={isLoading ? t("database.loading") : t("database.refresh")}
          disabled={isLoading}
          onClick={() => runAfterDiscardConfirmation(() => void loadPage())}
        >
          <AppIcon icon={RefreshIcon} decorative />
        </button>
      </header>
      <div className="database-table-browser__criteria">
        <label className="database-table-browser__criteria-field database-table-browser__filter">
          <span>{t("database.where_clause")}</span>
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
        <label className="database-table-browser__criteria-field database-table-browser__order">
          <span>{t("database.order_by")}</span>
          <input
            aria-label={t("database.order_by_input")}
            value={orderByInput}
            placeholder="如 id desc"
            onBlur={applyOrderBy}
            onChange={(event) => setOrderByInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") applyOrderBy();
            }}
          />
        </label>
      </div>
      {error ? <p className="database-table-browser__error" role="alert">{error}</p> : null}
      {result ? (
        <DatabaseDataGrid
          columns={result.columns}
          rows={displayedRows()}
          dirtyRows={dirtyRows}
          page={result.page}
          pageSize={result.page_size}
          sortColumn={sortColumn}
          sortDirection={sortDirection}
          onSortColumn={toggleSort}
          getRowState={(rowIndex): DatabaseDataGridNewRowState => isNewRow(rowIndex) ? "new" : "none"}
          getCellState={(rowIndex, column, original) => {
            const displayed = displayedCell(rowIndex, column.name, original);
            const isEditing = editingCell?.rowIndex === rowIndex && editingCell.columnName === column.name;
            return {
              value: displayed,
              dirty: Boolean(dirtyRows[rowIndex]?.[column.name]),
              editing: isEditing,
              editable: editableCell(column.name) || isNewRow(rowIndex),
              newRow: isNewRow(rowIndex) ? "new" : "none",
              editor: isEditing ? (
                <input
                  ref={editingInputRef}
                  aria-label={`编辑 ${column.name}`}
                  autoFocus
                  value={editingCell.value}
                  onBlur={(event) => commitEditingCell(event.currentTarget.value)}
                  onChange={(event) => setActiveEditingCell({ ...editingCell, value: event.target.value })}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      focusEditingCell(event.currentTarget);
                      commitEditingCell(event.currentTarget.value);
                    }
                    if (event.key === "Escape") {
                      focusEditingCell(event.currentTarget);
                      setActiveEditingCell(null);
                    }
                  }}
                />
              ) : null,
            };
          }}
          onCellDoubleClick={requestEditCell}
          onEditCellRequest={requestEditCell}
          onClearCellRequest={clearCell}
          onPasteCellsRequest={(rowIndex, columnIndex) => void pasteClipboardIntoCells(rowIndex, columnIndex)}
          getContextMenuItems={cellContextMenuItems}
          footer={(
            <div className="database-table-browser__pagination" aria-label={t("database.pagination")}>
          <button
            type="button"
            className="database-icon-button"
            aria-label={t("database.first_page")}
            title={t("database.first_page")}
            disabled={!canGoPrevious}
            onClick={() => goToPage(1)}
          >
            <AppIcon icon={FirstPageIcon} decorative />
          </button>
          <button
            type="button"
            className="database-icon-button"
            aria-label={t("database.previous_page")}
            title={t("database.previous_page")}
            disabled={!canGoPrevious}
            onClick={() => goToPage(Math.max(1, page - 1))}
          >
            <AppIcon icon={PreviousPageIcon} decorative />
          </button>
          <div className="database-table-browser__page-size">
            <button
              type="button"
              aria-label={t("database.page_size")}
              aria-haspopup="menu"
              aria-expanded={isPageSizeMenuOpen}
              onClick={() => setIsPageSizeMenuOpen((current) => !current)}
            >
              <span>{pageStart}-{pageEnd}</span>
              <AppIcon icon={PageSizeIcon} decorative />
            </button>
            {isPageSizeMenuOpen ? (
              <div className="database-table-browser__page-size-menu" role="menu" aria-label={t("database.page_size_menu_title")}>
                <strong>{t("database.page_size_menu_title")}</strong>
                {PAGE_SIZE_OPTIONS.map((option) => (
                  <button
                    key={option}
                    type="button"
                    role="menuitemradio"
                    aria-checked={pageSize === option}
                    onClick={() => selectPageSize(option)}
                  >
                    <span>{pageSize === option ? "✓" : ""}</span>
                    <span>{option.toLocaleString()}</span>
                    {option === DEFAULT_PAGE_SIZE ? <em>{t("database.default_page_size")}</em> : null}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          <span>{t("database.total_rows_compact", { total: result?.total_rows ?? 0 })}</span>
          <button
            type="button"
            className="database-icon-button"
            aria-label={t("database.next_page")}
            title={t("database.next_page")}
            disabled={!canGoNext}
            onClick={() => goToPage(page + 1)}
          >
            <AppIcon icon={NextPageIcon} decorative />
          </button>
          <button
            type="button"
            className="database-icon-button"
            aria-label={t("database.last_page")}
            title={t("database.last_page")}
            disabled={!canGoNext}
            onClick={() => goToPage(totalPages)}
          >
            <AppIcon icon={LastPageIcon} decorative />
          </button>
            </div>
          )}
        />
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
                ? t("database.confirm_save_changes_message", { rows: changedRowCount, fields: changedFieldCount })
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
      {deleteTarget ? (
        <div className="connection-dialog__backdrop">
          <div
            className="connection-dialog database-dialog"
            role="dialog"
            aria-modal="true"
            aria-label={t("database.confirm_delete_row")}
          >
            <header className="database-dialog__header">
              <h2>{t("database.confirm_delete_row")}</h2>
            </header>
            <p>{t("database.confirm_delete_row_message")}</p>
            <div className="database-dialog__actions">
              <button type="button" onClick={() => setDeleteTarget(null)}>
                {t("database.cancel")}
              </button>
              <button type="button" disabled={isSaving} onClick={() => void deleteRow()}>
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

function focusEditingCell(editor: HTMLInputElement) {
  const cell = editor.closest("td");
  if (cell instanceof HTMLElement) {
    cell.focus();
  }
}

function isEmptyInsertCell(cell: DatabaseCellValue) {
  return cell.kind === "text" && cell.value === "";
}

function parseClipboardTable(text: string) {
  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").replace(/\n$/, "");
  if (normalized.length === 0) return [];
  return normalized.split("\n").map((line) => line.split("\t"));
}

function mergeDirtyRows(current: DirtyRows, updates: DirtyRows) {
  return Object.entries(updates).reduce<DirtyRows>((next, [rowIndex, rowUpdates]) => ({
    ...next,
    [Number(rowIndex)]: {
      ...(next[Number(rowIndex)] ?? {}),
      ...rowUpdates,
    },
  }), current);
}

function removeDirtyCell(dirtyRows: DirtyRows, rowIndex: number, columnName: string) {
  const rowChanges = { ...(dirtyRows[rowIndex] ?? {}) };
  delete rowChanges[columnName];
  if (Object.keys(rowChanges).length === 0) {
    const { [rowIndex]: _removed, ...rest } = dirtyRows;
    void _removed;
    return rest;
  }
  return {
    ...dirtyRows,
    [rowIndex]: rowChanges,
  };
}

function formatTableRow(result: DatabaseTablePageResult, rowIndex: number, dirtyRows: DirtyRows, newRows: NewRow[]) {
  const newIndex = rowIndex - result.rows.length;
  const row = newIndex >= 0
    ? result.columns.map((column) => newRows[newIndex]?.values[column.name] ?? { kind: "null" } as DatabaseCellValue)
    : result.rows[rowIndex] ?? [];
  return row.map((cell, cellIndex) => {
    const columnName = result.columns[cellIndex]?.name;
    if (!columnName) return formatCellValue(cell);
    return formatCellValue(dirtyRows[rowIndex]?.[columnName] ?? cell);
  }).join("\t");
}
