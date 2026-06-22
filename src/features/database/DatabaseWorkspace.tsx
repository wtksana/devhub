import { useEffect, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent } from "react";
import Editor from "@monaco-editor/react";
import type { OnMount } from "@monaco-editor/react";
import { callBackend } from "../../lib/tauri";
import type {
  DatabaseCellValue,
  DatabaseQueryResult,
  DatabaseSqlFile,
  DatabaseTableBrowserTarget,
  DatabaseTreeNode,
  DatabaseWorkspaceProps,
} from "./databaseTypes";
import { DatabaseObjectTree } from "./DatabaseObjectTree";
import { DatabaseTableBrowser } from "./DatabaseTableBrowser";
import { useI18n } from "../../i18n/useI18n";
import { ContextMenu } from "../../app/ContextMenu";
import type { ContextMenuState } from "../../app/ContextMenu";
import { readClipboardText, writeClipboardText } from "../../lib/clipboard";
import collapseEditorIcon from "../../assets/icons/oi--collapse-up.png";
import expandEditorIcon from "../../assets/icons/oi--expand-down.png";
import sqlFileIcon from "../../assets/icons/ph--file-sql-light.png";

const DEFAULT_SQL_LIMIT = 200;
const DEFAULT_OBJECT_TREE_WIDTH = 220;
const MIN_OBJECT_TREE_WIDTH = 180;
const MAX_OBJECT_TREE_WIDTH = 420;
const CREATE_SQL_FILE_VALUE = "__create_sql_file__";
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

