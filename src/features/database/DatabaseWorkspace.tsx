import { useEffect, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent } from "react";
import Editor from "@monaco-editor/react";
import type { OnMount } from "@monaco-editor/react";
import { logFrontendError } from "../../lib/appLogging";
import { callBackend } from "../../lib/tauri";
import type {
  DatabaseQueryResult,
  DatabaseCellValue,
  DatabaseResultColumn,
  DatabaseResultExportFormat,
  DatabaseResultExportResult,
  DatabaseSqlFileExecutionResult,
  DatabaseSqlFile,
  DatabaseSqlFilePreview,
  DatabaseTableBrowserTarget,
  DatabaseTableDdlResult,
  DatabaseTreeNode,
  DatabaseWorkspaceProps,
} from "./databaseTypes";
import { DatabaseObjectTree } from "./DatabaseObjectTree";
import { DatabaseTableBrowser } from "./DatabaseTableBrowser";
import { useI18n } from "../../i18n/useI18n";
import { ContextMenu } from "../../app/ContextMenu";
import type { ContextMenuState } from "../../app/ContextMenu";
import { AppIcon } from "../../app/AppIcon";
import { readClipboardText, writeClipboardText } from "../../lib/clipboard";
import { pickDatabaseExportPath, pickSqlFile } from "../../lib/fileDialog";
import { DatabaseDataGrid } from "./DatabaseDataGrid";
import CollapseEditorIcon from "../../assets/icons/oi--collapse-up.svg?react";
import ExpandEditorIcon from "../../assets/icons/oi--expand-down.svg?react";
import SqlFileIcon from "../../assets/icons/ph--file-sql-light.svg?react";
import ExecuteSqlFileIcon from "../../assets/icons/tabler--file-import.svg?react";
import ExportIcon from "../../assets/icons/mdi--table-export.svg?react";

const DEFAULT_SQL_LIMIT = 200;
const DEFAULT_QUERY_TIMEOUT_MS = 30_000;
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

const pendingSqlFileRequests = new Map<string, Promise<DatabaseSqlFile[]>>();

type PendingExport = {
  columns: DatabaseResultColumn[];
  rows: DatabaseCellValue[][];
  table: string | null;
  format: DatabaseResultExportFormat;
  includeHeader: boolean;
  selectedColumns: string[];
};

type SqlFileExecutionState =
  | { status: "idle"; message: string }
  | { status: "running"; message: string }
  | { status: "success"; message: string }
  | { status: "error"; message: string };

type QueryExecutionState =
  | { status: "idle"; message: string }
  | { status: "running"; message: string }
  | { status: "canceled"; message: string }
  | { status: "timeout"; message: string };

function listDatabaseSqlFilesOnce(connectionId: string, database: string) {
  const key = `${connectionId}:${database}`;
  const pendingRequest = pendingSqlFileRequests.get(key);
  if (pendingRequest) return pendingRequest;

  const requestPromise = callBackend<DatabaseSqlFile[]>("list_database_sql_files", {
    request: {
      connection_id: connectionId,
      database,
    },
  }).finally(() => {
    pendingSqlFileRequests.delete(key);
  });
  pendingSqlFileRequests.set(key, requestPromise);
  return requestPromise;
}

