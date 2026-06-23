import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import { ContextMenu, type ContextMenuState } from "../../app/ContextMenu";
import { writeClipboardText } from "../../lib/clipboard";
import { useI18n } from "../../i18n/useI18n";
import type { DatabaseCellValue, DatabaseResultColumn, DatabaseSortDirection } from "./databaseTypes";

const MIN_DATA_COLUMN_WIDTH = 96;
const MAX_DATA_COLUMN_WIDTH = 240;
const CHARACTER_WIDTH = 9;
const CELL_HORIZONTAL_PADDING = 24;
const ROW_NUMBER_COLUMN_WIDTH = 52;

export type DatabaseDataGridDirtyRows = Record<number, Record<string, DatabaseCellValue>>;
export type DatabaseDataGridNewRowState = "none" | "new";
export type DatabaseDataGridCellState = {
  value: DatabaseCellValue;
  dirty?: boolean;
  editing?: boolean;
  editable?: boolean;
  newRow?: DatabaseDataGridNewRowState;
  editor?: ReactNode;
};
export type DatabaseDataGridContextMenuItem = {
  label: string;
  disabled?: boolean;
  onSelect: () => void;
};

interface DatabaseDataGridProps {
  columns: DatabaseResultColumn[];
  rows: DatabaseCellValue[][];
  dirtyRows?: DatabaseDataGridDirtyRows;
  sortColumn?: string | null;
  sortDirection?: DatabaseSortDirection | null;
  page?: number;
  pageSize?: number;
  footer?: ReactNode;
  onSortColumn?: (columnName: string) => void;
  getCellState?: (rowIndex: number, column: DatabaseResultColumn, original: DatabaseCellValue) => DatabaseDataGridCellState;
  getRowState?: (rowIndex: number) => DatabaseDataGridNewRowState;
  onCellDoubleClick?: (rowIndex: number, column: DatabaseResultColumn, displayed: DatabaseCellValue) => void;
  onEditCellRequest?: (rowIndex: number, column: DatabaseResultColumn, displayed: DatabaseCellValue) => void;
  onClearCellRequest?: (rowIndex: number, column: DatabaseResultColumn) => void;
  onPasteCellsRequest?: (rowIndex: number, columnIndex: number) => void;
  getContextMenuItems?: (rowIndex: number, column: DatabaseResultColumn, displayed: DatabaseCellValue, copySelectedRange: () => void) => DatabaseDataGridContextMenuItem[];
}

type SelectedCell = { rowIndex: number; columnName: string } | null;
type CellPosition = { rowIndex: number; columnIndex: number };
type SelectionRange = { anchor: CellPosition; focus: CellPosition } | null;

