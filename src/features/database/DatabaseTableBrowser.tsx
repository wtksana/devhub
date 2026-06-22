import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { useI18n } from "../../i18n/useI18n";
import { callBackend } from "../../lib/tauri";
import { ContextMenu, type ContextMenuState } from "../../app/ContextMenu";
import { AppIcon } from "../../app/AppIcon";
import { writeClipboardText } from "../../lib/clipboard";
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

const DEFAULT_PAGE_SIZE = 200;
const PAGE_SIZE_OPTIONS = [10, 100, 200, 400, 500, 1000];
const MIN_DATA_COLUMN_WIDTH = 96;
const MAX_DATA_COLUMN_WIDTH = 240;
const CHARACTER_WIDTH = 9;
const CELL_HORIZONTAL_PADDING = 24;

interface DatabaseTableBrowserProps {
  connectionId: string;
  target: DatabaseTableBrowserTarget;
}

type DirtyRows = Record<number, Record<string, DatabaseCellValue>>;
type EditingCell = { rowIndex: number; columnName: string; value: string } | null;
type SelectedCell = { rowIndex: number; columnName: string } | null;
type CellPosition = { rowIndex: number; columnIndex: number };
type SelectionRange = { anchor: CellPosition; focus: CellPosition } | null;
type NewRow = { id: string; values: Record<string, DatabaseCellValue> };
type DeleteTarget = { rowIndex: number } | null;

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
  const [selectedCell, setSelectedCell] = useState<SelectedCell>(null);
  const [selectionRange, setSelectionRange] = useState<SelectionRange>(null);
  const [isSelectingRange, setIsSelectingRange] = useState(false);
  const [confirmDialog, setConfirmDialog] = useState<"save" | "discard" | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget>(null);
  const [pendingAction, setPendingAction] = useState<(() => void) | null>(null);
  const [isPageSizeMenuOpen, setIsPageSizeMenuOpen] = useState(false);
  const [cellContextMenu, setCellContextMenu] = useState<ContextMenuState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
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
    setEditingCell(null);
    setSelectedCell(null);
    setSelectionRange(null);
    setIsSelectingRange(false);
    setIsPageSizeMenuOpen(false);
  }, [target.database, target.table]);

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

  useEffect(() => {
    function handleMouseUp() {
      setIsSelectingRange(false);
    }

    window.addEventListener("mouseup", handleMouseUp);
    return () => window.removeEventListener("mouseup", handleMouseUp);
  }, []);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (editingCell || !selectionRange || !result) return;
      if (event.key.toLowerCase() !== "c" || (!event.ctrlKey && !event.metaKey)) return;
      event.preventDefault();
      void writeClipboardText(formatSelectedRange(result, displayedRows(), dirtyRows, selectionRange));
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [dirtyRows, editingCell, newRows, result, selectionRange]);

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
          order_by: orderBy || null,
          filter: filter || null,
        },
      });
      setResult(nextResult);
      setEditingCell(null);
      setSelectedCell(null);
      setNewRows([]);
      setSelectionRange(null);
      setIsSelectingRange(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
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

  function cellText(cell: DatabaseCellValue) {
    if (cell.kind === "null") return "";
    if (cell.kind === "bool") return String(cell.value);
    return cell.value;
  }

  function displayRowNumber(rowIndex: number) {
    if (!result) return rowIndex + 1;
    if (rowIndex < result.rows.length) return (result.page - 1) * result.page_size + rowIndex + 1;
    return result.total_rows + rowIndex - result.rows.length + 1;
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
    const rowIndex = result.rows.length + newRows.length;
    setNewRows((current) => [...current, { id: `new-${Date.now()}-${current.length}`, values }]);
    setSelectedCell({ rowIndex, columnName: result.columns[0]?.name ?? "" });
    setSelectionRange(result.columns[0] ? { anchor: { rowIndex, columnIndex: 0 }, focus: { rowIndex, columnIndex: 0 } } : null);
  }

  function startCellSelection(event: ReactMouseEvent, rowIndex: number, columnIndex: number) {
    if (event.button !== 0) return;
    if (event.target instanceof Element && event.target.closest("input, textarea, select, [contenteditable='true']")) return;
    event.preventDefault();
    const columnName = result?.columns[columnIndex]?.name;
    if (!columnName) return;
    setEditingCell(null);
    setSelectedCell({ rowIndex, columnName });
    setSelectionRange({ anchor: { rowIndex, columnIndex }, focus: { rowIndex, columnIndex } });
    setIsSelectingRange(true);
  }

  function extendCellSelection(rowIndex: number, columnIndex: number) {
    if (!isSelectingRange) return;
    setSelectionRange((current) => current ? { ...current, focus: { rowIndex, columnIndex } } : current);
  }

  function copySelectedRange() {
    if (!result || !selectionRange) return;
    void writeClipboardText(formatSelectedRange(result, displayedRows(), dirtyRows, selectionRange));
  }

  function openCellContextMenu(event: ReactMouseEvent, rowIndex: number, columnName: string) {
    if (!result) return;
    event.preventDefault();
    const columnIndex = result.columns.findIndex((column) => column.name === columnName);
    const rows = displayedRows();
    const row = rows[rowIndex];
    const cell = row?.[columnIndex];
    if (!row || !cell) return;
    const displayed = displayedCell(rowIndex, columnName, cell);
    setSelectedCell({ rowIndex, columnName });
    setCellContextMenu({
      x: event.clientX,
      y: event.clientY,
      items: [
        {
          label: t("database.copy_cell"),
          onSelect: () => void writeClipboardText(formatCellValue(displayed)),
        },
        {
          label: t("database.copy_selected_cells"),
          disabled: !selectionRange,
          onSelect: copySelectedRange,
        },
        {
          label: t("database.copy_row"),
          onSelect: () => void writeClipboardText(formatTableRow(result, rowIndex, dirtyRows, newRows)),
        },
        {
          label: t("database.copy_column_name"),
          onSelect: () => void writeClipboardText(columnName),
        },
        { type: "separator" },
        {
          label: t("database.delete_row"),
          disabled: !result.editable,
          onSelect: () => requestDeleteRow(rowIndex),
        },
      ],
    });
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

  function isCellInSelectionRange(rowIndex: number, columnIndex: number) {
    if (!selectionRange) return false;
    const startRow = Math.min(selectionRange.anchor.rowIndex, selectionRange.focus.rowIndex);
    const endRow = Math.max(selectionRange.anchor.rowIndex, selectionRange.focus.rowIndex);
    const startColumn = Math.min(selectionRange.anchor.columnIndex, selectionRange.focus.columnIndex);
    const endColumn = Math.max(selectionRange.anchor.columnIndex, selectionRange.focus.columnIndex);
    return rowIndex >= startRow && rowIndex <= endRow && columnIndex >= startColumn && columnIndex <= endColumn;
  }

  function commitEditingCell() {
    if (!editingCell || !result) return;
    const newIndex = newRowIndex(editingCell.rowIndex);
    if (newIndex >= 0) {
      setNewRows((current) => current.map((row, index) => {
        if (index !== newIndex) return row;
        return {
          ...row,
          values: {
            ...row.values,
            [editingCell.columnName]: { kind: "text", value: editingCell.value },
          },
        };
      }));
      setEditingCell(null);
      return;
    }
    const columnIndex = result.columns.findIndex((column) => column.name === editingCell.columnName);
    const original = result.rows[editingCell.rowIndex]?.[columnIndex];
    if (original && editingCell.value === cellText(original)) {
      setDirtyRows((current) => {
        const rowChanges = { ...(current[editingCell.rowIndex] ?? {}) };
        delete rowChanges[editingCell.columnName];
        if (Object.keys(rowChanges).length === 0) {
          const { [editingCell.rowIndex]: _removed, ...rest } = current;
          void _removed;
          return rest;
        }
        return {
          ...current,
          [editingCell.rowIndex]: rowChanges,
        };
      });
      setEditingCell(null);
      return;
    }
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
      setSelectedCell(null);
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
    } finally {
      setIsSaving(false);
    }
  }

  const dirtyRowCount = Object.keys(dirtyRows).length;
  const dirtyFieldCount = Object.values(dirtyRows).reduce((total, row) => total + Object.keys(row).length, 0);
  const changedRowCount = dirtyRowCount + newRows.length;
  const changedFieldCount = dirtyFieldCount + newRows.reduce((total, row) => total + Object.keys(row.values).length, 0);
  const columnWidths = useMemo(() => calculateColumnWidths(result), [result]);
  const tableWidth = result ? 52 + result.columns.reduce((total, column) => total + (columnWidths[column.name] ?? MIN_DATA_COLUMN_WIDTH), 0) : undefined;

  return (
    <section className="database-table-browser" aria-label={t("database.table_browser")}>
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
        <div className="database-table-browser__table-shell">
          <div className="database-result__table-wrap database-table-browser__table-wrap">
            <table style={tableWidth ? { width: `${tableWidth}px` } : undefined}>
              <colgroup>
                <col className="database-table-browser__row-number-column" />
                {result.columns.map((column) => (
                  <col
                    key={column.name}
                    className="database-table-browser__data-column"
                    style={{ width: `${columnWidths[column.name] ?? MIN_DATA_COLUMN_WIDTH}px` }}
                  />
                ))}
              </colgroup>
              <thead>
                <tr>
                  <th className="database-table-browser__row-number" scope="col" aria-label={t("database.row_number")}></th>
                  {result.columns.map((column) => (
                    <th key={column.name} scope="col" aria-label={`${column.name} ${column.data_type}`} title={columnTooltip(column.name, column.data_type)}>
                      <button type="button" aria-label={sortButtonLabel(column.name, column.data_type, sortColumn === column.name ? sortDirection : null)} onClick={() => toggleSort(column.name)}>
                        <span>{column.name}</span>
                        {sortColumn === column.name && sortDirection ? <span>{sortDirection === "asc" ? "↑" : "↓"}</span> : null}
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {displayedRows().length > 0 ? displayedRows().map((row, rowIndex) => (
                  <tr
                    key={rowIndex}
                    className={[
                      selectedCell?.rowIndex === rowIndex ? "database-table-browser__row--selected" : "",
                      isNewRow(rowIndex) ? "database-table-browser__row--new" : "",
                    ].filter(Boolean).join(" ") || undefined}
                  >
                    <td className="database-table-browser__row-number">{displayRowNumber(rowIndex)}</td>
                    {row.map((cell, cellIndex) => {
                      const column = result.columns[cellIndex];
                      const displayed = displayedCell(rowIndex, column.name, cell);
                      const isDirty = Boolean(dirtyRows[rowIndex]?.[column.name]);
                      const isEditing = editingCell?.rowIndex === rowIndex && editingCell.columnName === column.name;
                      const isSelected = selectedCell?.rowIndex === rowIndex && selectedCell.columnName === column.name;
                      const isRangeSelected = isCellInSelectionRange(rowIndex, cellIndex);
                      const display = displayCellValue(displayed, column, isNewRow(rowIndex));
                      const className = [
                        display.placeholder && displayed.kind === "null" ? "database-table-browser__cell--null" : "",
                        displayed.kind === "number" ? "database-table-browser__cell--number" : "",
                        isDirty ? "database-table-browser__cell--dirty" : "",
                        isRangeSelected ? "database-table-browser__cell--range-selected" : "",
                        isSelected ? "database-table-browser__cell--selected" : "",
                        isEditing ? "database-table-browser__cell--editing" : "",
                      ].filter(Boolean).join(" ") || undefined;
                      return (
                        <td
                          key={cellIndex}
                          aria-label={`第 ${displayRowNumber(rowIndex)} 行 ${column.name}`}
                          className={className}
                          onMouseDown={(event) => startCellSelection(event, rowIndex, cellIndex)}
                          onMouseEnter={() => extendCellSelection(rowIndex, cellIndex)}
                          onMouseUp={() => setIsSelectingRange(false)}
                          onClick={() => setSelectedCell({ rowIndex, columnName: column.name })}
                          onContextMenu={(event) => openCellContextMenu(event, rowIndex, column.name)}
                          onDoubleClick={() => {
                            if (!editableCell(column.name) && !isNewRow(rowIndex)) return;
                            setSelectedCell({ rowIndex, columnName: column.name });
                            setEditingCell({ rowIndex, columnName: column.name, value: cellText(displayed) });
                          }}
                        >
                          {isEditing ? (
                            <input
                              ref={editingInputRef}
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
                          ) : (
                            <span
                              className={[
                                "database-table-browser__cell-content",
                                display.placeholder ? "database-table-browser__cell-placeholder" : "",
                              ].filter(Boolean).join(" ")}
                              title={display.text}
                            >
                              {display.text}
                            </span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                )) : (
                  <tr>
                    <td colSpan={result.columns.length + 1}>{t("database.query_result_empty")}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
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
      <ContextMenu menu={cellContextMenu} onClose={() => setCellContextMenu(null)} />
    </section>
  );
}

function normalizePage(value: string) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return 1;
  return parsed;
}

function formatCellValue(cell: DatabaseCellValue) {
  if (cell.kind === "null") return "null";
  if (cell.kind === "bool") return String(cell.value);
  return cell.value;
}

function displayCellValue(cell: DatabaseCellValue, column: DatabaseResultColumn, isNewRow: boolean) {
  if (isNewRow && cell.kind === "text" && cell.value === "") {
    if (column.generated) return { text: "<generated>", placeholder: true };
    if (column.has_default) return { text: "<default>", placeholder: true };
    if (column.nullable) return { text: "<null>", placeholder: true };
  }
  if (cell.kind === "null") return { text: "null", placeholder: true };
  return { text: formatCellValue(cell), placeholder: false };
}

function isEmptyInsertCell(cell: DatabaseCellValue) {
  return cell.kind === "text" && cell.value === "";
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

function formatSelectedRange(
  result: DatabaseTablePageResult,
  rows: DatabaseCellValue[][],
  dirtyRows: DirtyRows,
  selection: NonNullable<SelectionRange>,
) {
  const startRow = Math.min(selection.anchor.rowIndex, selection.focus.rowIndex);
  const endRow = Math.max(selection.anchor.rowIndex, selection.focus.rowIndex);
  const startColumn = Math.min(selection.anchor.columnIndex, selection.focus.columnIndex);
  const endColumn = Math.max(selection.anchor.columnIndex, selection.focus.columnIndex);
  const lines: string[] = [];

  for (let rowIndex = startRow; rowIndex <= endRow; rowIndex += 1) {
    const row = rows[rowIndex];
    if (!row) continue;
    const values: string[] = [];
    for (let columnIndex = startColumn; columnIndex <= endColumn; columnIndex += 1) {
      const columnName = result.columns[columnIndex]?.name;
      const cell = row[columnIndex];
      if (!columnName || !cell) {
        values.push("");
        continue;
      }
      values.push(formatCellValue(dirtyRows[rowIndex]?.[columnName] ?? cell));
    }
    lines.push(values.join("\t"));
  }

  return lines.join("\n");
}

function sortButtonLabel(columnName: string, dataType: string, direction: DatabaseSortDirection | null) {
  const suffix = direction === "asc" ? " ↑" : direction === "desc" ? " ↓" : "";
  return `${columnName} ${dataType}${suffix}`;
}

function columnTooltip(columnName: string, dataType: string) {
  return dataType ? `${columnName}: ${dataType}` : columnName;
}

function calculateColumnWidths(result: DatabaseTablePageResult | null) {
  if (!result) return {};
  return Object.fromEntries(result.columns.map((column, columnIndex) => {
    const maxLength = result.rows.reduce((currentMax, row) => {
      const cell = row[columnIndex];
      return Math.max(currentMax, cell ? formatCellValue(cell).length : 0);
    }, column.name.length);
    const width = Math.min(
      MAX_DATA_COLUMN_WIDTH,
      Math.max(MIN_DATA_COLUMN_WIDTH, Math.ceil(maxLength * CHARACTER_WIDTH + CELL_HORIZONTAL_PADDING)),
    );
    return [column.name, width];
  }));
}