export function DatabaseWorkspace({
  connectionId,
  initialDatabase,
  theme,
  fontFamily,
  fontSize,
  queryTimeoutMs = DEFAULT_QUERY_TIMEOUT_MS,
}: DatabaseWorkspaceProps) {
  const { t } = useI18n();
  const [sql, setSql] = useState("");
  const [result, setResult] = useState<DatabaseQueryResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isExecuting, setIsExecuting] = useState(false);
  const [dangerousSqlToConfirm, setDangerousSqlToConfirm] = useState<string | null>(null);
  const [queryExecutionState, setQueryExecutionState] = useState<QueryExecutionState>({ status: "idle", message: "" });
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
  const [tableDdlDialog, setTableDdlDialog] = useState<{ table: DatabaseTreeNode; ddl: string; durationMs: number | null; error: string | null } | null>(null);
  const [sqlFilePreview, setSqlFilePreview] = useState<DatabaseSqlFilePreview | null>(null);
  const [isSqlFileExecuting, setIsSqlFileExecuting] = useState(false);
  const [sqlFileExecutionState, setSqlFileExecutionState] = useState<SqlFileExecutionState>({ status: "idle", message: "" });
  const [exportMessage, setExportMessage] = useState("");
  const [pendingExport, setPendingExport] = useState<PendingExport | null>(null);
  const [pendingInsertExport, setPendingInsertExport] = useState<{ columns: DatabaseResultColumn[]; rows: DatabaseCellValue[][]; includeHeader: boolean } | null>(null);
  const [insertExportTableName, setInsertExportTableName] = useState("");
  const objectTreeResizeRef = useRef({ startX: 0, startWidth: DEFAULT_OBJECT_TREE_WIDTH });
  const latestSqlFileKeyRef = useRef("");
  const dirtySqlFileKeysRef = useRef(new Set<string>());
  const monacoEditorRef = useRef<Parameters<OnMount>[0] | null>(null);
  const queryExecutionIdRef = useRef(0);

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

    listDatabaseSqlFilesOnce(connectionId, currentDatabase)
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
        void logFrontendError("frontend.database", "list_database_sql_files", caught, `${connectionId}:${currentDatabase}`);
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
    if (!dirtySqlFileKeysRef.current.has(key)) return;
    latestSqlFileKeyRef.current = key;
    const timer = window.setTimeout(() => {
      if (latestSqlFileKeyRef.current !== key) return;
      void saveSqlFileContent(currentDatabase, selectedSqlFileName, sql).then(() => {
        dirtySqlFileKeysRef.current.delete(key);
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
    if (!tableStructureDialog && !tableDdlDialog && !sqlFilePreview && !pendingExport && !pendingInsertExport) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        if (tableStructureDialog) requestCloseTableStructureDialog();
        if (tableDdlDialog) setTableDdlDialog(null);
        if (sqlFilePreview) closeSqlFilePreview();
        if (pendingExport) setPendingExport(null);
        if (pendingInsertExport) setPendingInsertExport(null);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [pendingExport, pendingInsertExport, sqlFilePreview, tableDdlDialog, tableStructureDialog]);

  function closeSqlFilePreview() {
    setSqlFilePreview(null);
    setSqlFileExecutionState({ status: "idle", message: "" });
    setIsSqlFileExecuting(false);
  }

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
    const executionId = queryExecutionIdRef.current + 1;
    queryExecutionIdRef.current = executionId;
    setIsExecuting(true);
    setQueryExecutionState({ status: "running", message: t("database.query_running") });
    setError(null);
    try {
      const queryPromise = callBackend<DatabaseQueryResult>("execute_database_query", {
        request: {
          connection_id: connectionId,
          database: currentDatabase || null,
          sql: sqlToExecute,
          limit: normalizeLimit(defaultLimit),
        },
      });
      const nextResult = await withTimeout(queryPromise, queryTimeoutMs, () => new Error(t("database.query_timeout")));
      if (queryExecutionIdRef.current !== executionId) return;
      setResult(nextResult);
      setTableBrowserTarget(null);
      setQueryExecutionState({ status: "idle", message: "" });
    } catch (caught) {
      if (queryExecutionIdRef.current !== executionId) return;
      setResult(null);
      const message = caught instanceof Error ? caught.message : String(caught);
      setError(message);
      if (message === t("database.query_timeout")) {
        setQueryExecutionState({ status: "timeout", message });
        queryExecutionIdRef.current += 1;
        setIsExecuting(false);
      } else {
        setQueryExecutionState({ status: "idle", message: "" });
      }
      void logFrontendError("frontend.database", "execute_database_query", caught, `${connectionId}:${currentDatabase || ""}`, {
        sql_kind: sqlKind(sqlToExecute),
      });
    } finally {
      if (queryExecutionIdRef.current === executionId) {
        setIsExecuting(false);
      }
    }
  }

  function cancelQueryExecution() {
    if (!isExecuting) return;
    queryExecutionIdRef.current += 1;
    setIsExecuting(false);
    setResult(null);
    setError(t("database.query_canceled"));
    setQueryExecutionState({ status: "canceled", message: t("database.query_canceled") });
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
          onSelect: () => void openTableDdlDialog(node),
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
      void logFrontendError("frontend.database", "list_database_objects", caught, `${connectionId}:${currentDatabase}:${node.name}`, {
        database: currentDatabase,
        table: node.name,
      });
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

  async function openTableDdlDialog(node: DatabaseTreeNode) {
    if (!currentDatabase) return;
    setTableDdlDialog({ table: node, ddl: "", durationMs: null, error: null });
    try {
      const result = await callBackend<DatabaseTableDdlResult>("get_database_table_ddl", {
        request: {
          connection_id: connectionId,
          database: currentDatabase,
          table: node.name,
        },
      });
      setTableDdlDialog({
        table: node,
        ddl: result.ddl,
        durationMs: result.duration_ms,
        error: null,
      });
    } catch (caught) {
      void logFrontendError("frontend.database", "get_database_table_ddl", caught, `${connectionId}:${currentDatabase}:${node.name}`, {
        database: currentDatabase,
        table: node.name,
      });
      setTableDdlDialog({
        table: node,
        ddl: "",
        durationMs: null,
        error: caught instanceof Error ? caught.message : String(caught),
      });
    }
  }

  function switchSqlFile(nextName: string) {
    if (nextName === CREATE_SQL_FILE_VALUE) {
      setNewSqlFileName("");
      setIsCreateSqlFileDialogOpen(true);
      return;
    }
    const nextFile = sqlFiles.find((file) => file.name === nextName);
    if (!nextFile) return;
    const currentKey = sqlFileKey(connectionId, currentDatabase, selectedSqlFileName);
    if (isSqlFileLoaded && currentDatabase && selectedSqlFileName && dirtySqlFileKeysRef.current.has(currentKey)) {
      void saveSqlFileContent(currentDatabase, selectedSqlFileName, sql).then(() => {
        dirtySqlFileKeysRef.current.delete(currentKey);
      });
    }
    setSelectedSqlFileName(nextFile.name);
    setSql(nextFile.content);
  }

  function updateSql(nextSql: string) {
    setSql(nextSql);
    if (!isSqlFileLoaded || !selectedSqlFileName) return;
    if (currentDatabase) {
      dirtySqlFileKeysRef.current.add(sqlFileKey(connectionId, currentDatabase, selectedSqlFileName));
    }
    setSqlFiles((files) => files.map((file) => (
      file.name === selectedSqlFileName ? { ...file, content: nextSql } : file
    )));
  }

  function saveSqlFileContent(database: string, name: string, content: string) {
    return callBackend("save_database_sql_file", {
      request: {
        connection_id: connectionId,
        database,
        name,
        content,
      },
    }).catch((caught) => {
      void logFrontendError("frontend.database", "save_database_sql_file", caught, `${connectionId}:${database}:${name}`, {
        database,
        name,
      });
    });
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
          disabled: !selectedSql.trim() || isExecuting,
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

  async function openSqlFilePreview() {
    if (!currentDatabase) {
      setError(t("database.database_required"));
      return;
    }
    const path = await pickSqlFile();
    if (!path) return;
    setError(null);
    try {
      const preview = await callBackend<DatabaseSqlFilePreview>("preview_database_sql_file", {
        request: {
          connection_id: connectionId,
          database: currentDatabase,
          path,
        },
      });
      setSqlFilePreview(preview);
      setSqlFileExecutionState({ status: "idle", message: "" });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
      void logFrontendError("frontend.database", "preview_database_sql_file", caught, `${connectionId}:${currentDatabase}:${path}`, {
        database: currentDatabase,
      });
    }
  }

  async function executeSqlFile() {
    if (!sqlFilePreview || !currentDatabase) return;
    setIsSqlFileExecuting(true);
    setSqlFileExecutionState({ status: "running", message: "" });
    setError(null);
    try {
      const execution = await callBackend<DatabaseSqlFileExecutionResult>("execute_database_sql_file", {
        request: {
          connection_id: connectionId,
          database: currentDatabase,
          path: sqlFilePreview.path,
        },
      });
      const message = t("database.sql_file_execute_summary", {
        statements: execution.executed_statements,
        affected: execution.affected_rows,
        duration: execution.duration_ms,
      });
      setSqlFileExecutionState({ status: "success", message });
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      setSqlFileExecutionState({ status: "error", message });
      void logFrontendError("frontend.database", "execute_database_sql_file", caught, `${connectionId}:${currentDatabase}:${sqlFilePreview.path}`, {
        database: currentDatabase,
      });
    } finally {
      setIsSqlFileExecuting(false);
    }
  }

  function openExportMenu(event: ReactMouseEvent, columns: DatabaseResultColumn[], rows: DatabaseCellValue[][], table: string | null) {
    event.preventDefault();
    setPendingExport({
      columns,
      rows,
      table,
      format: "csv",
      includeHeader: true,
      selectedColumns: columns.map((column) => column.name),
    });
  }

  function updatePendingExportFormat(format: DatabaseResultExportFormat) {
    setPendingExport((current) => current ? { ...current, format } : current);
  }

  function updatePendingExportIncludeHeader(includeHeader: boolean) {
    setPendingExport((current) => current ? { ...current, includeHeader } : current);
  }

  function togglePendingExportColumn(columnName: string) {
    setPendingExport((current) => {
      if (!current) return current;
      const selected = new Set(current.selectedColumns);
      if (selected.has(columnName)) {
        selected.delete(columnName);
      } else {
        selected.add(columnName);
      }
      return { ...current, selectedColumns: current.columns.map((column) => column.name).filter((name) => selected.has(name)) };
    });
  }

  function selectedExportPayload(exportState: PendingExport) {
    const selectedIndexes = exportState.columns
      .map((column, index) => ({ column, index }))
      .filter(({ column }) => exportState.selectedColumns.includes(column.name));
    return {
      columns: selectedIndexes.map(({ column }) => column),
      rows: exportState.rows.map((row) => selectedIndexes.map(({ index }) => row[index] ?? { kind: "null" as const })),
    };
  }

  function confirmPendingExport() {
    if (!pendingExport) return;
    const payload = selectedExportPayload(pendingExport);
    if (payload.columns.length === 0) return;
    setPendingExport(null);
    void exportResult(
      pendingExport.format,
      payload.columns,
      payload.rows,
      pendingExport.table,
      pendingExport.includeHeader,
    );
  }

  async function exportResult(
    format: DatabaseResultExportFormat,
    columns: DatabaseResultColumn[],
    rows: DatabaseCellValue[][],
    table: string | null,
    includeHeader: boolean,
  ) {
    if (format === "insert_sql" && !table) {
      setPendingInsertExport({ columns, rows, includeHeader });
      setInsertExportTableName("");
      return;
    }
    if (!currentDatabase) {
      setError(t("database.database_required"));
      return;
    }
    const extension = format === "csv" ? "csv" : "sql";
    const path = await pickDatabaseExportPath(defaultExportName(currentDatabase, table, extension), extension);
    if (!path) return;
    setError(null);
    try {
      const exported = await callBackend<DatabaseResultExportResult>("export_database_result", {
        request: {
          connection_id: connectionId,
          database: currentDatabase,
          table,
          path,
          format,
          include_header: includeHeader,
          columns,
          rows,
        },
      });
      setExportMessage(t("database.export_complete", { rows: exported.exported_rows, duration: exported.duration_ms }));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
      void logFrontendError("frontend.database", "export_database_result", caught, `${connectionId}:${currentDatabase}:${path}`, {
        database: currentDatabase,
        table: table ?? "",
      });
    }
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
              <AppIcon icon={isEditorOpen ? CollapseEditorIcon : ExpandEditorIcon} decorative />
            </button>
            <label>
              <span className="database-query-panel__icon-label" title={t("database.sql_file")}>
                <AppIcon icon={SqlFileIcon} decorative />
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
            <button
              type="button"
              className="database-icon-button"
              aria-label={t("database.execute_sql_file")}
              title={t("database.execute_sql_file")}
              onClick={() => void openSqlFilePreview()}
            >
              <AppIcon icon={ExecuteSqlFileIcon} decorative />
            </button>
            {queryExecutionState.status === "running" ? (
              <span className="database-query-panel__status" role="status">{queryExecutionState.message}</span>
            ) : null}
            {isExecuting ? (
              <button type="button" onClick={cancelQueryExecution}>
                {t("database.cancel_query")}
              </button>
            ) : null}
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
                onChange={(value) => updateSql(value ?? "")}
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
            <DatabaseTableBrowser
              connectionId={connectionId}
              target={tableBrowserTarget}
              exportMessage={exportMessage}
              onExport={(event, columns, rows, table) => openExportMenu(event, columns, rows, table)}
            />
          ) : result ? (
            <DatabaseResultView
              result={result}
              exportMessage={exportMessage}
              onExport={(event, columns, rows) => openExportMenu(event, columns, rows, null)}
            />
          ) : (
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
      {sqlFilePreview ? (
        <div className="connection-dialog__backdrop">
          <div
            className="connection-dialog database-dialog database-sql-file-execute-dialog"
            role="dialog"
            aria-modal="true"
            aria-label={t("database.execute_sql_file")}
          >
            <header className="database-dialog__header">
              <h2>{t("database.execute_sql_file")}</h2>
            </header>
            <div className="database-sql-file-execute-dialog__body">
              <div className="database-sql-file-execute-dialog__meta">
                <strong>{sqlFilePreview.file_name}</strong>
                <span>{t("database.sql_file_preview_size", { size: sqlFilePreview.size_bytes })}</span>
                <span>{t("database.sql_file_preview_statements", { count: sqlFilePreview.estimated_statement_count })}</span>
              </div>
              <p>{t("database.sql_file_execute_hint")}</p>
              {sqlFilePreview.dangerous ? (
                <p className="database-sql-file-execute-dialog__danger" role="alert">
                  {t("database.sql_file_dangerous", { keywords: dangerousSqlKeywordsText() })}
                </p>
              ) : null}
              <pre>{sqlFilePreview.preview}</pre>
              {sqlFileExecutionState.status === "success" ? (
                <p className="database-sql-file-execute-dialog__result" role="status">
                  {sqlFileExecutionState.message}
                </p>
              ) : null}
              {sqlFileExecutionState.status === "error" ? (
                <p className="database-sql-file-execute-dialog__error" role="alert">
                  {sqlFileExecutionState.message}
                </p>
              ) : null}
            </div>
            <div className="database-dialog__actions">
              <button type="button" onClick={closeSqlFilePreview}>
                {t("database.cancel")}
              </button>
              <button
                type="button"
                disabled={isSqlFileExecuting || sqlFileExecutionState.status === "success"}
                onClick={() => void executeSqlFile()}
              >
                {sqlFileExecutionButtonLabel(sqlFileExecutionState.status, t)}
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {pendingExport ? (
        <div className="connection-dialog__backdrop">
          <div
            className="connection-dialog database-dialog database-export-dialog"
            role="dialog"
            aria-modal="true"
            aria-label={t("database.export_result_title")}
          >
            <header className="database-dialog__header">
              <h2>{t("database.export_result_title")}</h2>
            </header>
            <div className="database-export-dialog__body">
              <label className="database-export-dialog__row">
                <span>{t("database.export_format")}</span>
                <select
                  aria-label={t("database.export_format")}
                  value={pendingExport.format}
                  onChange={(event) => updatePendingExportFormat(event.target.value as DatabaseResultExportFormat)}
                >
                  <option value="csv">{t("database.export_format_csv")}</option>
                  <option value="insert_sql">{t("database.export_format_insert_sql")}</option>
                </select>
              </label>
              {pendingExport.format === "csv" ? (
                <label className="database-export-dialog__checkbox">
                  <input
                    type="checkbox"
                    checked={pendingExport.includeHeader}
                    onChange={(event) => updatePendingExportIncludeHeader(event.target.checked)}
                  />
                  <span>{t("database.export_include_header")}</span>
                </label>
              ) : null}
              <fieldset className="database-export-dialog__columns">
                <legend>{t("database.export_columns")}</legend>
                <div>
                  {pendingExport.columns.map((column) => (
                    <label key={column.name}>
                      <input
                        type="checkbox"
                        checked={pendingExport.selectedColumns.includes(column.name)}
                        onChange={() => togglePendingExportColumn(column.name)}
                      />
                      <span>{column.name}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
            </div>
            <div className="database-dialog__actions">
              <button type="button" onClick={() => setPendingExport(null)}>
                {t("database.cancel")}
              </button>
              <button type="button" disabled={pendingExport.selectedColumns.length === 0} onClick={confirmPendingExport}>
                {t("database.export")}
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {pendingInsertExport ? (
        <div className="connection-dialog__backdrop">
          <div
            className="connection-dialog database-dialog database-export-dialog"
            role="dialog"
            aria-modal="true"
            aria-label={t("database.export_insert_sql_title")}
          >
            <header className="database-dialog__header">
              <h2>{t("database.export_insert_sql_title")}</h2>
            </header>
            <label className="database-export-dialog__field">
              <span>{t("database.export_target_table")}</span>
              <input
                aria-label={t("database.export_target_table")}
                autoFocus
                value={insertExportTableName}
                onChange={(event) => setInsertExportTableName(event.target.value)}
              />
            </label>
            <div className="database-dialog__actions">
              <button type="button" onClick={() => setPendingInsertExport(null)}>
                {t("database.cancel")}
              </button>
              <button
                type="button"
                disabled={!insertExportTableName.trim()}
                onClick={() => {
                  const pending = pendingInsertExport;
                  const table = insertExportTableName.trim();
                  setPendingInsertExport(null);
                  void exportResult("insert_sql", pending.columns, pending.rows, table, pending.includeHeader);
                }}
              >
                {t("database.export")}
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
      {tableDdlDialog ? (
        <div className="connection-dialog__backdrop">
          <div
            className="connection-dialog database-dialog database-table-ddl-dialog"
            role="dialog"
            aria-modal="true"
            aria-label={t("database.table_ddl_title", { table: tableDdlDialog.table.name })}
          >
            <header className="database-dialog__header">
              <h2>{t("database.table_ddl_title", { table: tableDdlDialog.table.name })}</h2>
            </header>
            <div className="database-table-ddl-dialog__body">
              {tableDdlDialog.error ? <p role="alert">{tableDdlDialog.error}</p> : null}
              {!tableDdlDialog.error && !tableDdlDialog.ddl ? <p>{t("database.ddl_loading")}</p> : null}
              {tableDdlDialog.ddl ? <pre>{tableDdlDialog.ddl}</pre> : null}
            </div>
            <div className="database-dialog__actions">
              {tableDdlDialog.durationMs !== null ? (
                <span className="database-dialog__meta">
                  {t("database.ddl_duration", { duration: tableDdlDialog.durationMs })}
                </span>
              ) : null}
              <button
                type="button"
                disabled={!tableDdlDialog.ddl}
                onClick={() => void writeClipboardText(tableDdlDialog.ddl)}
              >
                {t("database.copy_ddl")}
              </button>
              <button type="button" onClick={() => setTableDdlDialog(null)}>
                {t("database.close")}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function DatabaseResultView({
  result,
  exportMessage,
  onExport,
}: {
  result: DatabaseQueryResult;
  exportMessage: string;
  onExport: (event: ReactMouseEvent, columns: DatabaseResultColumn[], rows: DatabaseCellValue[][]) => void;
}) {
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
      <header className="database-table-browser__toolbar database-result__toolbar">
        <span>{summary}</span>
        {result.columns.length > 0 ? (
          <button
            type="button"
            className="database-icon-button database-icon-button--ghost"
            aria-label={t("database.export")}
            title={t("database.export")}
            onClick={(event) => onExport(event, result.columns, result.rows)}
          >
            <AppIcon icon={ExportIcon} decorative />
          </button>
        ) : null}
        {exportMessage ? <span role="status">{exportMessage}</span> : null}
      </header>
      {result.columns.length > 0 ? (
        <DatabaseDataGrid
          columns={result.columns}
          rows={result.rows}
        />
      ) : null}
    </section>
  );
}

function defaultExportName(database: string, table: string | null, extension: "csv" | "sql") {
  const timestamp = new Date().toISOString().replace(/\D/g, "").slice(0, 14);
  return `${database || "database"}.${table?.trim() || "result"}.${timestamp}.${extension}`;
}

function dangerousSqlKeywordsText() {
  return Array.from(DANGEROUS_SQL_KEYWORDS).join("、");
}

function sqlFileExecutionButtonLabel(status: SqlFileExecutionState["status"], t: ReturnType<typeof useI18n>["t"]) {
  if (status === "running") return t("database.executing");
  if (status === "success") return t("database.sql_file_executed");
  return t("database.sql_file_execute");
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, createError: () => Error) {
  return new Promise<T>((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      reject(createError());
    }, timeoutMs);
    promise.then(
      (value) => {
        window.clearTimeout(timeout);
        resolve(value);
      },
      (error) => {
        window.clearTimeout(timeout);
        reject(error);
      },
    );
  });
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

function sqlKind(sql: string) {
  const keyword = firstSqlKeyword(sql)?.toLowerCase();
  if (keyword === "select" || keyword === "with") return "select";
  if (keyword === "insert") return "insert";
  if (keyword === "update") return "update";
  if (keyword === "delete") return "delete";
  if (keyword === "create" || keyword === "alter" || keyword === "drop" || keyword === "truncate") return "ddl";
  return "other";
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