export function DatabaseDataGrid({
  columns,
  rows,
  dirtyRows = {},
  sortColumn,
  sortDirection,
  page = 1,
  pageSize,
  footer,
  onSortColumn,
  getCellState,
  getRowState,
  onCellDoubleClick,
  onEditCellRequest,
  onClearCellRequest,
  onPasteCellsRequest,
  getContextMenuItems,
}: DatabaseDataGridProps) {
  const { t } = useI18n();
  const [selectedCell, setSelectedCell] = useState<SelectedCell>(null);
  const [selectionRange, setSelectionRange] = useState<SelectionRange>(null);
  const [isSelectingRange, setIsSelectingRange] = useState(false);
  const [cellContextMenu, setCellContextMenu] = useState<ContextMenuState | null>(null);
  const tableCellRefs = useRef<Record<string, HTMLTableCellElement | null>>({});
  const gridShapeKey = `${columns.map((column) => column.name).join("\n")}\n${rows.length}`;

  useEffect(() => {
    setSelectedCell(null);
    setSelectionRange(null);
    setIsSelectingRange(false);
  }, [gridShapeKey]);

  useEffect(() => {
    function handleMouseUp() {
      setIsSelectingRange(false);
    }

    window.addEventListener("mouseup", handleMouseUp);
    return () => window.removeEventListener("mouseup", handleMouseUp);
  }, []);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (!selectedCell) return;
      if (isTextInputEventTarget(event.target)) return;
      if (event.key.toLowerCase() === "c" && (event.ctrlKey || event.metaKey)) {
        if (!selectionRange) return;
        event.preventDefault();
        copySelectedRange();
        return;
      }
      if (event.key.toLowerCase() === "v" && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        const position = selectedPosition();
        if (position) onPasteCellsRequest?.(position.rowIndex, position.columnIndex);
        return;
      }
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.key === "ArrowUp") {
        event.preventDefault();
        moveSelectedCell(-1, 0);
        return;
      }
      if (event.key === "ArrowDown") {
        event.preventDefault();
        moveSelectedCell(1, 0);
        return;
      }
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        moveSelectedCell(0, -1);
        return;
      }
      if (event.key === "ArrowRight") {
        event.preventDefault();
        moveSelectedCell(0, 1);
        return;
      }
      if (event.key === "Tab") {
        event.preventDefault();
        moveSelectedCell(0, event.shiftKey ? -1 : 1);
        return;
      }
      if (event.key === "Enter" || event.key === "F2") {
        event.preventDefault();
        requestEditSelectedCell();
        return;
      }
      if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        const position = selectedPosition();
        const column = position ? columns[position.columnIndex] : null;
        if (position && column) onClearCellRequest?.(position.rowIndex, column);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [columns, dirtyRows, rows, selectedCell, selectionRange]);

  const columnWidths = useMemo(() => calculateColumnWidths(columns, rows), [columns, rows]);
  const tableWidth = ROW_NUMBER_COLUMN_WIDTH + columns.reduce((total, column) => total + (columnWidths[column.name] ?? MIN_DATA_COLUMN_WIDTH), 0);

  function displayRowNumber(rowIndex: number) {
    if (pageSize) return (page - 1) * pageSize + rowIndex + 1;
    return rowIndex + 1;
  }

  function cellState(rowIndex: number, column: DatabaseResultColumn, original: DatabaseCellValue): DatabaseDataGridCellState {
    return getCellState?.(rowIndex, column, original) ?? {
      value: dirtyRows[rowIndex]?.[column.name] ?? original,
      dirty: Boolean(dirtyRows[rowIndex]?.[column.name]),
    };
  }

  function selectCell(rowIndex: number, columnIndex: number) {
    if (rows.length === 0 || columns.length === 0) return;
    const normalizedRowIndex = Math.max(0, Math.min(rowIndex, rows.length - 1));
    const normalizedColumnIndex = Math.max(0, Math.min(columnIndex, columns.length - 1));
    const columnName = columns[normalizedColumnIndex]?.name;
    if (!columnName) return;
    setSelectedCell({ rowIndex: normalizedRowIndex, columnName });
    setSelectionRange({
      anchor: { rowIndex: normalizedRowIndex, columnIndex: normalizedColumnIndex },
      focus: { rowIndex: normalizedRowIndex, columnIndex: normalizedColumnIndex },
    });
    tableCellRefs.current[cellKey(normalizedRowIndex, normalizedColumnIndex)]?.focus();
  }

  function selectedPosition() {
    if (!selectedCell) return null;
    const columnIndex = columns.findIndex((column) => column.name === selectedCell.columnName);
    if (columnIndex < 0) return null;
    return { rowIndex: selectedCell.rowIndex, columnIndex };
  }

  function moveSelectedCell(rowDelta: number, columnDelta: number) {
    const position = selectedPosition();
    if (!position) return;
    selectCell(position.rowIndex + rowDelta, position.columnIndex + columnDelta);
  }

  function requestEditSelectedCell() {
    const position = selectedPosition();
    const column = position ? columns[position.columnIndex] : null;
    const original = position ? rows[position.rowIndex]?.[position.columnIndex] : null;
    if (!position || !column || !original) return;
    onEditCellRequest?.(position.rowIndex, column, cellState(position.rowIndex, column, original).value);
  }

  function startCellSelection(event: ReactMouseEvent, rowIndex: number, columnIndex: number) {
    if (event.button !== 0) return;
    if (isTextInputEventTarget(event.target)) return;
    event.preventDefault();
    selectCell(rowIndex, columnIndex);
    setIsSelectingRange(true);
  }

  function extendCellSelection(rowIndex: number, columnIndex: number) {
    if (!isSelectingRange) return;
    setSelectionRange((current) => current ? { ...current, focus: { rowIndex, columnIndex } } : current);
  }

  function isCellInSelectionRange(rowIndex: number, columnIndex: number) {
    if (!selectionRange) return false;
    const startRow = Math.min(selectionRange.anchor.rowIndex, selectionRange.focus.rowIndex);
    const endRow = Math.max(selectionRange.anchor.rowIndex, selectionRange.focus.rowIndex);
    const startColumn = Math.min(selectionRange.anchor.columnIndex, selectionRange.focus.columnIndex);
    const endColumn = Math.max(selectionRange.anchor.columnIndex, selectionRange.focus.columnIndex);
    return rowIndex >= startRow && rowIndex <= endRow && columnIndex >= startColumn && columnIndex <= endColumn;
  }

  function copySelectedRange() {
    if (!selectionRange) return;
    void writeClipboardText(formatSelectedRange(columns, rows, dirtyRows, selectionRange));
  }

  function openCellContextMenu(event: ReactMouseEvent, rowIndex: number, column: DatabaseResultColumn, displayed: DatabaseCellValue) {
    event.preventDefault();
    setSelectedCell({ rowIndex, columnName: column.name });
    const defaultItems: DatabaseDataGridContextMenuItem[] = [
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
        label: t("database.copy_column_name"),
        onSelect: () => void writeClipboardText(column.name),
      },
    ];
    const items = getContextMenuItems?.(rowIndex, column, displayed, copySelectedRange) ?? defaultItems;
    setCellContextMenu({
      x: event.clientX,
      y: event.clientY,
      items,
    });
  }

  return (
    <div className="database-table-browser__table-shell">
      <div className="database-result__table-wrap database-table-browser__table-wrap">
        <table style={{ width: `${tableWidth}px` }}>
          <colgroup>
            <col className="database-table-browser__row-number-column" />
            {columns.map((column) => (
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
              {columns.map((column) => (
                <th key={column.name} scope="col" aria-label={`${column.name} ${column.data_type}`} title={columnTooltip(column.name, column.data_type)}>
                  {onSortColumn ? (
                    <button type="button" aria-label={sortButtonLabel(column.name, column.data_type, sortColumn === column.name ? sortDirection ?? null : null)} onClick={() => onSortColumn(column.name)}>
                      <span>{column.name}</span>
                      {sortColumn === column.name && sortDirection ? <span>{sortDirection === "asc" ? "↑" : "↓"}</span> : null}
                    </button>
                  ) : (
                    <span>{column.name}</span>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length > 0 ? rows.map((row, rowIndex) => {
              const rowState = getRowState?.(rowIndex) ?? "none";
              return (
                <tr
                  key={rowIndex}
                  className={[
                    selectedCell?.rowIndex === rowIndex ? "database-table-browser__row--selected" : "",
                    rowState === "new" ? "database-table-browser__row--new" : "",
                  ].filter(Boolean).join(" ") || undefined}
                >
                  <td className="database-table-browser__row-number">{displayRowNumber(rowIndex)}</td>
                  {row.map((cell, cellIndex) => {
                    const column = columns[cellIndex];
                    const state = cellState(rowIndex, column, cell);
                    const displayed = state.value;
                    const isSelected = selectedCell?.rowIndex === rowIndex && selectedCell.columnName === column.name;
                    const isRangeSelected = isCellInSelectionRange(rowIndex, cellIndex);
                    const display = displayCellValue(displayed, column, rowState === "new");
                    const className = [
                      display.placeholder && displayed.kind === "null" ? "database-table-browser__cell--null" : "",
                      displayed.kind === "number" ? "database-table-browser__cell--number" : "",
                      state.dirty ? "database-table-browser__cell--dirty" : "",
                      isRangeSelected ? "database-table-browser__cell--range-selected" : "",
                      isSelected ? "database-table-browser__cell--selected" : "",
                      state.editing ? "database-table-browser__cell--editing" : "",
                    ].filter(Boolean).join(" ") || undefined;
                    return (
                      <td
                        key={cellIndex}
                        ref={(element) => {
                          tableCellRefs.current[cellKey(rowIndex, cellIndex)] = element;
                        }}
                        tabIndex={0}
                        aria-label={`第 ${displayRowNumber(rowIndex)} 行 ${column.name}`}
                        className={className}
                        onMouseDown={(event) => startCellSelection(event, rowIndex, cellIndex)}
                        onMouseEnter={() => extendCellSelection(rowIndex, cellIndex)}
                        onMouseUp={() => setIsSelectingRange(false)}
                        onClick={(event) => {
                          if (isTextInputEventTarget(event.target)) return;
                          selectCell(rowIndex, cellIndex);
                        }}
                        onContextMenu={(event) => openCellContextMenu(event, rowIndex, column, displayed)}
                        onDoubleClick={() => {
                          selectCell(rowIndex, cellIndex);
                          onCellDoubleClick?.(rowIndex, column, displayed);
                        }}
                      >
                        {state.editing && state.editor ? state.editor : (
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
              );
            }) : (
              <tr>
                <td colSpan={columns.length + 1}>{t("database.query_result_empty")}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {footer}
      <ContextMenu menu={cellContextMenu} onClose={() => setCellContextMenu(null)} />
    </div>
  );
}

export function formatCellValue(cell: DatabaseCellValue) {
  if (cell.kind === "null") return "null";
  if (cell.kind === "bool") return String(cell.value);
  return cell.value;
}

export function cellText(cell: DatabaseCellValue) {
  if (cell.kind === "null") return "";
  if (cell.kind === "bool") return String(cell.value);
  return cell.value;
}

export function displayCellValue(cell: DatabaseCellValue, column: DatabaseResultColumn, isNewRow: boolean) {
  if (isNewRow && cell.kind === "text" && cell.value === "") {
    if (column.generated) return { text: "<generated>", placeholder: true };
    if (column.has_default) return { text: "<default>", placeholder: true };
    if (column.nullable) return { text: "<null>", placeholder: true };
  }
  if (cell.kind === "null") return { text: "null", placeholder: true };
  return { text: formatCellValue(cell), placeholder: false };
}

export function formatSelectedRange(
  columns: DatabaseResultColumn[],
  rows: DatabaseCellValue[][],
  dirtyRows: DatabaseDataGridDirtyRows,
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
      const columnName = columns[columnIndex]?.name;
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

export function columnTooltip(columnName: string, dataType: string) {
  return dataType ? `${columnName}: ${dataType}` : columnName;
}

export function sortButtonLabel(columnName: string, dataType: string, direction: DatabaseSortDirection | null) {
  const suffix = direction === "asc" ? " ↑" : direction === "desc" ? " ↓" : "";
  return `${columnName} ${dataType}${suffix}`;
}

function calculateColumnWidths(columns: DatabaseResultColumn[], rows: DatabaseCellValue[][]) {
  return Object.fromEntries(columns.map((column, columnIndex) => {
    const maxLength = rows.reduce((currentMax, row) => {
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

function isTextInputEventTarget(target: EventTarget | null) {
  return target instanceof Element && Boolean(target.closest("input, textarea, select, [contenteditable='true']"));
}

function cellKey(rowIndex: number, columnIndex: number) {
  return `${rowIndex}:${columnIndex}`;
}