export function DatabaseWorkspace({ connectionId, initialDatabase, theme, fontFamily, fontSize }: DatabaseWorkspaceProps) {
  const { t } = useI18n();
  const [sql, setSql] = useState("");
  const [result, setResult] = useState<DatabaseQueryResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isExecuting, setIsExecuting] = useState(false);
  const [dangerousSqlToConfirm, setDangerousSqlToConfirm] = useState<string | null>(null);
  const [currentDatabase, setCurrentDatabase] = useState(initialDatabase?.trim() ?? "");
  const [tableBrowserTarget, setTableBrowserTarget] = useState<DatabaseTableBrowserTarget | null>(null);
  const [isEditorOpen, setIsEditorOpen] = useState(true);
  const [sqlFiles, setSqlFiles] = useState<DatabaseSqlFile[]>([]);
  const [selectedSqlFileName, setSelectedSqlFileName] = useState("default");
  const [isSqlFileLoaded, setIsSqlFileLoaded] = useState(false);
  const [defaultLimit, setDefaultLimit] = useState(String(DEFAULT_SQL_LIMIT));
  const [newSqlFileName, setNewSqlFileName] = useState("");
  const [isCreateSqlFileDialogOpen, setIsCreateSqlFileDialogOpen] = useState(false);
  const [objectTreeWidth, setObjectTreeWidth] = useState(DEFAULT_OBJECT_TREE_WIDTH);
  const [isResizingObjectTree, setIsResizingObjectTree] = useState(false);
  const [editorContextMenu, setEditorContextMenu] = useState<ContextMenuState | null>(null);
  const [tableContextMenu, setTableContextMenu] = useState<ContextMenuState | null>(null);
  const [tableStructureDialog, setTableStructureDialog] = useState<{ table: DatabaseTreeNode; columns: DatabaseTreeNode[]; error: string | null } | null>(null);
  const objectTreeResizeRef = useRef({ startX: 0, startWidth: DEFAULT_OBJECT_TREE_WIDTH });
  const latestSqlFileKeyRef = useRef("");
  const monacoEditorRef = useRef<Parameters<OnMount>[0] | null>(null);

  useEffect(() => {
    setCurrentDatabase(initialDatabase?.trim() ?? "");
  }, [connectionId, initialDatabase]);

  useEffect(() => {
    let isActive = true;
    setIsSqlFileLoaded(false);
    if (!currentDatabase) {
      setSqlFiles([]);
      setSelectedSqlFileName("default");
      setSql("");
      return;
    }

    callBackend<DatabaseSqlFile[]>("list_database_sql_files", {
      request: {
        connection_id: connectionId,
        database: currentDatabase,
      },
    })
      .then((files) => {
        if (!isActive) return;
        const nextFiles = sortSqlFiles(files.length > 0 ? files : [{ name: "default", content: "" }]);
        const defaultFile = nextFiles.find((file) => file.name === "default") ?? nextFiles[0];
        setSqlFiles(nextFiles);
        setSelectedSqlFileName(defaultFile.name);
        setSql(defaultFile.content);
        latestSqlFileKeyRef.current = sqlFileKey(connectionId, currentDatabase, defaultFile.name);
        setIsSqlFileLoaded(true);
      })
      .catch((caught) => {
        if (!isActive) return;
        console.error("[devhub] load database SQL files failed", caught);
        setSqlFiles([{ name: "default", content: "" }]);
        setSelectedSqlFileName("default");
        setSql("");
        latestSqlFileKeyRef.current = sqlFileKey(connectionId, currentDatabase, "default");
        setIsSqlFileLoaded(true);
      });

    return () => {
      isActive = false;
    };
  }, [connectionId, currentDatabase]);

  useEffect(() => {
    if (!isSqlFileLoaded || !currentDatabase || !selectedSqlFileName) return;
    const key = sqlFileKey(connectionId, currentDatabase, selectedSqlFileName);
    latestSqlFileKeyRef.current = key;
    const timer = window.setTimeout(() => {
      if (latestSqlFileKeyRef.current !== key) return;
      void callBackend("save_database_sql_file", {
        request: {
          connection_id: connectionId,
          database: currentDatabase,
          name: selectedSqlFileName,
          content: sql,
        },
      });
    }, 500);
    return () => window.clearTimeout(timer);
  }, [connectionId, currentDatabase, isSqlFileLoaded, selectedSqlFileName, sql]);

  useEffect(() => {
    if (!isResizingObjectTree) return;

    function handleMouseMove(event: MouseEvent) {
      const nextWidth = objectTreeResizeRef.current.startWidth + event.clientX - objectTreeResizeRef.current.startX;
      setObjectTreeWidth(clamp(nextWidth, MIN_OBJECT_TREE_WIDTH, MAX_OBJECT_TREE_WIDTH));
    }

    function handleMouseUp() {
      setIsResizingObjectTree(false);
    }

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isResizingObjectTree]);

  useEffect(() => {
    if (!tableStructureDialog) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        requestCloseTableStructureDialog();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [tableStructureDialog]);

  function startObjectTreeResize(event: React.MouseEvent) {
    event.preventDefault();
    objectTreeResizeRef.current = {
      startX: event.clientX,
      startWidth: objectTreeWidth,
    };
    setIsResizingObjectTree(true);
  }

  async function requestExecuteSql(sqlToExecute: string) {
    const trimmedSql = sqlToExecute.trim();
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
          database: currentDatabase || null,
          sql: sqlToExecute,
          limit: normalizeLimit(defaultLimit),
        },
      });
      setResult(nextResult);
      setTableBrowserTarget(null);
    } catch (caught) {
      setResult(null);
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setIsExecuting(false);
    }
  }

  function openTable(node: DatabaseTreeNode) {
    if (!currentDatabase) return;
    setResult(null);
    setError(null);
    setTableBrowserTarget({ database: currentDatabase, table: node.name });
  }

  function openTableContextMenu(event: ReactMouseEvent, node: DatabaseTreeNode) {
    event.preventDefault();
    setTableContextMenu({
      x: event.clientX,
      y: event.clientY,
      items: [
        {
          label: t("database.copy_table_name"),
          onSelect: () => void writeClipboardText(node.name),
        },
        {
          label: t("database.edit_table"),
          onSelect: () => void openTableStructureDialog(node),
        },
        {
          label: t("database.ddl"),
          disabled: true,
          onSelect: () => {},
        },
      ],
    });
  }

  async function openTableStructureDialog(node: DatabaseTreeNode) {
    if (!currentDatabase) return;
    setTableStructureDialog({ table: node, columns: [], error: null });
    try {
      const columns = await callBackend<DatabaseTreeNode[]>("list_database_objects", {
        request: {
          connection_id: connectionId,
          parent_kind: node.kind,
          database: currentDatabase,
          schema: currentDatabase,
          table: node.name,
        },
      });
      setTableStructureDialog({ table: node, columns: Array.isArray(columns) ? columns : [], error: null });
    } catch (caught) {
      setTableStructureDialog({
        table: node,
        columns: [],
        error: caught instanceof Error ? caught.message : String(caught),
      });
    }
  }

  function requestCloseTableStructureDialog() {
    // 后续表结构支持编辑后，在这里检查 dirty 状态并弹二次确认。
    setTableStructureDialog(null);
  }

  function switchSqlFile(nextName: string) {
    if (nextName === CREATE_SQL_FILE_VALUE) {
      setNewSqlFileName("");
      setIsCreateSqlFileDialogOpen(true);
      return;
    }
    const nextFile = sqlFiles.find((file) => file.name === nextName);
    if (!nextFile) return;
    setSelectedSqlFileName(nextFile.name);
    setSql(nextFile.content);
  }

  function getSelectedSql() {
    const editor = monacoEditorRef.current;
    if (!editor) return "";
    const selection = editor.getSelection();
    const model = editor.getModel();
    if (!selection || selection.isEmpty() || !model) return "";
    return model.getValueInRange(selection);
  }

  function handleEditorMount(editor: Parameters<OnMount>[0], monaco: Parameters<OnMount>[1]) {
    monacoEditorRef.current = editor;
    void monaco;
  }

  function openEditorContextMenu(event: React.MouseEvent) {
    event.preventDefault();
    const selectedSql = getSelectedSql();
    setEditorContextMenu({
      x: event.clientX,
      y: event.clientY,
      items: [
        {
          label: t("database.execute_selected_sql"),
          disabled: !selectedSql.trim(),
          onSelect: () => void requestExecuteSql(selectedSql),
        },
        { type: "separator" },
        {
          label: "Cut",
          onSelect: () => triggerEditorCommand("editor.action.clipboardCutAction"),
        },
        {
          label: "Copy",
          onSelect: () => triggerEditorCommand("editor.action.clipboardCopyAction"),
        },
        {
          label: "Paste",
          onSelect: () => void pasteClipboardText(),
        },
      ],
    });
  }

  function triggerEditorCommand(commandId: string) {
    const editor = monacoEditorRef.current;
    if (!editor) return;
    editor.focus();
    editor.trigger("devhub", commandId, null);
  }

  async function pasteClipboardText() {
    const editor = monacoEditorRef.current;
    if (!editor) return;
    editor.focus();
    const text = await readClipboardText();
    if (!text) return;
    const selection = editor.getSelection();
    if (!selection) return;
    editor.pushUndoStop();
    editor.executeEdits("devhub", [{ range: selection, text, forceMoveMarkers: true }]);
    editor.pushUndoStop();
  }

  async function createSqlFile() {
    const name = newSqlFileName.trim();
    if (!name || !currentDatabase) return;
    await callBackend("save_database_sql_file", {
      request: {
        connection_id: connectionId,
        database: currentDatabase,
        name,
        content: "",
      },
    });
    const nextFiles = sortSqlFiles([...sqlFiles.filter((file) => file.name !== name), { name, content: "" }]);
    setSqlFiles(nextFiles);
    setSelectedSqlFileName(name);
    setSql("");
    setIsCreateSqlFileDialogOpen(false);
  }

  function closeCreateSqlFileDialog() {
    setIsCreateSqlFileDialogOpen(false);
    setNewSqlFileName("");
  }

  return (
    <section
      className="database-workspace"
      aria-label={t("database.workspace")}
      style={{ "--database-object-tree-width": `${objectTreeWidth}px` } as CSSProperties}
    >
      <DatabaseObjectTree
        connectionId={connectionId}
        selectedDatabase={currentDatabase}
        onDatabaseChange={setCurrentDatabase}
        onOpenTable={openTable}
        onTableContextMenu={openTableContextMenu}
      />
      <div
        role="separator"
        aria-label="调整数据库表列表宽度"
        aria-orientation="vertical"
        className="panel-resize-handle panel-resize-handle--database-tree"
        onMouseDown={startObjectTreeResize}
      />
      <div className="database-workspace__main" data-editor-open={isEditorOpen}>
        <div className="database-query-panel">
          <div className="database-query-panel__toolbar">
            <span>{t("database.sql_editor")}</span>
            <button
              type="button"
              className="database-icon-button"
              aria-label={isEditorOpen ? t("database.collapse_editor") : t("database.open_editor")}
              title={isEditorOpen ? t("database.collapse_editor") : t("database.open_editor")}
              onClick={() => setIsEditorOpen((current) => !current)}
            >
              <img aria-hidden="true" src={isEditorOpen ? collapseEditorIcon : expandEditorIcon} alt="" />
            </button>
            <label>
              <span className="database-query-panel__icon-label" title={t("database.sql_file")}>
                <img aria-hidden="true" src={sqlFileIcon} alt="" />
              </span>
              <select
                aria-label={t("database.sql_file")}
                value={selectedSqlFileName}
                disabled={sqlFiles.length === 0}
                onChange={(event) => switchSqlFile(event.target.value)}
              >
                <option value={CREATE_SQL_FILE_VALUE}>{t("database.create_sql_file")}</option>
                {sqlFiles.map((file) => (
                  <option key={file.name} value={file.name}>{file.name}</option>
                ))}
              </select>
            </label>
            <label>
              <span>{t("database.default_limit_label")}</span>
              <input
                aria-label={t("database.default_limit_label")}
                type="number"
                min="1"
                value={defaultLimit}
                onChange={(event) => setDefaultLimit(event.target.value)}
              />
            </label>
            <span className="database-query-panel__monaco">{t("database.monaco_support")}</span>
          </div>
          {isEditorOpen ? (
            <div className="database-query-panel__editor" onContextMenu={openEditorContextMenu}>
              <Editor
                height="100%"
                defaultLanguage="sql"
                value={sql}
                theme={theme === "dark" ? "vs-dark" : "light"}
                wrapperProps={{ "aria-label": t("database.sql_editor") }}
                onMount={handleEditorMount}
                onChange={(value) => setSql(value ?? "")}
                options={{
                  automaticLayout: true,
                  contextmenu: false,
                  fontFamily,
                  fontSize,
                  lineNumbers: "on",
                  minimap: { enabled: false },
                  scrollBeyondLastLine: false,
                  tabSize: 2,
                  wordWrap: "on",
                }}
              />
            </div>
          ) : null}
          {error ? <p className="database-query-panel__error" role="alert">{error}</p> : null}
        </div>
        <div className="database-workspace__content">
          {tableBrowserTarget ? (
            <DatabaseTableBrowser connectionId={connectionId} target={tableBrowserTarget} />
          ) : result ? <DatabaseResultView result={result} /> : (
            <div className="database-workspace__empty" aria-label={t("database.query_result")}>{t("database.empty_query_result")}</div>
          )}
        </div>
      </div>
      <ContextMenu menu={editorContextMenu} onClose={() => setEditorContextMenu(null)} />
      <ContextMenu menu={tableContextMenu} onClose={() => setTableContextMenu(null)} />
      {dangerousSqlToConfirm ? (
        <div className="connection-dialog__backdrop">
          <div
            className="connection-dialog database-dialog"
            role="dialog"
            aria-modal="true"
            aria-label={t("database.confirm_dangerous_sql")}
          >
            <header className="database-dialog__header">
              <h2>{t("database.confirm_dangerous_sql")}</h2>
            </header>
            <p>{t("database.dangerous_sql_message")}</p>
            <pre className="database-dangerous-sql__preview">{dangerousSqlToConfirm}</pre>
            <div className="database-dialog__actions">
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
      {isCreateSqlFileDialogOpen ? (
        <div className="connection-dialog__backdrop">
          <div
            className="connection-dialog database-dialog database-sql-file-dialog"
            role="dialog"
            aria-modal="true"
            aria-label={t("database.create_sql_file")}
            onKeyDown={(event) => {
              if (event.key === "Escape") closeCreateSqlFileDialog();
            }}
          >
            <header className="database-dialog__header">
              <h2>{t("database.create_sql_file")}</h2>
            </header>
            <label className="database-create-sql-file__field">
              <span>{t("database.sql_file_name")}</span>
              <input
                aria-label={t("database.sql_file_name")}
                autoFocus
                value={newSqlFileName}
                onChange={(event) => setNewSqlFileName(event.target.value)}
              />
            </label>
            <div className="database-dialog__actions">
              <button type="button" onClick={closeCreateSqlFileDialog}>
                {t("database.cancel")}
              </button>
              <button type="button" disabled={!newSqlFileName.trim()} onClick={() => void createSqlFile()}>
                {t("database.confirm")}
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {tableStructureDialog ? (
        <div className="connection-dialog__backdrop">
          <div
            className="connection-dialog database-dialog database-table-structure-dialog"
            role="dialog"
            aria-modal="true"
            aria-label={t("database.edit_table_title", { table: tableStructureDialog.table.name })}
          >
            <header className="database-dialog__header">
              <h2>{t("database.edit_table_title", { table: tableStructureDialog.table.name })}</h2>
            </header>
            <div className="database-table-structure-dialog__body">
              {tableStructureDialog.error ? <p role="alert">{tableStructureDialog.error}</p> : null}
              <table>
                <thead>
                  <tr>
                    <th scope="col">{t("database.column_name")}</th>
                    <th scope="col">{t("database.column_type")}</th>
                    <th scope="col">{t("database.nullable")}</th>
                  </tr>
                </thead>
                <tbody>
                  {tableStructureDialog.columns.map((column) => {
                    const detail = parseColumnDetail(column.detail);
                    return (
                      <tr key={column.id}>
                        <td>{column.name}</td>
                        <td>{detail.dataType}</td>
                        <td>{formatNullable(detail.nullable, t)}</td>
                      </tr>
                    );
                  })}
                  {tableStructureDialog.columns.length === 0 && !tableStructureDialog.error ? (
                    <tr>
                      <td colSpan={3}>{t("database.no_columns")}</td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
            <div className="database-dialog__actions">
              <button type="button" onClick={requestCloseTableStructureDialog}>
                {t("database.cancel")}
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
                  <th key={column.name} scope="col" aria-label={`${column.name} ${column.data_type}`} title={columnTooltip(column.name, column.data_type)}>
                    <span>{column.name}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {result.rows.length > 0 ? result.rows.map((row, rowIndex) => (
                <tr key={rowIndex}>
                  {row.map((cell, cellIndex) => (
                    <td key={cellIndex}>
                      <span className="database-result__cell-content" title={formatCellValue(cell)}>
                        {formatCellValue(cell)}
                      </span>
                    </td>
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

function columnTooltip(columnName: string, dataType: string) {
  return dataType ? `${columnName}: ${dataType}` : columnName;
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

function sqlFileKey(connectionId: string, database: string, name: string) {
  return `${connectionId}\n${database}\n${name}`;
}

function sortSqlFiles(files: DatabaseSqlFile[]) {
  const defaultFile = files.find((file) => file.name === "default") ?? { name: "default", content: "" };
  const otherFiles = files
    .filter((file) => file.name !== "default")
    .sort((left, right) => left.name.localeCompare(right.name));
  return [defaultFile, ...otherFiles];
}

function normalizeLimit(value: string) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return DEFAULT_SQL_LIMIT;
  return parsed;
}

function parseColumnDetail(detail?: string | null) {
  const trimmed = detail?.trim() ?? "";
  const nullableMatch = trimmed.match(/\s+(YES|NO)$/i);
  return {
    dataType: nullableMatch ? trimmed.slice(0, nullableMatch.index).trim() : trimmed,
    nullable: nullableMatch?.[1]?.toUpperCase() ?? "",
  };
}

function formatNullable(nullable: string, t: ReturnType<typeof useI18n>["t"]) {
  if (nullable === "YES") return t("database.yes");
  if (nullable === "NO") return t("database.no");
  return nullable || "-";
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
