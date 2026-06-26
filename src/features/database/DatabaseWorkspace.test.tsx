import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode, type ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n/I18nProvider";
import { readClipboardText, writeClipboardText } from "../../lib/clipboard";
import { pickDatabaseExportPath, pickSqlFile } from "../../lib/fileDialog";
import { callBackend } from "../../lib/tauri";
import { DatabaseWorkspace } from "./DatabaseWorkspace";

const { executeEditsMock, focusMock, monacoEditorMock, pushUndoStopMock, triggerMock, setSelectedSqlText } = vi.hoisted(() => {
  let selectedSqlText = "";
  return {
    executeEditsMock: vi.fn(),
    focusMock: vi.fn(),
    pushUndoStopMock: vi.fn(),
    triggerMock: vi.fn(),
    setSelectedSqlText: (value: string) => {
      selectedSqlText = value;
    },
    monacoEditorMock: vi.fn((props: {
      value?: string;
      defaultLanguage?: string;
      theme?: string;
      language?: string;
      options?: {
        automaticLayout?: boolean;
        contextmenu?: boolean;
        fontFamily?: string;
        fontSize?: number;
        minimap?: { enabled?: boolean };
      };
      wrapperProps?: { "aria-label"?: string };
      onChange?: (value?: string) => void;
      onMount?: (editor: {
        executeEdits: (source: string, edits: Array<{ range: unknown; text: string; forceMoveMarkers?: boolean }>) => void;
        focus: () => void;
        getSelection: () => { startLineNumber: number; startColumn: number; endLineNumber: number; endColumn: number; isEmpty: () => boolean } | null;
        getModel: () => { getValueInRange: () => string };
        pushUndoStop: () => void;
        trigger: (source: string, handlerId: string, payload: unknown) => void;
      }) => void;
    }) => (
      <textarea
        aria-label={props.wrapperProps?.["aria-label"]}
        data-testid="database-monaco-editor"
        data-default-language={props.defaultLanguage}
        data-language={props.language}
        data-theme={props.theme}
        data-automatic-layout={String(props.options?.automaticLayout)}
        data-contextmenu={String(props.options?.contextmenu)}
        data-font-family={props.options?.fontFamily}
        data-font-size={props.options?.fontSize}
        data-minimap={String(props.options?.minimap?.enabled)}
        value={props.value ?? ""}
        onChange={(event) => props.onChange?.(event.target.value)}
        ref={(element) => {
          if (!element) return;
          props.onMount?.({
            executeEdits: executeEditsMock,
            focus: focusMock,
            getSelection: () => {
              if (!selectedSqlText) return null;
              return {
                startLineNumber: 1,
                startColumn: 1,
                endLineNumber: 1,
                endColumn: selectedSqlText.length + 1,
                isEmpty: () => selectedSqlText.length === 0,
              };
            },
            getModel: () => ({
              getValueInRange: () => selectedSqlText,
            }),
            pushUndoStop: pushUndoStopMock,
            trigger: triggerMock,
          });
        }}
      />
    )),
  };
});

vi.mock("../../lib/tauri", () => ({
  callBackend: vi.fn(),
}));

vi.mock("../../lib/clipboard", () => ({
  readClipboardText: vi.fn(),
  writeClipboardText: vi.fn(),
}));

vi.mock("../../lib/fileDialog", () => ({
  pickSqlFile: vi.fn(),
  pickDatabaseExportPath: vi.fn(),
}));

vi.mock("@monaco-editor/react", () => ({
  default: monacoEditorMock,
}));

const callBackendMock = vi.mocked(callBackend);
const readClipboardTextMock = vi.mocked(readClipboardText);
const writeClipboardTextMock = vi.mocked(writeClipboardText);
const pickSqlFileMock = vi.mocked(pickSqlFile);
const pickDatabaseExportPathMock = vi.mocked(pickDatabaseExportPath);

describe("DatabaseWorkspace", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.useRealTimers();
    setSelectedSqlText("");
  });

  function renderDatabaseWorkspace(initialDatabase?: string, props?: Partial<ComponentProps<typeof DatabaseWorkspace>>) {
    return render(
      <I18nProvider language="zh-CN">
        <DatabaseWorkspace
          connectionId="mysql-dev"
          initialDatabase={initialDatabase}
          theme="light"
          fontFamily="Consolas"
          fontSize={14}
          {...props}
        />
      </I18nProvider>,
    );
  }

  function renderDatabaseWorkspaceInStrictMode(initialDatabase?: string) {
    return render(
      <StrictMode>
        <I18nProvider language="zh-CN">
          <DatabaseWorkspace
            connectionId="mysql-dev"
            initialDatabase={initialDatabase}
            theme="light"
            fontFamily="Consolas"
            fontSize={14}
          />
        </I18nProvider>
      </StrictMode>,
    );
  }

  it("loads the default database tables directly and switches databases from the selector", async () => {
    callBackendMock.mockImplementation((command, payload) => {
      if (command !== "list_database_objects") return Promise.resolve([]);
      const request = (payload as { request: { parent_kind?: string; database?: string } }).request;
      if (!request.parent_kind) {
        return Promise.resolve([
          { id: "database:app", name: "app", kind: "database", has_children: true },
          { id: "database:audit", name: "audit", kind: "database", has_children: true },
        ]);
      }
      if (request.database === "audit") {
        return Promise.resolve([
          { id: "table:audit.events", name: "events", kind: "table", has_children: true, detail: "BASE TABLE" },
        ]);
      }
      return Promise.resolve([
        { id: "table:app.users", name: "users", kind: "table", has_children: true, detail: "BASE TABLE" },
        { id: "table:app.orders", name: "orders", kind: "table", has_children: true, detail: "BASE TABLE" },
      ]);
    });

    renderDatabaseWorkspace("app");

    expect(await screen.findByText("users")).toBeInTheDocument();
    expect(screen.getByText("orders")).toBeInTheDocument();
    expect(screen.queryByText("BASE TABLE")).not.toBeInTheDocument();
    expect(screen.getByLabelText("数据库")).toHaveValue("app");
    expect(callBackendMock).toHaveBeenCalledWith("list_database_objects", {
      request: {
        connection_id: "mysql-dev",
      },
    });
    expect(callBackendMock).toHaveBeenCalledWith("list_database_objects", {
      request: {
        connection_id: "mysql-dev",
        parent_kind: "database",
        database: "app",
      },
    });

    await userEvent.selectOptions(screen.getByLabelText("数据库"), "audit");

    expect(await screen.findByText("events")).toBeInTheDocument();
    expect(screen.queryByText("users")).not.toBeInTheDocument();
    expect(callBackendMock).toHaveBeenCalledWith("list_database_objects", {
      request: {
        connection_id: "mysql-dev",
        parent_kind: "database",
        database: "audit",
      },
    });
    expect(screen.getByLabelText("数据库对象树")).toBeInTheDocument();
  });

  it("deduplicates initial object tree loads in strict mode", async () => {
    callBackendMock.mockImplementation((command, payload) => {
      if (command !== "list_database_objects") return Promise.resolve([]);
      const request = (payload as { request: { parent_kind?: string; database?: string } }).request;
      if (!request.parent_kind) {
        return Promise.resolve([
          { id: "database:app", name: "app", kind: "database", has_children: true },
        ]);
      }
      return Promise.resolve([
        { id: "table:app.users", name: "users", kind: "table", has_children: true, detail: "BASE TABLE" },
      ]);
    });

    renderDatabaseWorkspaceInStrictMode("app");

    expect(await screen.findByText("users")).toBeInTheDocument();
    await waitFor(() => {
      const objectCalls = callBackendMock.mock.calls.filter(([command]) => command === "list_database_objects");
      expect(objectCalls).toHaveLength(2);
    });
    const tableObjectCalls = callBackendMock.mock.calls.filter(([command, payload]) => {
      if (command !== "list_database_objects") return false;
      const request = (payload as { request?: { parent_kind?: string; database?: string } }).request;
      return request?.parent_kind === "database" && request.database === "app";
    });
    expect(tableObjectCalls).toHaveLength(1);
  });

  it("filters table names on the client", async () => {
    callBackendMock.mockImplementation((command, payload) => {
      if (command !== "list_database_objects") return Promise.resolve([]);
      const request = (payload as { request: { parent_kind?: string } }).request;
      if (!request.parent_kind) {
        return Promise.resolve([{ id: "database:app", name: "app", kind: "database", has_children: true }]);
      }
      return Promise.resolve([
        { id: "table:app.users", name: "users", kind: "table", has_children: true, detail: "BASE TABLE" },
        { id: "table:app.orders", name: "orders", kind: "table", has_children: true, detail: "BASE TABLE" },
        { id: "table:app.t_bh_template", name: "t_bh_template", kind: "table", has_children: true, detail: "BASE TABLE" },
        { id: "table:app.t_bh$template", name: "t_bh$template", kind: "table", has_children: true, detail: "BASE TABLE" },
        { id: "table:app.t_bh-template", name: "t_bh-template", kind: "table", has_children: true, detail: "BASE TABLE" },
      ]);
    });

    renderDatabaseWorkspace("app");

    expect(await screen.findByText("users")).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("筛选表"), "ord");

    expect(screen.queryByText("users")).not.toBeInTheDocument();
    expect(screen.getByText("orders")).toBeInTheDocument();

    await userEvent.clear(screen.getByLabelText("筛选表"));
    await userEvent.type(screen.getByLabelText("筛选表"), "bht");

    expect(screen.getByText("t_bh_template")).toBeInTheDocument();
    expect(screen.getByText("t_bh$template")).toBeInTheDocument();
    expect(screen.getByText("t_bh-template")).toBeInTheDocument();
  });

  it("uses Monaco as the SQL editor", () => {
    renderDatabaseWorkspace("app");

    const editor = screen.getByTestId("database-monaco-editor");
    expect(editor).toHaveAttribute("data-default-language", "sql");
    expect(editor).toHaveAttribute("data-theme", "light");
    expect(editor).toHaveAttribute("data-font-family", "Consolas");
    expect(editor).toHaveAttribute("data-font-size", "14");
    expect(editor).toHaveAttribute("data-automatic-layout", "true");
    expect(editor).toHaveAttribute("data-contextmenu", "false");
    expect(editor).toHaveAttribute("data-minimap", "false");
  });

  it("shows node loading errors below the database object tree", async () => {
    callBackendMock.mockRejectedValue(new Error("metadata failed"));

    renderDatabaseWorkspace("app");

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("metadata failed");
    });
  });

  it("executes selected SQL from the editor context menu and renders query result rows", async () => {
    callBackendMock.mockImplementation((command) => {
      if (command === "execute_database_query") {
        return Promise.resolve({
          columns: [
            { name: "id", data_type: "INT" },
            { name: "name", data_type: "VARCHAR" },
            { name: "active", data_type: "BOOL" },
          ],
          rows: [
            [
              { kind: "number", value: "1" },
              { kind: "text", value: "Alice" },
              { kind: "bool", value: true },
            ],
            [
              { kind: "number", value: "2" },
              { kind: "null" },
              { kind: "bool", value: false },
            ],
          ],
          affected_rows: 0,
          duration_ms: 12,
          limited: true,
        });
      }
      return Promise.resolve([]);
    });

    renderDatabaseWorkspace("app");

    const editor = screen.getByLabelText("SQL 编辑器") as HTMLTextAreaElement;
    await userEvent.type(editor, "select * from users; select * from orders");
    setSelectedSqlText("select * from users");
    await executeSelectedSqlFromContextMenu(editor);

    await waitFor(() => {
      expect(callBackendMock).toHaveBeenCalledWith("execute_database_query", {
        request: {
          connection_id: "mysql-dev",
          database: "app",
          sql: "select * from users",
          limit: 200,
        },
      });
    });
    expect(screen.getByText("2 行，耗时 12 ms，已自动追加 LIMIT")).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "id INT" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "name VARCHAR" })).toBeInTheDocument();
    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.getByText("null")).toHaveClass("database-table-browser__cell-placeholder");
    expect(screen.getByLabelText("第 1 行 id")).toHaveClass("database-table-browser__cell--number");
    await userEvent.click(screen.getByLabelText("第 1 行 name"));
    expect(screen.getByLabelText("第 1 行 name")).toHaveClass("database-table-browser__cell--selected");
    fireEvent.contextMenu(screen.getByLabelText("第 1 行 name"), { clientX: 10, clientY: 20 });
    expect(within(screen.getByRole("menu")).getAllByRole("menuitem").map((item) => item.textContent)).toEqual([
      "复制单元格",
      "复制选中",
      "复制列名",
    ]);
    expect(screen.getByText("true")).toBeInTheDocument();
  });

  it("shows running state, disables duplicate execution and ignores canceled SQL results", async () => {
    let resolveQuery: (value: {
      columns: Array<{ name: string; data_type: string }>;
      rows: Array<Array<{ kind: "number"; value: string }>>;
      affected_rows: number;
      duration_ms: number;
      limited: boolean;
    }) => void = () => {};
    callBackendMock.mockImplementation((command) => {
      if (command === "execute_database_query") {
        return new Promise((resolve) => {
          resolveQuery = resolve;
        });
      }
      return Promise.resolve([]);
    });

    renderDatabaseWorkspace("app");

    const editor = screen.getByLabelText("SQL 编辑器");
    setSelectedSqlText("select * from users");
    await executeSelectedSqlFromContextMenu(editor);

    expect(screen.getByText("SQL 执行中...")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "取消执行" })).toBeInTheDocument();
    fireEvent.contextMenu(editor, { clientX: 10, clientY: 20 });
    expect(screen.getByRole("menuitem", { name: "执行选择 SQL" })).toBeDisabled();
    expect(callBackendMock.mock.calls.filter(([command]) => command === "execute_database_query")).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: "取消执行" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("SQL 执行已取消");

    resolveQuery({
      columns: [{ name: "id", data_type: "INT" }],
      rows: [[{ kind: "number", value: "1" }]],
      affected_rows: 0,
      duration_ms: 99,
      limited: false,
    });

    await waitFor(() => {
      expect(screen.queryByText("1 行，耗时 99 ms")).not.toBeInTheDocument();
    });
  });

  it("times out long SQL execution and ignores late results", async () => {
    let resolveQuery: (value: {
      columns: Array<{ name: string; data_type: string }>;
      rows: Array<Array<{ kind: "number"; value: string }>>;
      affected_rows: number;
      duration_ms: number;
      limited: boolean;
    }) => void = () => {};
    callBackendMock.mockImplementation((command) => {
      if (command === "execute_database_query") {
        return new Promise((resolve) => {
          resolveQuery = resolve;
        });
      }
      return Promise.resolve([]);
    });

    renderDatabaseWorkspace("app", { queryTimeoutMs: 10 });

    const editor = screen.getByLabelText("SQL 编辑器");
    setSelectedSqlText("select sleep(60)");
    await executeSelectedSqlFromContextMenu(editor);

    expect(await screen.findByRole("alert")).toHaveTextContent("SQL 执行超时，已忽略后续返回结果");
    expect(screen.queryByText("SQL 执行中...")).not.toBeInTheDocument();

    resolveQuery({
      columns: [{ name: "id", data_type: "INT" }],
      rows: [[{ kind: "number", value: "1" }]],
      affected_rows: 0,
      duration_ms: 60_000,
      limited: false,
    });

    await waitFor(() => {
      expect(screen.queryByText("1 行，耗时 60000 ms")).not.toBeInTheDocument();
    });
  });

  it("shows affected rows and query errors", async () => {
    callBackendMock.mockImplementation((command, payload) => {
      if (command !== "execute_database_query") return Promise.resolve([]);
      const request = (payload as { request: { sql: string } }).request;
      if (request.sql === "update users set active = 1") {
        return Promise.resolve({
          columns: [],
          rows: [],
          affected_rows: 3,
          duration_ms: 8,
          limited: false,
        });
      }
      return Promise.reject(new Error("syntax error near from"));
    });

    renderDatabaseWorkspace("app");

    await waitFor(() => expect(callBackendMock).toHaveBeenCalledWith("list_database_objects", {
      request: {
        connection_id: "mysql-dev",
      },
    }));
    await userEvent.clear(screen.getByLabelText("SQL 编辑器"));
    await userEvent.type(screen.getByLabelText("SQL 编辑器"), "update users set active = 1");
    setSelectedSqlText("update users set active = 1");
    await executeSelectedSqlFromContextMenu(screen.getByLabelText("SQL 编辑器"));
    await userEvent.click(await screen.findByRole("button", { name: "确认执行" }));

    expect(await screen.findByText("影响 3 行，耗时 8 ms")).toBeInTheDocument();

    await userEvent.clear(screen.getByLabelText("SQL 编辑器"));
    await userEvent.type(screen.getByLabelText("SQL 编辑器"), "select from");
    setSelectedSqlText("select from");
    await executeSelectedSqlFromContextMenu(screen.getByLabelText("SQL 编辑器"));

    expect(await screen.findByRole("alert")).toHaveTextContent("syntax error near from");
  });

  it("asks for confirmation before running dangerous SQL", async () => {
    callBackendMock.mockImplementation((command) => {
      if (command === "execute_database_query") {
        return Promise.resolve({
          columns: [],
          rows: [],
          affected_rows: 1,
          duration_ms: 2,
          limited: false,
        });
      }
      return Promise.resolve([]);
    });

    renderDatabaseWorkspace("app");

    await userEvent.type(screen.getByLabelText("SQL 编辑器"), "delete from users");
    setSelectedSqlText("delete from users");
    await executeSelectedSqlFromContextMenu(screen.getByLabelText("SQL 编辑器"));

    expect(await screen.findByRole("dialog", { name: "确认执行危险 SQL" })).toBeInTheDocument();
    expect(callBackendMock).not.toHaveBeenCalledWith("execute_database_query", expect.anything());

    await userEvent.click(screen.getByRole("button", { name: "确认执行" }));

    await waitFor(() => {
      expect(callBackendMock).toHaveBeenCalledWith("execute_database_query", {
        request: {
          connection_id: "mysql-dev",
          database: "app",
          sql: "delete from users",
          limit: 200,
        },
      });
    });
    expect(await screen.findByText("影响 1 行，耗时 2 ms")).toBeInTheDocument();
  });

  it("opens a table browser when double clicking a table without replacing SQL content", async () => {
    callBackendMock.mockImplementation((command, payload) => {
      if (command === "list_database_objects") {
        const request = (payload as { request: { parent_kind?: string; database?: string } }).request;
        if (!request.parent_kind) {
          return Promise.resolve([{ id: "database:app", name: "app", kind: "database", has_children: true }]);
        }
        return Promise.resolve([
          { id: "table:app.users", name: "users", kind: "table", has_children: true, detail: "BASE TABLE" },
        ]);
      }
      if (command === "list_database_sql_files") {
        return Promise.resolve([{ name: "default", content: "select 1" }]);
      }
      if (command === "load_database_table_page") {
        return Promise.resolve({
          columns: [{ name: "id", data_type: "INT" }],
          rows: [[{ kind: "number", value: "1" }]],
          total_rows: 501,
          page: 1,
          page_size: 200,
          duration_ms: 9,
          primary_key_columns: ["id"],
          editable: true,
        });
      }
      return Promise.resolve([]);
    });

    renderDatabaseWorkspace("app");

    expect(await screen.findByLabelText("SQL 编辑器")).toHaveValue("select 1");
    await userEvent.dblClick(await screen.findByText("users"));

    expect(screen.getByLabelText("SQL 编辑器")).toHaveValue("select 1");
    expect(await screen.findByLabelText("表数据")).toBeInTheDocument();
    expect(screen.getByText("表 users")).toBeInTheDocument();
    expect(screen.getByText("1-200")).toBeInTheDocument();
    expect(screen.getByText("of 501")).toBeInTheDocument();
    await waitFor(() => {
      expect(callBackendMock).toHaveBeenCalledWith("load_database_table_page", {
        request: {
          connection_id: "mysql-dev",
          database: "app",
          table: "users",
          page: 1,
          page_size: 200,
          sort_column: null,
          sort_direction: null,
          order_by: null,
          filter: null,
        },
      });
    });
    expect(screen.getAllByText("1")).toHaveLength(2);
  });

  it("deduplicates initial table page loading in strict mode", async () => {
    callBackendMock.mockImplementation((command, payload) => {
      if (command === "list_database_objects") {
        const request = (payload as { request: { parent_kind?: string; database?: string } }).request;
        if (!request.parent_kind) {
          return Promise.resolve([{ id: "database:app", name: "app", kind: "database", has_children: true }]);
        }
        return Promise.resolve([
          { id: "table:app.users", name: "users", kind: "table", has_children: true, detail: "BASE TABLE" },
        ]);
      }
      if (command === "list_database_sql_files") {
        return Promise.resolve([{ name: "default", content: "select 1" }]);
      }
      if (command === "load_database_table_page") {
        return Promise.resolve({
          columns: [{ name: "id", data_type: "INT" }],
          rows: [[{ kind: "number", value: "1" }]],
          total_rows: 1,
          page: 1,
          page_size: 200,
          duration_ms: 9,
          primary_key_columns: ["id"],
          editable: true,
        });
      }
      return Promise.resolve([]);
    });

    renderDatabaseWorkspaceInStrictMode("app");

    await userEvent.dblClick(await screen.findByText("users"));
    expect(await screen.findByLabelText("表数据")).toBeInTheDocument();
    await waitFor(() => {
      expect(callBackendMock.mock.calls.filter(([command]) => command === "load_database_table_page")).toHaveLength(1);
    });
  });

  it("opens tables from the whole table row and shows table actions from the row context menu", async () => {
    callBackendMock.mockImplementation((command, payload) => {
      if (command === "list_database_objects") {
        const request = (payload as { request: { parent_kind?: string; database?: string; table?: string } }).request;
        if (!request.parent_kind) {
          return Promise.resolve([{ id: "database:app", name: "app", kind: "database", has_children: true }]);
        }
        if (request.parent_kind === "table" && request.table === "users") {
          return Promise.resolve([
            { id: "column:app.users.id", name: "id", kind: "column", has_children: false, detail: "int(11) NO" },
            { id: "column:app.users.name", name: "name", kind: "column", has_children: false, detail: "varchar(255) YES" },
          ]);
        }
        return Promise.resolve([{ id: "table:app.users", name: "users", kind: "table", has_children: true }]);
      }
      if (command === "get_database_table_ddl") {
        return Promise.resolve({
          ddl: "CREATE TABLE `users` (\n  `id` int NOT NULL\n)",
          duration_ms: 6,
        });
      }
      if (command === "load_database_table_page") {
        return Promise.resolve({
          columns: [{ name: "id", data_type: "INT" }],
          rows: [[{ kind: "number", value: "1" }]],
          total_rows: 1,
          page: 1,
          page_size: 200,
          duration_ms: 9,
          primary_key_columns: ["id"],
          editable: true,
        });
      }
      return Promise.resolve([]);
    });

    renderDatabaseWorkspace("app");

    const tableRow = (await screen.findByRole("button", { name: "users" })).closest("li");
    expect(tableRow).not.toBeNull();
    expect(tableRow).toHaveClass("database-object-tree__item");
    await userEvent.dblClick(tableRow!);
    expect(await screen.findByLabelText("表数据")).toBeInTheDocument();

    fireEvent.contextMenu(tableRow!, { clientX: 10, clientY: 20 });
    expect(within(screen.getByRole("menu")).getAllByRole("menuitem").map((item) => item.textContent)).toEqual([
      "复制表名",
      "编辑",
      "DDL",
    ]);

    await userEvent.click(screen.getByRole("menuitem", { name: "复制表名" }));
    expect(writeClipboardTextMock).toHaveBeenCalledWith("users");

    fireEvent.contextMenu(tableRow!, { clientX: 10, clientY: 20 });
    await userEvent.click(screen.getByRole("menuitem", { name: "编辑" }));

    const structureDialog = await screen.findByRole("dialog", { name: "编辑表 users" });
    expect(structureDialog).toBeInTheDocument();
    expect(within(structureDialog).getByLabelText("表结构对象")).toBeInTheDocument();
    expect(within(structureDialog).getByRole("button", { name: "表 users" })).toHaveClass("database-table-structure-dialog__node--active");
    expect(within(structureDialog).getByLabelText("表名")).toHaveValue("users");
    expect(within(structureDialog).getByLabelText("字段数")).toHaveValue("2");
    expect(within(structureDialog).getByRole("button", { name: "id int(11)" })).toBeInTheDocument();
    expect(within(structureDialog).getByRole("button", { name: "name varchar(255)" })).toBeInTheDocument();
    await userEvent.click(within(structureDialog).getByRole("button", { name: "id int(11)" }));
    expect(within(structureDialog).getByLabelText("字段名")).toHaveValue("id");
    expect(within(structureDialog).getByLabelText("字段类型")).toHaveValue("int(11)");
    expect(within(structureDialog).getByLabelText("可空")).not.toBeChecked();
    await userEvent.click(within(structureDialog).getByRole("button", { name: "name varchar(255)" }));
    expect(within(structureDialog).getByLabelText("字段名")).toHaveValue("name");
    expect(within(structureDialog).getByLabelText("字段类型")).toHaveValue("varchar(255)");
    expect(within(structureDialog).getByLabelText("可空")).toBeChecked();
    expect(callBackendMock).toHaveBeenCalledWith("list_database_objects", {
      request: {
        connection_id: "mysql-dev",
        parent_kind: "table",
        database: "app",
        schema: "app",
        table: "users",
      },
    });

    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "编辑表 users" })).not.toBeInTheDocument();

    fireEvent.contextMenu(tableRow!, { clientX: 10, clientY: 20 });
    await userEvent.click(screen.getByRole("menuitem", { name: "DDL" }));

    const ddlDialog = await screen.findByRole("dialog", { name: "表 users DDL" });
    expect(ddlDialog).toBeInTheDocument();
    expect(ddlDialog.querySelector("pre")?.textContent).toContain("CREATE TABLE `users` (");
    expect(within(ddlDialog).getByText("耗时 6 ms")).toBeInTheDocument();
    expect(callBackendMock).toHaveBeenCalledWith("get_database_table_ddl", {
      request: {
        connection_id: "mysql-dev",
        database: "app",
        table: "users",
      },
    });

    await userEvent.click(within(ddlDialog).getByRole("button", { name: "复制 DDL" }));
    expect(writeClipboardTextMock).toHaveBeenCalledWith("CREATE TABLE `users` (\n  `id` int NOT NULL\n)");
  });

  it("edits table columns, previews DDL and applies table structure changes", async () => {
    let columnLoadCount = 0;
    callBackendMock.mockImplementation((command, payload) => {
      if (command === "list_database_objects") {
        const request = (payload as { request: { parent_kind?: string; table?: string } }).request;
        if (!request.parent_kind) {
          return Promise.resolve([{ id: "database:app", name: "app", kind: "database", has_children: true }]);
        }
        if (request.parent_kind === "table" && request.table === "users") {
          columnLoadCount += 1;
          return Promise.resolve([
            { id: "column:app.users.id", name: "id", kind: "column", has_children: false, detail: "int(11) NO" },
            { id: "column:app.users.name", name: "name", kind: "column", has_children: false, detail: "varchar(255) YES" },
            { id: "column:app.users.remark", name: "remark", kind: "column", has_children: false, detail: "text YES" },
          ]);
        }
        return Promise.resolve([{ id: "table:app.users", name: "users", kind: "table", has_children: true }]);
      }
      if (command === "preview_database_table_structure") {
        return Promise.resolve({
          ddl: "ALTER TABLE `users`\n  CHANGE COLUMN `name` `username` varchar(100) NOT NULL,\n  ADD COLUMN `age` int NULL,\n  DROP COLUMN `remark`;",
          duration_ms: 0,
        });
      }
      if (command === "update_database_table_structure") {
        return Promise.resolve({
          ddl: "ALTER TABLE `users`\n  CHANGE COLUMN `name` `username` varchar(100) NOT NULL,\n  ADD COLUMN `age` int NULL,\n  DROP COLUMN `remark`;",
          duration_ms: 12,
        });
      }
      return Promise.resolve([]);
    });

    renderDatabaseWorkspace("app");

    const tableRow = (await screen.findByRole("button", { name: "users" })).closest("li");
    expect(tableRow).not.toBeNull();
    fireEvent.contextMenu(tableRow!, { clientX: 10, clientY: 20 });
    await userEvent.click(screen.getByRole("menuitem", { name: "编辑" }));

    const dialog = await screen.findByRole("dialog", { name: "编辑表 users" });
    expect(within(dialog).getByLabelText("表结构对象")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "表 users" })).toHaveClass("database-table-structure-dialog__node--active");
    expect(within(dialog).getByRole("button", { name: "id int(11)" })).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "name varchar(255)" })).toBeInTheDocument();
    expect(within(dialog).getByText("索引")).toBeInTheDocument();
    expect(within(dialog).getByText("暂无索引元数据")).toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: "生成 DDL 预览" })).not.toBeInTheDocument();

    await userEvent.click(within(dialog).getByRole("button", { name: "name varchar(255)" }));
    expect(within(dialog).getByText("编辑字段 name")).toBeInTheDocument();
    await userEvent.clear(within(dialog).getByLabelText("字段名"));
    await userEvent.type(within(dialog).getByLabelText("字段名"), "username");
    fireEvent.blur(within(dialog).getByLabelText("字段名"));
    await userEvent.clear(within(dialog).getByLabelText("字段类型"));
    await userEvent.type(within(dialog).getByLabelText("字段类型"), "varchar(100)");
    fireEvent.blur(within(dialog).getByLabelText("字段类型"));
    await userEvent.click(within(dialog).getByLabelText("可空"));
    await userEvent.click(within(dialog).getByRole("button", { name: "remark text" }));
    const deleteColumnButton = within(dialog).getByRole("button", { name: "删除字段" });
    expect(deleteColumnButton).toHaveAttribute("title", "删除字段 remark");
    await userEvent.click(deleteColumnButton);
    await userEvent.click(within(dialog).getByRole("button", { name: "新增字段" }));
    await userEvent.clear(within(dialog).getByLabelText("字段名"));
    await userEvent.type(within(dialog).getByLabelText("字段名"), "age");
    fireEvent.blur(within(dialog).getByLabelText("字段名"));
    await userEvent.clear(within(dialog).getByLabelText("字段类型"));
    await userEvent.type(within(dialog).getByLabelText("字段类型"), "int");
    fireEvent.blur(within(dialog).getByLabelText("字段类型"));

    await waitFor(() => {
      expect(within(dialog).getByText(/CHANGE COLUMN `name` `username`/)).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(callBackendMock).toHaveBeenCalledWith("preview_database_table_structure", {
        request: {
          connection_id: "mysql-dev",
          database: "app",
          table: "users",
          operations: [
            {
              kind: "modify_column",
              original_name: "name",
              column: { name: "username", data_type: "varchar(100)", nullable: false },
            },
            {
              kind: "add_column",
              column: { name: "age", data_type: "int", nullable: true },
            },
            {
              kind: "drop_column",
              name: "remark",
            },
          ],
        },
      });
    });

    await userEvent.click(within(dialog).getByRole("button", { name: "执行更改" }));
    const confirmDialog = await screen.findByRole("dialog", { name: "确认执行表结构变更" });
    expect(confirmDialog.querySelector("pre")?.textContent).toBe(
      "ALTER TABLE `users`\n  CHANGE COLUMN `name` `username` varchar(100) NOT NULL,\n  ADD COLUMN `age` int NULL,\n  DROP COLUMN `remark`;",
    );
    expect(callBackendMock).not.toHaveBeenCalledWith("update_database_table_structure", expect.anything());
    await userEvent.click(within(confirmDialog).getByRole("button", { name: "确认执行" }));

    await waitFor(() => {
      expect(callBackendMock).toHaveBeenCalledWith("update_database_table_structure", {
        request: {
          connection_id: "mysql-dev",
          database: "app",
          table: "users",
          operations: [
            {
              kind: "modify_column",
              original_name: "name",
              column: { name: "username", data_type: "varchar(100)", nullable: false },
            },
            {
              kind: "add_column",
              column: { name: "age", data_type: "int", nullable: true },
            },
            {
              kind: "drop_column",
              name: "remark",
            },
          ],
        },
      });
    });
    expect(within(dialog).getByText("表结构已更新，耗时 12 ms")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("DDL 预览")).toContainElement(
      within(dialog).getByText("表结构已更新，耗时 12 ms"),
    );
    expect(columnLoadCount).toBeGreaterThanOrEqual(2);
  });

  it("updates table structure preview after committing field edits", async () => {
    callBackendMock.mockImplementation((command, payload) => {
      if (command === "list_database_objects") {
        const request = (payload as { request: { parent_kind?: string; table?: string } }).request;
        if (!request.parent_kind) {
          return Promise.resolve([{ id: "database:app", name: "app", kind: "database", has_children: true }]);
        }
        if (request.parent_kind === "table" && request.table === "users") {
          return Promise.resolve([
            { id: "column:app.users.name", name: "name", kind: "column", has_children: false, detail: "varchar(255) YES" },
          ]);
        }
        return Promise.resolve([{ id: "table:app.users", name: "users", kind: "table", has_children: true }]);
      }
      if (command === "preview_database_table_structure") {
        return Promise.resolve({
          ddl: "ALTER TABLE `users`\n  CHANGE COLUMN `name` `username` varchar(255) NULL;",
          duration_ms: 0,
        });
      }
      return Promise.resolve([]);
    });

    renderDatabaseWorkspace("app");
    const tableRow = (await screen.findByRole("button", { name: "users" })).closest("li");
    expect(tableRow).not.toBeNull();
    fireEvent.contextMenu(tableRow!, { clientX: 10, clientY: 20 });
    await userEvent.click(screen.getByRole("menuitem", { name: "编辑" }));

    const dialog = await screen.findByRole("dialog", { name: "编辑表 users" });
    await userEvent.click(within(dialog).getByRole("button", { name: "name varchar(255)" }));
    await userEvent.clear(within(dialog).getByLabelText("字段名"));
    await userEvent.type(within(dialog).getByLabelText("字段名"), "username");

    expect(callBackendMock.mock.calls.filter(([command]) => command === "preview_database_table_structure")).toHaveLength(0);
    fireEvent.blur(within(dialog).getByLabelText("字段名"));

    await waitFor(() => {
      expect(callBackendMock.mock.calls.filter(([command]) => command === "preview_database_table_structure")).toHaveLength(1);
    });
    expect(within(dialog).queryByText("生成中...")).not.toBeInTheDocument();
    expect(within(dialog).getByText(/CHANGE COLUMN `name` `username`/)).toBeInTheDocument();
    expect(within(dialog).queryByText("耗时 0 ms")).not.toBeInTheDocument();
  });

  it("asks for confirmation before applying dangerous table structure changes", async () => {
    callBackendMock.mockImplementation((command, payload) => {
      if (command === "list_database_objects") {
        const request = (payload as { request: { parent_kind?: string; table?: string } }).request;
        if (!request.parent_kind) {
          return Promise.resolve([{ id: "database:app", name: "app", kind: "database", has_children: true }]);
        }
        if (request.parent_kind === "table" && request.table === "users") {
          return Promise.resolve([
            { id: "column:app.users.remark", name: "remark", kind: "column", has_children: false, detail: "text YES" },
          ]);
        }
        return Promise.resolve([{ id: "table:app.users", name: "users", kind: "table", has_children: true }]);
      }
      if (command === "preview_database_table_structure") {
        return Promise.resolve({
          ddl: "ALTER TABLE `users`\n  DROP COLUMN `remark`;",
          duration_ms: 0,
        });
      }
      if (command === "update_database_table_structure") {
        return Promise.resolve({
          ddl: "ALTER TABLE `users`\n  DROP COLUMN `remark`;",
          duration_ms: 5,
        });
      }
      return Promise.resolve([]);
    });

    renderDatabaseWorkspace("app");
    const tableRow = (await screen.findByRole("button", { name: "users" })).closest("li");
    expect(tableRow).not.toBeNull();
    fireEvent.contextMenu(tableRow!, { clientX: 10, clientY: 20 });
    await userEvent.click(screen.getByRole("menuitem", { name: "编辑" }));

    const dialog = await screen.findByRole("dialog", { name: "编辑表 users" });
    await userEvent.click(within(dialog).getByRole("button", { name: "remark text" }));
    await userEvent.click(within(dialog).getByRole("button", { name: "删除字段" }));
    await waitFor(() => {
      expect(within(dialog).getByText(/DROP COLUMN `remark`/)).toBeInTheDocument();
    });

    await userEvent.click(within(dialog).getByRole("button", { name: "执行更改" }));

    const confirmDialog = await screen.findByRole("dialog", { name: "确认执行表结构变更" });
    expect(confirmDialog.querySelector("pre")?.textContent).toBe("ALTER TABLE `users`\n  DROP COLUMN `remark`;");
    expect(callBackendMock.mock.calls.filter(([command]) => command === "update_database_table_structure")).toHaveLength(0);

    await userEvent.click(within(confirmDialog).getByRole("button", { name: "确认执行" }));

    await waitFor(() => {
      expect(callBackendMock).toHaveBeenCalledWith("update_database_table_structure", {
        request: {
          connection_id: "mysql-dev",
          database: "app",
          table: "users",
          operations: [
            {
              kind: "drop_column",
              name: "remark",
            },
          ],
        },
      });
    });
  });

  it("loads the latest DDL before confirming fast dangerous table structure changes", async () => {
    callBackendMock.mockImplementation((command, payload) => {
      if (command === "list_database_objects") {
        const request = (payload as { request: { parent_kind?: string; table?: string } }).request;
        if (!request.parent_kind) {
          return Promise.resolve([{ id: "database:app", name: "app", kind: "database", has_children: true }]);
        }
        if (request.parent_kind === "table" && request.table === "users") {
          return Promise.resolve([
            { id: "column:app.users.id", name: "id", kind: "column", has_children: false, detail: "int(11) NO" },
          ]);
        }
        return Promise.resolve([{ id: "table:app.users", name: "users", kind: "table", has_children: true }]);
      }
      if (command === "preview_database_table_structure") {
        return Promise.resolve({
          ddl: "RENAME TABLE `users` TO `members`;",
          duration_ms: 0,
        });
      }
      return Promise.resolve([]);
    });

    renderDatabaseWorkspace("app");
    const tableRow = (await screen.findByRole("button", { name: "users" })).closest("li");
    expect(tableRow).not.toBeNull();
    fireEvent.contextMenu(tableRow!, { clientX: 10, clientY: 20 });
    await userEvent.click(screen.getByRole("menuitem", { name: "编辑" }));

    const dialog = await screen.findByRole("dialog", { name: "编辑表 users" });
    await userEvent.clear(within(dialog).getByLabelText("表名"));
    await userEvent.type(within(dialog).getByLabelText("表名"), "members");
    await userEvent.click(within(dialog).getByRole("button", { name: "执行更改" }));

    const confirmDialog = await screen.findByRole("dialog", { name: "确认执行表结构变更" });
    expect(confirmDialog.querySelector("pre")?.textContent).toBe("RENAME TABLE `users` TO `members`;");
  });

  it("validates table structure changes before applying them", async () => {
    callBackendMock.mockImplementation((command, payload) => {
      if (command === "list_database_objects") {
        const request = (payload as { request: { parent_kind?: string; table?: string } }).request;
        if (!request.parent_kind) {
          return Promise.resolve([{ id: "database:app", name: "app", kind: "database", has_children: true }]);
        }
        if (request.parent_kind === "table" && request.table === "users") {
          return Promise.resolve([
            { id: "column:app.users.name", name: "name", kind: "column", has_children: false, detail: "varchar(255) YES" },
          ]);
        }
        return Promise.resolve([{ id: "table:app.users", name: "users", kind: "table", has_children: true }]);
      }
      if (command === "preview_database_table_structure") {
        return Promise.resolve({ ddl: "ALTER TABLE `users`\n  ADD COLUMN `age` int NULL;", duration_ms: 0 });
      }
      if (command === "update_database_table_structure") {
        return Promise.resolve({ ddl: "ALTER TABLE `users`\n  ADD COLUMN `age` int NULL;", duration_ms: 1 });
      }
      return Promise.resolve([]);
    });

    renderDatabaseWorkspace("app");
    const tableRow = (await screen.findByRole("button", { name: "users" })).closest("li");
    expect(tableRow).not.toBeNull();
    fireEvent.contextMenu(tableRow!, { clientX: 10, clientY: 20 });
    await userEvent.click(screen.getByRole("menuitem", { name: "编辑" }));

    const dialog = await screen.findByRole("dialog", { name: "编辑表 users" });
    await userEvent.click(within(dialog).getByRole("button", { name: "新增字段" }));
    await userEvent.clear(within(dialog).getByLabelText("字段类型"));
    await userEvent.type(within(dialog).getByLabelText("字段类型"), "int");
    fireEvent.blur(within(dialog).getByLabelText("字段类型"));
    await userEvent.click(within(dialog).getByRole("button", { name: "执行更改" }));

    expect(within(dialog).getByRole("alert")).toHaveTextContent("字段名不能为空");
    expect(callBackendMock.mock.calls.filter(([command]) => command === "update_database_table_structure")).toHaveLength(0);
  });

  it("rejects duplicate table structure names before applying changes", async () => {
    callBackendMock.mockImplementation((command, payload) => {
      if (command === "list_database_objects") {
        const request = (payload as { request: { parent_kind?: string; table?: string } }).request;
        if (!request.parent_kind) {
          return Promise.resolve([{ id: "database:app", name: "app", kind: "database", has_children: true }]);
        }
        if (request.parent_kind === "table" && request.table === "users") {
          return Promise.resolve([
            { id: "column:app.users.id", name: "id", kind: "column", has_children: false, detail: "int(11) NO" },
            { id: "column:app.users.name", name: "name", kind: "column", has_children: false, detail: "varchar(255) YES" },
          ]);
        }
        return Promise.resolve([{ id: "table:app.users", name: "users", kind: "table", has_children: true }]);
      }
      if (command === "update_database_table_structure") {
        return Promise.resolve({ ddl: "", duration_ms: 1 });
      }
      return Promise.resolve([]);
    });

    renderDatabaseWorkspace("app");
    const tableRow = (await screen.findByRole("button", { name: "users" })).closest("li");
    expect(tableRow).not.toBeNull();
    fireEvent.contextMenu(tableRow!, { clientX: 10, clientY: 20 });
    await userEvent.click(screen.getByRole("menuitem", { name: "编辑" }));

    const dialog = await screen.findByRole("dialog", { name: "编辑表 users" });
    await userEvent.click(within(dialog).getByRole("button", { name: "新增字段" }));
    await userEvent.type(within(dialog).getByLabelText("字段名"), "name");
    fireEvent.blur(within(dialog).getByLabelText("字段名"));
    await userEvent.click(within(dialog).getByRole("button", { name: "执行更改" }));

    expect(within(dialog).getByRole("alert")).toHaveTextContent("字段名不能重复");
    expect(callBackendMock.mock.calls.filter(([command]) => command === "update_database_table_structure")).toHaveLength(0);
  });

  it("rejects duplicate table index names before applying changes", async () => {
    callBackendMock.mockImplementation((command, payload) => {
      if (command === "list_database_objects") {
        const request = (payload as { request: { parent_kind?: string; table?: string } }).request;
        if (!request.parent_kind) {
          return Promise.resolve([{ id: "database:app", name: "app", kind: "database", has_children: true }]);
        }
        if (request.parent_kind === "table" && request.table === "users") {
          return Promise.resolve([
            { id: "column:app.users.name", name: "name", kind: "column", has_children: false, detail: "varchar(255) YES" },
            {
              id: "index:app.users.idx_users_name",
              name: "idx_users_name",
              kind: "index",
              has_children: false,
              detail: "unique=NO;columns=name;definition=KEY `idx_users_name` (`name`)",
            },
          ]);
        }
        return Promise.resolve([{ id: "table:app.users", name: "users", kind: "table", has_children: true }]);
      }
      if (command === "update_database_table_structure") {
        return Promise.resolve({ ddl: "", duration_ms: 1 });
      }
      return Promise.resolve([]);
    });

    renderDatabaseWorkspace("app");
    const tableRow = (await screen.findByRole("button", { name: "users" })).closest("li");
    expect(tableRow).not.toBeNull();
    fireEvent.contextMenu(tableRow!, { clientX: 10, clientY: 20 });
    await userEvent.click(screen.getByRole("menuitem", { name: "编辑" }));

    const dialog = await screen.findByRole("dialog", { name: "编辑表 users" });
    await userEvent.click(within(dialog).getByRole("button", { name: "新增索引" }));
    await userEvent.clear(within(dialog).getByLabelText("索引名"));
    await userEvent.type(within(dialog).getByLabelText("索引名"), "idx_users_name");
    fireEvent.blur(within(dialog).getByLabelText("索引名"));
    await userEvent.click(within(dialog).getByRole("button", { name: "执行更改" }));

    expect(within(dialog).getByRole("alert")).toHaveTextContent("索引名不能重复");
    expect(callBackendMock.mock.calls.filter(([command]) => command === "update_database_table_structure")).toHaveLength(0);
  });

  it("edits column default value and comment in table structure dialog", async () => {
    callBackendMock.mockImplementation((command, payload) => {
      if (command === "list_database_objects") {
        const request = (payload as { request: { parent_kind?: string; table?: string } }).request;
        if (!request.parent_kind) {
          return Promise.resolve([{ id: "database:app", name: "app", kind: "database", has_children: true }]);
        }
        if (request.parent_kind === "table" && request.table === "users") {
          return Promise.resolve([
            {
              id: "column:app.users.name",
              name: "name",
              kind: "column",
              has_children: false,
              detail: "type=varchar(255);nullable=YES;default=;extra=;comment=",
            },
          ]);
        }
        return Promise.resolve([{ id: "table:app.users", name: "users", kind: "table", has_children: true }]);
      }
      if (command === "preview_database_table_structure") {
        return Promise.resolve({
          ddl: "ALTER TABLE `users`\n  CHANGE COLUMN `name` `name` varchar(255) NULL DEFAULT 'anonymous' COMMENT '用户名';",
          duration_ms: 0,
        });
      }
      return Promise.resolve([]);
    });

    renderDatabaseWorkspace("app");
    const tableRow = (await screen.findByRole("button", { name: "users" })).closest("li");
    expect(tableRow).not.toBeNull();
    fireEvent.contextMenu(tableRow!, { clientX: 10, clientY: 20 });
    await userEvent.click(screen.getByRole("menuitem", { name: "编辑" }));

    const dialog = await screen.findByRole("dialog", { name: "编辑表 users" });
    await userEvent.click(within(dialog).getByRole("button", { name: "name varchar(255)" }));
    await userEvent.clear(within(dialog).getByLabelText("默认值"));
    await userEvent.type(within(dialog).getByLabelText("默认值"), "anonymous");
    fireEvent.blur(within(dialog).getByLabelText("默认值"));
    await userEvent.clear(within(dialog).getByLabelText("注释"));
    await userEvent.type(within(dialog).getByLabelText("注释"), "用户名");
    fireEvent.blur(within(dialog).getByLabelText("注释"));

    await waitFor(() => {
      expect(callBackendMock).toHaveBeenCalledWith("preview_database_table_structure", {
        request: {
          connection_id: "mysql-dev",
          database: "app",
          table: "users",
          operations: [
            {
              kind: "modify_column",
              original_name: "name",
              column: {
                name: "name",
                data_type: "varchar(255)",
                nullable: true,
                default_value: "anonymous",
                comment: "用户名",
              },
            },
          ],
        },
      });
    });
    expect(within(dialog).getByText(/DEFAULT 'anonymous' COMMENT '用户名'/)).toBeInTheDocument();
  });

  it("renames table from table structure dialog", async () => {
    callBackendMock.mockImplementation((command, payload) => {
      if (command === "list_database_objects") {
        const request = (payload as { request: { parent_kind?: string; table?: string } }).request;
        if (!request.parent_kind) {
          return Promise.resolve([{ id: "database:app", name: "app", kind: "database", has_children: true }]);
        }
        if (request.parent_kind === "database") {
          const hasRenamed = callBackendMock.mock.calls.some(([calledCommand]) => calledCommand === "update_database_table_structure");
          return Promise.resolve([
            hasRenamed
              ? { id: "table:app.members", name: "members", kind: "table", has_children: true }
              : { id: "table:app.users", name: "users", kind: "table", has_children: true },
          ]);
        }
        if (request.parent_kind === "table" && request.table === "users") {
          return Promise.resolve([
            { id: "column:app.users.id", name: "id", kind: "column", has_children: false, detail: "int(11) NO" },
          ]);
        }
        if (request.parent_kind === "table" && request.table === "members") {
          return Promise.resolve([
            { id: "column:app.members.id", name: "id", kind: "column", has_children: false, detail: "int(11) NO" },
          ]);
        }
        return Promise.resolve([{ id: "table:app.users", name: "users", kind: "table", has_children: true }]);
      }
      if (command === "preview_database_table_structure") {
        return Promise.resolve({
          ddl: "RENAME TABLE `users` TO `members`;",
          duration_ms: 0,
        });
      }
      if (command === "update_database_table_structure") {
        return Promise.resolve({
          ddl: "RENAME TABLE `users` TO `members`;",
          duration_ms: 9,
        });
      }
      return Promise.resolve([]);
    });

    renderDatabaseWorkspace("app");
    const tableRow = (await screen.findByRole("button", { name: "users" })).closest("li");
    expect(tableRow).not.toBeNull();
    fireEvent.contextMenu(tableRow!, { clientX: 10, clientY: 20 });
    await userEvent.click(screen.getByRole("menuitem", { name: "编辑" }));

    const dialog = await screen.findByRole("dialog", { name: "编辑表 users" });
    await userEvent.clear(within(dialog).getByLabelText("表名"));
    await userEvent.type(within(dialog).getByLabelText("表名"), "members");
    fireEvent.blur(within(dialog).getByLabelText("表名"));

    await waitFor(() => {
      expect(within(dialog).getByText("RENAME TABLE `users` TO `members`;")).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(callBackendMock).toHaveBeenCalledWith("preview_database_table_structure", {
        request: {
          connection_id: "mysql-dev",
          database: "app",
          table: "users",
          operations: [
            {
              kind: "rename_table",
              new_name: "members",
            },
          ],
        },
      });
    });

    await userEvent.click(within(dialog).getByRole("button", { name: "执行更改" }));
    const confirmDialog = await screen.findByRole("dialog", { name: "确认执行表结构变更" });
    expect(confirmDialog.querySelector("pre")?.textContent).toBe("RENAME TABLE `users` TO `members`;");
    expect(callBackendMock).not.toHaveBeenCalledWith("update_database_table_structure", expect.anything());
    await userEvent.click(within(confirmDialog).getByRole("button", { name: "确认执行" }));

    await waitFor(() => {
      expect(callBackendMock).toHaveBeenCalledWith("update_database_table_structure", {
        request: {
          connection_id: "mysql-dev",
          database: "app",
          table: "users",
          operations: [
            {
              kind: "rename_table",
              new_name: "members",
            },
          ],
        },
      });
    });
    expect(within(dialog).getByDisplayValue("members")).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "members" })).toBeInTheDocument();
    });
  });

  it("shows table indexes in table structure dialog", async () => {
    callBackendMock.mockImplementation((command, payload) => {
      if (command === "list_database_objects") {
        const request = (payload as { request: { parent_kind?: string; table?: string } }).request;
        if (!request.parent_kind) {
          return Promise.resolve([{ id: "database:app", name: "app", kind: "database", has_children: true }]);
        }
        if (request.parent_kind === "table" && request.table === "users") {
          return Promise.resolve([
            { id: "column:app.users.id", name: "id", kind: "column", has_children: false, detail: "int(11) NO" },
            { id: "column:app.users.name", name: "name", kind: "column", has_children: false, detail: "varchar(255) YES" },
            {
              id: "index:app.users.idx_users_name",
              name: "idx_users_name",
              kind: "index",
              has_children: false,
              detail: "unique=NO;columns=name;definition=KEY `idx_users_name` (`name`)",
            },
          ]);
        }
        return Promise.resolve([{ id: "table:app.users", name: "users", kind: "table", has_children: true }]);
      }
      return Promise.resolve([]);
    });

    renderDatabaseWorkspace("app");
    const tableRow = (await screen.findByRole("button", { name: "users" })).closest("li");
    expect(tableRow).not.toBeNull();
    fireEvent.contextMenu(tableRow!, { clientX: 10, clientY: 20 });
    await userEvent.click(screen.getByRole("menuitem", { name: "编辑" }));

    const dialog = await screen.findByRole("dialog", { name: "编辑表 users" });
    expect(within(dialog).getByRole("button", { name: "idx_users_name name" })).toBeInTheDocument();

    await userEvent.click(within(dialog).getByRole("button", { name: "idx_users_name name" }));

    expect(within(dialog).getByText("索引 idx_users_name")).toBeInTheDocument();
    expect(within(dialog).getByDisplayValue("idx_users_name")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("唯一索引")).not.toBeChecked();
    expect(within(dialog).getByRole("button", { name: "name" })).toBeInTheDocument();
    expect(within(dialog).queryByRole("checkbox", { name: "name" })).not.toBeInTheDocument();
    expect(within(dialog).getByText("KEY `idx_users_name` (`name`)")).toBeInTheDocument();
  });

  it("edits table index and previews drop plus add DDL", async () => {
    callBackendMock.mockImplementation((command, payload) => {
      if (command === "list_database_objects") {
        const request = (payload as { request: { parent_kind?: string; table?: string } }).request;
        if (!request.parent_kind) {
          return Promise.resolve([{ id: "database:app", name: "app", kind: "database", has_children: true }]);
        }
        if (request.parent_kind === "table" && request.table === "users") {
          return Promise.resolve([
            { id: "column:app.users.name", name: "name", kind: "column", has_children: false, detail: "varchar(255) YES" },
            { id: "column:app.users.email", name: "email", kind: "column", has_children: false, detail: "varchar(255) YES" },
            {
              id: "index:app.users.idx_users_name",
              name: "idx_users_name",
              kind: "index",
              has_children: false,
              detail: "unique=NO;columns=name;definition=KEY `idx_users_name` (`name`)",
            },
          ]);
        }
        return Promise.resolve([{ id: "table:app.users", name: "users", kind: "table", has_children: true }]);
      }
      if (command === "preview_database_table_structure") {
        return Promise.resolve({
          ddl: "ALTER TABLE `users`\n  DROP INDEX `idx_users_name`,\n  ADD UNIQUE INDEX `idx_users_name_email` (`name`, `email`);",
          duration_ms: 0,
        });
      }
      return Promise.resolve([]);
    });

    renderDatabaseWorkspace("app");
    const tableRow = (await screen.findByRole("button", { name: "users" })).closest("li");
    expect(tableRow).not.toBeNull();
    fireEvent.contextMenu(tableRow!, { clientX: 10, clientY: 20 });
    await userEvent.click(screen.getByRole("menuitem", { name: "编辑" }));

    const dialog = await screen.findByRole("dialog", { name: "编辑表 users" });
    await userEvent.click(within(dialog).getByRole("button", { name: "idx_users_name name" }));
    await userEvent.clear(within(dialog).getByLabelText("索引名"));
    await userEvent.type(within(dialog).getByLabelText("索引名"), "idx_users_name_email");
    fireEvent.blur(within(dialog).getByLabelText("索引名"));
    await userEvent.click(within(dialog).getByRole("button", { name: "name" }));
    expect(within(dialog).getByRole("checkbox", { name: "name" })).toBeChecked();
    await userEvent.click(within(dialog).getByRole("checkbox", { name: "email" }));
    await userEvent.click(within(dialog).getByLabelText("唯一索引"));

    await waitFor(() => {
      expect(callBackendMock).toHaveBeenCalledWith("preview_database_table_structure", {
        request: {
          connection_id: "mysql-dev",
          database: "app",
          table: "users",
          operations: [
            { kind: "drop_index", name: "idx_users_name" },
            {
              kind: "add_index",
              index: {
                name: "idx_users_name_email",
                columns: ["name", "email"],
                unique: true,
              },
            },
          ],
        },
      });
    });
    expect(within(dialog).getByText(/ADD UNIQUE INDEX `idx_users_name_email`/)).toBeInTheDocument();
  });

  it("closes table index column dropdown when clicking outside", async () => {
    callBackendMock.mockImplementation((command, payload) => {
      if (command === "list_database_objects") {
        const request = (payload as { request: { parent_kind?: string; table?: string } }).request;
        if (!request.parent_kind) {
          return Promise.resolve([{ id: "database:app", name: "app", kind: "database", has_children: true }]);
        }
        if (request.parent_kind === "table" && request.table === "users") {
          return Promise.resolve([
            { id: "column:app.users.name", name: "name", kind: "column", has_children: false, detail: "varchar(255) YES" },
            { id: "column:app.users.email", name: "email", kind: "column", has_children: false, detail: "varchar(255) YES" },
            {
              id: "index:app.users.idx_users_name",
              name: "idx_users_name",
              kind: "index",
              has_children: false,
              detail: "unique=NO;columns=name;definition=KEY `idx_users_name` (`name`)",
            },
          ]);
        }
        return Promise.resolve([{ id: "table:app.users", name: "users", kind: "table", has_children: true }]);
      }
      return Promise.resolve([]);
    });

    renderDatabaseWorkspace("app");
    const tableRow = (await screen.findByRole("button", { name: "users" })).closest("li");
    expect(tableRow).not.toBeNull();
    fireEvent.contextMenu(tableRow!, { clientX: 10, clientY: 20 });
    await userEvent.click(screen.getByRole("menuitem", { name: "编辑" }));

    const dialog = await screen.findByRole("dialog", { name: "编辑表 users" });
    await userEvent.click(within(dialog).getByRole("button", { name: "idx_users_name name" }));
    await userEvent.click(within(dialog).getByRole("button", { name: "name" }));
    expect(within(dialog).getByRole("checkbox", { name: "email" })).toBeInTheDocument();

    await userEvent.click(within(dialog).getByText("索引定义"));

    expect(within(dialog).queryByRole("checkbox", { name: "email" })).not.toBeInTheDocument();
  });

  it("adds table index from table structure dialog", async () => {
    callBackendMock.mockImplementation((command, payload) => {
      if (command === "list_database_objects") {
        const request = (payload as { request: { parent_kind?: string; table?: string } }).request;
        if (!request.parent_kind) {
          return Promise.resolve([{ id: "database:app", name: "app", kind: "database", has_children: true }]);
        }
        if (request.parent_kind === "table" && request.table === "users") {
          return Promise.resolve([
            { id: "column:app.users.email", name: "email", kind: "column", has_children: false, detail: "varchar(255) YES" },
          ]);
        }
        return Promise.resolve([{ id: "table:app.users", name: "users", kind: "table", has_children: true }]);
      }
      if (command === "preview_database_table_structure") {
        return Promise.resolve({
          ddl: "ALTER TABLE `users`\n  ADD INDEX `idx_users_email` (`email`);",
          duration_ms: 0,
        });
      }
      return Promise.resolve([]);
    });

    renderDatabaseWorkspace("app");
    const tableRow = (await screen.findByRole("button", { name: "users" })).closest("li");
    expect(tableRow).not.toBeNull();
    fireEvent.contextMenu(tableRow!, { clientX: 10, clientY: 20 });
    await userEvent.click(screen.getByRole("menuitem", { name: "编辑" }));

    const dialog = await screen.findByRole("dialog", { name: "编辑表 users" });
    await userEvent.click(within(dialog).getByRole("button", { name: "新增索引" }));
    await userEvent.clear(within(dialog).getByLabelText("索引名"));
    await userEvent.type(within(dialog).getByLabelText("索引名"), "idx_users_email");
    fireEvent.blur(within(dialog).getByLabelText("索引名"));

    await waitFor(() => {
      expect(callBackendMock).toHaveBeenCalledWith("preview_database_table_structure", {
        request: {
          connection_id: "mysql-dev",
          database: "app",
          table: "users",
          operations: [
            {
              kind: "add_index",
              index: {
                name: "idx_users_email",
                columns: ["email"],
                unique: false,
              },
            },
          ],
        },
      });
    });
  });

  it("shows extended column metadata in table structure dialog", async () => {
    callBackendMock.mockImplementation((command, payload) => {
      if (command === "list_database_objects") {
        const request = (payload as { request: { parent_kind?: string; table?: string } }).request;
        if (!request.parent_kind) {
          return Promise.resolve([{ id: "database:app", name: "app", kind: "database", has_children: true }]);
        }
        if (request.parent_kind === "table" && request.table === "users") {
          return Promise.resolve([
            {
              id: "column:app.users.id",
              name: "id",
              kind: "column",
              has_children: false,
              detail: "type=int(11);nullable=NO;default=;extra=auto_increment;comment=主键",
            },
            {
              id: "column:app.users.empty_text",
              name: "empty_text",
              kind: "column",
              has_children: false,
              detail: "type=varchar(122);nullable=YES;default=;default_null=NO;extra=;comment=测试",
            },
          ]);
        }
        return Promise.resolve([{ id: "table:app.users", name: "users", kind: "table", has_children: true }]);
      }
      return Promise.resolve([]);
    });

    renderDatabaseWorkspace("app");
    const tableRow = (await screen.findByRole("button", { name: "users" })).closest("li");
    expect(tableRow).not.toBeNull();
    fireEvent.contextMenu(tableRow!, { clientX: 10, clientY: 20 });
    await userEvent.click(screen.getByRole("menuitem", { name: "编辑" }));

    const dialog = await screen.findByRole("dialog", { name: "编辑表 users" });
    await userEvent.click(within(dialog).getByRole("button", { name: "id int(11)" }));

    expect(within(dialog).getByDisplayValue("auto_increment")).toBeInTheDocument();
    expect(within(dialog).getByDisplayValue("主键")).toBeInTheDocument();
    expect(within(dialog).getByPlaceholderText("<无默认值>")).toBeInTheDocument();

    await userEvent.click(within(dialog).getByRole("button", { name: "empty_text varchar(122)" }));
    expect(within(dialog).getByDisplayValue("''")).toBeInTheDocument();
  });

  it("shows table column types only in tooltip and constrains long cell values", async () => {
    callBackendMock.mockImplementation((command, payload) => {
      if (command === "list_database_objects") {
        const request = (payload as { request: { parent_kind?: string } }).request;
        if (!request.parent_kind) {
          return Promise.resolve([{ id: "database:app", name: "app", kind: "database", has_children: true }]);
        }
        return Promise.resolve([{ id: "table:app.logs", name: "logs", kind: "table", has_children: true }]);
      }
      if (command === "load_database_table_page") {
        return Promise.resolve({
          columns: [
            { name: "id", data_type: "int(11)" },
            { name: "payload", data_type: "LONGTEXT" },
          ],
          rows: [[
            { kind: "number", value: "1" },
            { kind: "text", value: "this-is-a-very-long-log-payload-that-should-not-stretch-the-column" },
          ]],
          total_rows: 1,
          page: 1,
          page_size: 200,
          duration_ms: 9,
          primary_key_columns: ["id"],
          editable: true,
        });
      }
      return Promise.resolve([]);
    });

    renderDatabaseWorkspace("app");
    await userEvent.dblClick(await screen.findByText("logs"));

    const idHeader = await screen.findByRole("columnheader", { name: "id int(11)" });
    expect(idHeader).toHaveAttribute("title", "id: int(11)");
    expect(within(idHeader).queryByText("int(11)")).not.toBeInTheDocument();

    const longCell = screen.getByText("this-is-a-very-long-log-payload-that-should-not-stretch-the-column");
    expect(longCell).toHaveClass("database-table-browser__cell-content");
    expect(longCell).toHaveAttribute("title", "this-is-a-very-long-log-payload-that-should-not-stretch-the-column");

    const columnWidths = Array.from(
      screen.getByLabelText("表数据").querySelectorAll<HTMLTableColElement>(".database-table-browser__data-column"),
    ).map((column) => Number(column.style.width.replace("px", "")));
    expect(columnWidths).toHaveLength(2);
    expect(Math.min(...columnWidths)).toBeGreaterThanOrEqual(96);
    expect(Math.max(...columnWidths)).toBeLessThanOrEqual(240);
    expect(screen.getByLabelText("表数据").querySelector("table")).toHaveStyle({
      width: `${52 + columnWidths.reduce((total, width) => total + width, 0)}px`,
    });
  });

  it("updates table browser paging, sorting and filtering", async () => {
    callBackendMock.mockImplementation((command, payload) => {
      if (command === "list_database_objects") {
        const request = (payload as { request: { parent_kind?: string } }).request;
        if (!request.parent_kind) {
          return Promise.resolve([{ id: "database:app", name: "app", kind: "database", has_children: true }]);
        }
        return Promise.resolve([{ id: "table:app.users", name: "users", kind: "table", has_children: true }]);
      }
      if (command === "load_database_table_page") {
        const request = (payload as { request: { page: number } }).request;
        return Promise.resolve({
          columns: [
            { name: "id", data_type: "INT" },
            { name: "name", data_type: "VARCHAR" },
          ],
          rows: [[{ kind: "number", value: String(request.page) }, { kind: "text", value: "Alice" }]],
          total_rows: 501,
          page: request.page,
          page_size: 200,
          duration_ms: 9,
          primary_key_columns: ["id"],
          editable: true,
        });
      }
      return Promise.resolve([]);
    });

    renderDatabaseWorkspace("app");

    await userEvent.dblClick(await screen.findByText("users"));
    await screen.findByLabelText("表数据");

    await userEvent.click(screen.getByRole("button", { name: "下一页" }));
    await waitFor(() => {
      expect(callBackendMock).toHaveBeenCalledWith("load_database_table_page", {
        request: expect.objectContaining({
          page: 2,
        }),
      });
    });

    await userEvent.click(screen.getByRole("button", { name: "id INT" }));
    expect(screen.getByLabelText("排序")).toHaveAttribute("placeholder", "如 id desc");
    await waitFor(() => {
      expect(callBackendMock).toHaveBeenCalledWith("load_database_table_page", {
        request: expect.objectContaining({
          page: 1,
          sort_column: "id",
          sort_direction: "asc",
          order_by: null,
        }),
      });
    });

    await userEvent.click(screen.getByRole("button", { name: "id INT ↑" }));
    await waitFor(() => {
      expect(callBackendMock).toHaveBeenCalledWith("load_database_table_page", {
        request: expect.objectContaining({
          sort_column: "id",
          sort_direction: "desc",
          order_by: null,
        }),
      });
    });

    expect(screen.getByLabelText("排序")).toHaveAttribute("placeholder", "如 id desc");
    await userEvent.type(screen.getByLabelText("排序"), "id desc{Enter}");
    await waitFor(() => {
      expect(callBackendMock).toHaveBeenCalledWith("load_database_table_page", {
        request: expect.objectContaining({
          page: 1,
          sort_column: null,
          sort_direction: null,
          order_by: "id desc",
        }),
      });
    });

    await userEvent.type(screen.getByLabelText("筛选"), "name = 'Alice'{Enter}");
    await waitFor(() => {
      expect(callBackendMock).toHaveBeenCalledWith("load_database_table_page", {
        request: expect.objectContaining({
          filter: "name = 'Alice'",
        }),
      });
    });
  });

  it("resizes the database table list and applies table browser paging after commit", async () => {
    callBackendMock.mockImplementation((command, payload) => {
      if (command === "list_database_objects") {
        const request = (payload as { request: { parent_kind?: string } }).request;
        if (!request.parent_kind) {
          return Promise.resolve([{ id: "database:app", name: "app", kind: "database", has_children: true }]);
        }
        return Promise.resolve([{ id: "table:app.users", name: "users", kind: "table", has_children: true }]);
      }
      if (command === "load_database_table_page") {
        const request = (payload as { request: { page: number; page_size: number } }).request;
        return Promise.resolve({
          columns: [{ name: "id", data_type: "INT" }],
          rows: [[{ kind: "number", value: String(request.page) }]],
          total_rows: 1000,
          page: request.page,
          page_size: request.page_size,
          duration_ms: 9,
          primary_key_columns: ["id"],
          editable: true,
        });
      }
      return Promise.resolve([]);
    });

    renderDatabaseWorkspace("app");

    expect(screen.getByLabelText("数据库工作区")).toHaveStyle({
      "--database-object-tree-width": "220px",
    });

    const resizeHandle = await screen.findByRole("separator", { name: "调整数据库表列表宽度" });
    fireEvent.mouseDown(resizeHandle, { clientX: 220 });
    fireEvent.mouseMove(window, { clientX: 300 });
    fireEvent.mouseUp(window);
    expect(screen.getByLabelText("数据库工作区")).toHaveStyle({
      "--database-object-tree-width": "300px",
    });

    await userEvent.dblClick(await screen.findByText("users"));
    await screen.findByLabelText("表数据");
    expect(screen.getByLabelText("表数据").querySelector(".database-table-browser__table-wrap")).not.toBeNull();
    callBackendMock.mockClear();

    await userEvent.click(screen.getByRole("button", { name: "下一页" }));
    await waitFor(() => {
      expect(callBackendMock).toHaveBeenCalledWith("load_database_table_page", {
        request: expect.objectContaining({
          page: 2,
        }),
      });
    });

    callBackendMock.mockClear();
    await userEvent.click(screen.getByRole("button", { name: "每页" }));
    await userEvent.click(screen.getByRole("menuitemradio", { name: "500" }));
    await waitFor(() => {
      expect(callBackendMock).toHaveBeenCalledWith("load_database_table_page", {
        request: expect.objectContaining({
          page: 1,
          page_size: 500,
        }),
      });
    });
  });

  it("shows readonly reason when table page has no primary key", async () => {
    callBackendMock.mockImplementation((command, payload) => {
      if (command === "list_database_objects") {
        const request = (payload as { request: { parent_kind?: string } }).request;
        if (!request.parent_kind) {
          return Promise.resolve([{ id: "database:app", name: "app", kind: "database", has_children: true }]);
        }
        return Promise.resolve([{ id: "table:app.logs", name: "logs", kind: "table", has_children: true }]);
      }
      if (command === "load_database_table_page") {
        return Promise.resolve({
          columns: [{ name: "message", data_type: "VARCHAR" }],
          rows: [[{ kind: "text", value: "hello" }]],
          total_rows: 1,
          page: 1,
          page_size: 200,
          duration_ms: 9,
          primary_key_columns: [],
          editable: false,
        });
      }
      return Promise.resolve([]);
    });

    renderDatabaseWorkspace("app");
    await userEvent.dblClick(await screen.findByText("logs"));

    expect(await screen.findByText("当前表没有主键，表数据只读。")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "保存更改" })).toBeDisabled();
  });

  it("edits non-primary-key cells locally and marks unsaved changes", async () => {
    callBackendMock.mockImplementation((command, payload) => {
      if (command === "list_database_objects") {
        const request = (payload as { request: { parent_kind?: string } }).request;
        if (!request.parent_kind) {
          return Promise.resolve([{ id: "database:app", name: "app", kind: "database", has_children: true }]);
        }
        return Promise.resolve([{ id: "table:app.users", name: "users", kind: "table", has_children: true }]);
      }
      if (command === "load_database_table_page") {
        return Promise.resolve({
          columns: [
            { name: "id", data_type: "INT" },
            { name: "name", data_type: "VARCHAR" },
          ],
          rows: [[{ kind: "number", value: "1" }, { kind: "text", value: "Alice" }]],
          total_rows: 1,
          page: 1,
          page_size: 200,
          duration_ms: 9,
          primary_key_columns: ["id"],
          editable: true,
        });
      }
      return Promise.resolve([]);
    });

    renderDatabaseWorkspace("app");
    await userEvent.dblClick(await screen.findByText("users"));
    await screen.findByLabelText("表数据");

    await userEvent.dblClick(screen.getByText("Alice"));
    const editor = screen.getByLabelText("编辑 name");
    await userEvent.clear(editor);
    await userEvent.type(editor, "Bob{Enter}");

    expect(screen.getByText("未保存 1 行 / 1 字段")).toBeInTheDocument();
    expect(screen.getByText("Bob").closest("td")).toHaveClass("database-table-browser__cell--dirty");
    await userEvent.dblClick(screen.getAllByText("1")[1]);
    expect(screen.queryByLabelText("编辑 id")).not.toBeInTheDocument();
  });

  it("selects a table cell on click and enters editing mode with all text selected on double click", async () => {
    const selectSpy = vi.spyOn(HTMLInputElement.prototype, "select");
    callBackendMock.mockImplementation((command, payload) => {
      if (command === "list_database_objects") {
        const request = (payload as { request: { parent_kind?: string } }).request;
        if (!request.parent_kind) {
          return Promise.resolve([{ id: "database:app", name: "app", kind: "database", has_children: true }]);
        }
        return Promise.resolve([{ id: "table:app.users", name: "users", kind: "table", has_children: true }]);
      }
      if (command === "load_database_table_page") {
        return Promise.resolve({
          columns: [
            { name: "id", data_type: "INT" },
            { name: "name", data_type: "VARCHAR" },
          ],
          rows: [[{ kind: "number", value: "1" }, { kind: "text", value: "Alice" }]],
          total_rows: 1,
          page: 1,
          page_size: 200,
          duration_ms: 9,
          primary_key_columns: ["id"],
          editable: true,
        });
      }
      return Promise.resolve([]);
    });

    renderDatabaseWorkspace("app");
    await userEvent.dblClick(await screen.findByText("users"));
    await screen.findByLabelText("表数据");

    const cell = screen.getByText("Alice").closest("td");
    const row = screen.getByText("Alice").closest("tr");
    expect(cell).not.toBeNull();
    expect(row).not.toBeNull();

    await userEvent.click(screen.getByText("Alice"));

    expect(cell).toHaveClass("database-table-browser__cell--selected");
    expect(row).toHaveClass("database-table-browser__row--selected");
    expect(screen.getByLabelText("第 1 行 id")).toHaveClass("database-table-browser__cell--number");
    expect(screen.queryByLabelText("编辑 name")).not.toBeInTheDocument();

    await userEvent.dblClick(screen.getByText("Alice"));

    const editor = screen.getByLabelText("编辑 name");
    expect(editor).toHaveValue("Alice");
    expect(editor.closest("td")).toHaveClass("database-table-browser__cell--editing");
    expect(selectSpy).toHaveBeenCalled();
    selectSpy.mockRestore();
  });

  it("renders null cells as muted placeholders and edits them as empty values", async () => {
    callBackendMock.mockImplementation((command, payload) => {
      if (command === "list_database_objects") {
        const request = (payload as { request: { parent_kind?: string } }).request;
        if (!request.parent_kind) {
          return Promise.resolve([{ id: "database:app", name: "app", kind: "database", has_children: true }]);
        }
        return Promise.resolve([{ id: "table:app.users", name: "users", kind: "table", has_children: true }]);
      }
      if (command === "load_database_table_page") {
        return Promise.resolve({
          columns: [
            { name: "id", data_type: "INT", nullable: false, has_default: false, generated: true },
            { name: "name", data_type: "VARCHAR", nullable: true, has_default: false, generated: false },
          ],
          rows: [[{ kind: "number", value: "1" }, { kind: "null" }]],
          total_rows: 1,
          page: 1,
          page_size: 200,
          duration_ms: 9,
          primary_key_columns: ["id"],
          editable: true,
        });
      }
      return Promise.resolve([]);
    });

    renderDatabaseWorkspace("app");
    await userEvent.dblClick(await screen.findByText("users"));

    const nullPlaceholder = await screen.findByText("null");
    expect(nullPlaceholder).toHaveClass("database-table-browser__cell-placeholder");
    expect(nullPlaceholder.closest("td")).toHaveClass("database-table-browser__cell--null");

    await userEvent.dblClick(nullPlaceholder);

    expect(screen.getByLabelText("编辑 name")).toHaveValue("");
  });

  it("commits typed text when a null cell editor loses focus after clicking another cell", async () => {
    callBackendMock.mockImplementation((command, payload) => {
      if (command === "list_database_objects") {
        const request = (payload as { request: { parent_kind?: string } }).request;
        if (!request.parent_kind) {
          return Promise.resolve([{ id: "database:app", name: "app", kind: "database", has_children: true }]);
        }
        return Promise.resolve([{ id: "table:app.users", name: "users", kind: "table", has_children: true }]);
      }
      if (command === "load_database_table_page") {
        return Promise.resolve({
          columns: [
            { name: "id", data_type: "INT", nullable: false, has_default: false, generated: true },
            { name: "name", data_type: "VARCHAR", nullable: true, has_default: false, generated: false },
          ],
          rows: [[{ kind: "number", value: "1" }, { kind: "null" }]],
          total_rows: 1,
          page: 1,
          page_size: 200,
          duration_ms: 9,
          primary_key_columns: ["id"],
          editable: true,
        });
      }
      return Promise.resolve([]);
    });

    renderDatabaseWorkspace("app");
    await userEvent.dblClick(await screen.findByText("users"));

    await userEvent.dblClick(await screen.findByText("null"));
    await userEvent.type(screen.getByLabelText("编辑 name"), "Alice");
    expect(screen.getByLabelText("编辑 name")).toHaveValue("Alice");
    await userEvent.click(screen.getByLabelText("第 1 行 id"));

    await waitFor(() => {
      expect(screen.getByLabelText("第 1 行 name")).toHaveTextContent("Alice");
      expect(screen.getByLabelText("第 1 行 name")).toHaveClass("database-table-browser__cell--dirty");
    });
  });

  it("shows default, null and generated placeholders for new rows", async () => {
    callBackendMock.mockImplementation((command, payload) => {
      if (command === "list_database_objects") {
        const request = (payload as { request: { parent_kind?: string } }).request;
        if (!request.parent_kind) {
          return Promise.resolve([{ id: "database:app", name: "app", kind: "database", has_children: true }]);
        }
        return Promise.resolve([{ id: "table:app.users", name: "users", kind: "table", has_children: true }]);
      }
      if (command === "load_database_table_page") {
        return Promise.resolve({
          columns: [
            { name: "id", data_type: "INT", nullable: false, has_default: false, generated: true },
            { name: "name", data_type: "VARCHAR", nullable: false, has_default: true, generated: false },
            { name: "remark", data_type: "VARCHAR", nullable: true, has_default: false, generated: false },
          ],
          rows: [],
          total_rows: 0,
          page: 1,
          page_size: 200,
          duration_ms: 9,
          primary_key_columns: ["id"],
          editable: true,
        });
      }
      return Promise.resolve([]);
    });

    renderDatabaseWorkspace("app");
    await userEvent.dblClick(await screen.findByText("users"));
    await userEvent.click(await screen.findByRole("button", { name: "添加行" }));

    expect(screen.getByText("<generated>")).toHaveClass("database-table-browser__cell-placeholder");
    expect(screen.getByText("<default>")).toHaveClass("database-table-browser__cell-placeholder");
    expect(screen.getByText("<null>")).toHaveClass("database-table-browser__cell-placeholder");
    expect(screen.getByText("<generated>").closest("tr")).toHaveClass("database-table-browser__row--new");
  });

  it("copies table browser cell, row and column name from the cell context menu", async () => {
    callBackendMock.mockImplementation((command, payload) => {
      if (command === "list_database_objects") {
        const request = (payload as { request: { parent_kind?: string } }).request;
        if (!request.parent_kind) {
          return Promise.resolve([{ id: "database:app", name: "app", kind: "database", has_children: true }]);
        }
        return Promise.resolve([{ id: "table:app.users", name: "users", kind: "table", has_children: true }]);
      }
      if (command === "load_database_table_page") {
        return Promise.resolve({
          columns: [
            { name: "id", data_type: "INT" },
            { name: "name", data_type: "VARCHAR" },
          ],
          rows: [[{ kind: "number", value: "1" }, { kind: "text", value: "Alice" }]],
          total_rows: 1,
          page: 1,
          page_size: 200,
          duration_ms: 9,
          primary_key_columns: ["id"],
          editable: true,
        });
      }
      return Promise.resolve([]);
    });

    renderDatabaseWorkspace("app");
    await userEvent.dblClick(await screen.findByText("users"));
    await screen.findByLabelText("表数据");
    const cell = screen.getByText("Alice").closest("td");
    expect(cell).not.toBeNull();

    fireEvent.contextMenu(cell!, { clientX: 10, clientY: 20 });
    expect(within(screen.getByRole("menu")).getAllByRole("menuitem").map((item) => item.textContent)).toEqual([
      "复制单元格",
      "复制选中",
      "复制整行",
      "复制列名",
      "删除行",
    ]);
    await userEvent.click(screen.getByRole("menuitem", { name: "复制单元格" }));
    expect(writeClipboardTextMock).toHaveBeenCalledWith("Alice");

    fireEvent.contextMenu(cell!, { clientX: 10, clientY: 20 });
    await userEvent.click(screen.getByRole("menuitem", { name: "复制整行" }));
    expect(writeClipboardTextMock).toHaveBeenCalledWith("1\tAlice");

    fireEvent.contextMenu(cell!, { clientX: 10, clientY: 20 });
    await userEvent.click(screen.getByRole("menuitem", { name: "复制列名" }));
    expect(writeClipboardTextMock).toHaveBeenCalledWith("name");
  });

  it("selects table cells by dragging and copies the selected range", async () => {
    callBackendMock.mockImplementation((command, payload) => {
      if (command === "list_database_objects") {
        const request = (payload as { request: { parent_kind?: string } }).request;
        if (!request.parent_kind) {
          return Promise.resolve([{ id: "database:app", name: "app", kind: "database", has_children: true }]);
        }
        return Promise.resolve([{ id: "table:app.users", name: "users", kind: "table", has_children: true }]);
      }
      if (command === "load_database_table_page") {
        return Promise.resolve({
          columns: [
            { name: "id", data_type: "INT" },
            { name: "name", data_type: "VARCHAR" },
            { name: "amount", data_type: "DECIMAL" },
          ],
          rows: [
            [{ kind: "number", value: "1" }, { kind: "text", value: "Alice" }, { kind: "number", value: "12.34" }],
            [{ kind: "number", value: "2" }, { kind: "text", value: "Bob" }, { kind: "number", value: "56.78" }],
          ],
          total_rows: 2,
          page: 1,
          page_size: 200,
          duration_ms: 9,
          primary_key_columns: ["id"],
          editable: true,
        });
      }
      return Promise.resolve([]);
    });

    renderDatabaseWorkspace("app");
    await userEvent.dblClick(await screen.findByText("users"));
    await screen.findByLabelText("表数据");
    const startCell = screen.getByText("Alice").closest("td");
    const endCell = screen.getByText("56.78").closest("td");
    expect(startCell).not.toBeNull();
    expect(endCell).not.toBeNull();

    fireEvent.mouseDown(startCell!, { button: 0 });
    fireEvent.mouseEnter(endCell!);
    fireEvent.mouseUp(endCell!);

    expect(startCell).toHaveClass("database-table-browser__cell--range-selected");
    expect(endCell).toHaveClass("database-table-browser__cell--range-selected");

    fireEvent.contextMenu(endCell!, { clientX: 10, clientY: 20 });
    expect(within(screen.getByRole("menu")).getAllByRole("menuitem").map((item) => item.textContent)).toEqual([
      "复制单元格",
      "复制选中",
      "复制整行",
      "复制列名",
      "删除行",
    ]);
    await userEvent.click(screen.getByRole("menuitem", { name: "复制选中" }));
    expect(writeClipboardTextMock).toHaveBeenCalledWith("Alice\t12.34\nBob\t56.78");
    writeClipboardTextMock.mockClear();

    fireEvent.keyDown(window, { key: "c", code: "KeyC", ctrlKey: true });

    expect(writeClipboardTextMock).toHaveBeenCalledWith("Alice\t12.34\nBob\t56.78");
  });

  it("supports keyboard navigation and editing for selected table cells", async () => {
    callBackendMock.mockImplementation((command, payload) => {
      if (command === "list_database_objects") {
        const request = (payload as { request: { parent_kind?: string } }).request;
        if (!request.parent_kind) {
          return Promise.resolve([{ id: "database:app", name: "app", kind: "database", has_children: true }]);
        }
        return Promise.resolve([{ id: "table:app.users", name: "users", kind: "table", has_children: true }]);
      }
      if (command === "load_database_table_page") {
        return Promise.resolve({
          columns: [
            { name: "id", data_type: "INT" },
            { name: "name", data_type: "VARCHAR" },
            { name: "amount", data_type: "DECIMAL" },
          ],
          rows: [
            [{ kind: "number", value: "1" }, { kind: "text", value: "Alice" }, { kind: "number", value: "12.34" }],
            [{ kind: "number", value: "2" }, { kind: "text", value: "Bob" }, { kind: "number", value: "56.78" }],
          ],
          total_rows: 2,
          page: 1,
          page_size: 200,
          duration_ms: 9,
          primary_key_columns: ["id"],
          editable: true,
        });
      }
      return Promise.resolve([]);
    });

    renderDatabaseWorkspace("app");
    await userEvent.dblClick(await screen.findByText("users"));
    await screen.findByLabelText("表数据");

    await userEvent.click(screen.getByText("Alice"));
    expect(screen.getByLabelText("第 1 行 name")).toHaveFocus();
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(screen.getByLabelText("第 1 行 amount")).toHaveClass("database-table-browser__cell--selected");

    fireEvent.keyDown(window, { key: "ArrowDown" });
    expect(screen.getByLabelText("第 2 行 amount")).toHaveClass("database-table-browser__cell--selected");

    fireEvent.keyDown(window, { key: "Tab" });
    expect(screen.getByLabelText("第 2 行 amount")).toHaveClass("database-table-browser__cell--selected");

    fireEvent.keyDown(window, { key: "ArrowLeft" });
    expect(screen.getByLabelText("第 2 行 name")).toHaveClass("database-table-browser__cell--selected");

    fireEvent.keyDown(window, { key: "Enter" });
    expect(screen.getByLabelText("编辑 name")).toHaveValue("Bob");

    fireEvent.keyDown(screen.getByLabelText("编辑 name"), { key: "Escape" });
    expect(screen.queryByLabelText("编辑 name")).not.toBeInTheDocument();

    fireEvent.keyDown(window, { key: "F2" });
    expect(screen.getByLabelText("编辑 name")).toHaveValue("Bob");
  });

  it("moves selected table cells after the SQL editor previously had focus", async () => {
    callBackendMock.mockImplementation((command, payload) => {
      if (command === "list_database_objects") {
        const request = (payload as { request: { parent_kind?: string } }).request;
        if (!request.parent_kind) {
          return Promise.resolve([{ id: "database:app", name: "app", kind: "database", has_children: true }]);
        }
        return Promise.resolve([{ id: "table:app.users", name: "users", kind: "table", has_children: true }]);
      }
      if (command === "load_database_table_page") {
        return Promise.resolve({
          columns: [
            { name: "id", data_type: "INT" },
            { name: "name", data_type: "VARCHAR" },
          ],
          rows: [[{ kind: "number", value: "1" }, { kind: "text", value: "Alice" }]],
          total_rows: 1,
          page: 1,
          page_size: 200,
          duration_ms: 9,
          primary_key_columns: ["id"],
          editable: true,
        });
      }
      return Promise.resolve([]);
    });

    renderDatabaseWorkspace("app");
    await userEvent.dblClick(await screen.findByText("users"));
    await userEvent.click(screen.getByTestId("database-monaco-editor"));
    expect(screen.getByTestId("database-monaco-editor")).toHaveFocus();

    await userEvent.click(await screen.findByText("Alice"));
    expect(screen.getByLabelText("第 1 行 name")).toHaveFocus();

    fireEvent.keyDown(screen.getByLabelText("第 1 行 name"), { key: "ArrowLeft" });

    expect(screen.getByLabelText("第 1 行 id")).toHaveClass("database-table-browser__cell--selected");
  });

  it("does not edit the selected table cell when Enter is pressed after focusing the SQL editor", async () => {
    callBackendMock.mockImplementation((command, payload) => {
      if (command === "list_database_objects") {
        const request = (payload as { request: { parent_kind?: string } }).request;
        if (!request.parent_kind) {
          return Promise.resolve([{ id: "database:app", name: "app", kind: "database", has_children: true }]);
        }
        return Promise.resolve([{ id: "table:app.users", name: "users", kind: "table", has_children: true }]);
      }
      if (command === "load_database_table_page") {
        return Promise.resolve({
          columns: [
            { name: "id", data_type: "INT" },
            { name: "name", data_type: "VARCHAR" },
          ],
          rows: [[{ kind: "number", value: "1" }, { kind: "text", value: "Alice" }]],
          total_rows: 1,
          page: 1,
          page_size: 200,
          duration_ms: 9,
          primary_key_columns: ["id"],
          editable: true,
        });
      }
      return Promise.resolve([]);
    });

    renderDatabaseWorkspace("app");
    await userEvent.dblClick(await screen.findByText("users"));
    await userEvent.click(await screen.findByText("Alice"));
    expect(screen.getByLabelText("第 1 行 name")).toHaveClass("database-table-browser__cell--selected");

    await userEvent.click(screen.getByTestId("database-monaco-editor"));
    expect(screen.getByTestId("database-monaco-editor")).toHaveFocus();
    fireEvent.keyDown(window, { key: "Enter" });

    expect(screen.queryByLabelText("编辑 name")).not.toBeInTheDocument();
  });

  it("clears selected editable table cells with Delete", async () => {
    callBackendMock.mockImplementation((command, payload) => {
      if (command === "list_database_objects") {
        const request = (payload as { request: { parent_kind?: string } }).request;
        if (!request.parent_kind) {
          return Promise.resolve([{ id: "database:app", name: "app", kind: "database", has_children: true }]);
        }
        return Promise.resolve([{ id: "table:app.users", name: "users", kind: "table", has_children: true }]);
      }
      if (command === "load_database_table_page") {
        return Promise.resolve({
          columns: [
            { name: "id", data_type: "INT" },
            { name: "name", data_type: "VARCHAR" },
          ],
          rows: [[{ kind: "number", value: "1" }, { kind: "text", value: "Alice" }]],
          total_rows: 1,
          page: 1,
          page_size: 200,
          duration_ms: 9,
          primary_key_columns: ["id"],
          editable: true,
        });
      }
      return Promise.resolve([]);
    });

    renderDatabaseWorkspace("app");
    await userEvent.dblClick(await screen.findByText("users"));
    await screen.findByLabelText("表数据");

    await userEvent.click(screen.getByText("Alice"));
    fireEvent.keyDown(window, { key: "Delete" });

    expect(screen.getByLabelText("第 1 行 name")).toHaveClass("database-table-browser__cell--dirty");
    expect(screen.getByText("未保存 1 行 / 1 字段")).toBeInTheDocument();
    expect(screen.getByLabelText("第 1 行 name")).toHaveTextContent("");

    fireEvent.keyDown(window, { key: "ArrowLeft" });
    fireEvent.keyDown(window, { key: "Delete" });

    expect(screen.getByLabelText("第 1 行 id")).not.toHaveClass("database-table-browser__cell--dirty");
  });

  it("pastes tabular clipboard text into editable cells from the selected cell", async () => {
    readClipboardTextMock.mockResolvedValue("Carol\t90.5\nDave\t91.5");
    callBackendMock.mockImplementation((command, payload) => {
      if (command === "list_database_objects") {
        const request = (payload as { request: { parent_kind?: string } }).request;
        if (!request.parent_kind) {
          return Promise.resolve([{ id: "database:app", name: "app", kind: "database", has_children: true }]);
        }
        return Promise.resolve([{ id: "table:app.users", name: "users", kind: "table", has_children: true }]);
      }
      if (command === "load_database_table_page") {
        return Promise.resolve({
          columns: [
            { name: "id", data_type: "INT" },
            { name: "name", data_type: "VARCHAR" },
            { name: "amount", data_type: "DECIMAL" },
          ],
          rows: [
            [{ kind: "number", value: "1" }, { kind: "text", value: "Alice" }, { kind: "number", value: "12.34" }],
            [{ kind: "number", value: "2" }, { kind: "text", value: "Bob" }, { kind: "number", value: "56.78" }],
          ],
          total_rows: 2,
          page: 1,
          page_size: 200,
          duration_ms: 9,
          primary_key_columns: ["id"],
          editable: true,
        });
      }
      return Promise.resolve([]);
    });

    renderDatabaseWorkspace("app");
    await userEvent.dblClick(await screen.findByText("users"));
    await screen.findByLabelText("表数据");

    await userEvent.click(screen.getByText("Alice"));
    fireEvent.keyDown(window, { key: "v", code: "KeyV", ctrlKey: true });

    await waitFor(() => {
      expect(readClipboardTextMock).toHaveBeenCalledTimes(1);
      expect(screen.getByText("未保存 2 行 / 4 字段")).toBeInTheDocument();
    });
    expect(screen.getByLabelText("第 1 行 name")).toHaveTextContent("Carol");
    expect(screen.getByLabelText("第 1 行 amount")).toHaveTextContent("90.5");
    expect(screen.getByLabelText("第 2 行 name")).toHaveTextContent("Dave");
    expect(screen.getByLabelText("第 2 行 amount")).toHaveTextContent("91.5");
    expect(screen.getByLabelText("第 1 行 id")).toHaveTextContent("1");
    expect(screen.getByLabelText("第 1 行 id")).not.toHaveClass("database-table-browser__cell--dirty");
  });

  it("adds a table row and saves it through the table browser toolbar", async () => {
    callBackendMock.mockImplementation((command, payload) => {
      if (command === "list_database_objects") {
        const request = (payload as { request: { parent_kind?: string } }).request;
        if (!request.parent_kind) {
          return Promise.resolve([{ id: "database:app", name: "app", kind: "database", has_children: true }]);
        }
        return Promise.resolve([{ id: "table:app.users", name: "users", kind: "table", has_children: true }]);
      }
      if (command === "load_database_table_page") {
        return Promise.resolve({
          columns: [
            { name: "id", data_type: "INT" },
            { name: "name", data_type: "VARCHAR" },
          ],
          rows: [[{ kind: "number", value: "1" }, { kind: "text", value: "Alice" }]],
          total_rows: 1,
          page: 1,
          page_size: 200,
          duration_ms: 9,
          primary_key_columns: ["id"],
          editable: true,
        });
      }
      if (command === "insert_database_table_rows") {
        return Promise.resolve({ updated_rows: 1, updated_fields: 2, duration_ms: 4 });
      }
      return Promise.resolve([]);
    });

    renderDatabaseWorkspace("app");
    await userEvent.dblClick(await screen.findByText("users"));
    await userEvent.click(await screen.findByRole("button", { name: "添加行" }));
    await userEvent.dblClick(screen.getByLabelText("第 2 行 id"));
    await userEvent.type(screen.getByLabelText("编辑 id"), "2{Enter}");
    await userEvent.dblClick(screen.getByLabelText("第 2 行 name"));
    await userEvent.type(screen.getByLabelText("编辑 name"), "Bob{Enter}");
    await userEvent.click(screen.getByRole("button", { name: "保存更改" }));
    await userEvent.click(screen.getByRole("button", { name: "确认" }));

    await waitFor(() => {
      expect(callBackendMock).toHaveBeenCalledWith("insert_database_table_rows", {
        request: {
          connection_id: "mysql-dev",
          database: "app",
          table: "users",
          rows: [{
            values: {
              id: { kind: "text", value: "2" },
              name: { kind: "text", value: "Bob" },
            },
          }],
        },
      });
    });
  });

  it("renders table export actions in the table browser toolbar", async () => {
    callBackendMock.mockImplementation((command, payload) => {
      if (command === "list_database_objects") {
        const request = (payload as { request: { parent_kind?: string } }).request;
        if (!request.parent_kind) {
          return Promise.resolve([{ id: "database:app", name: "app", kind: "database", has_children: true }]);
        }
        return Promise.resolve([{ id: "table:app.users", name: "users", kind: "table", has_children: true }]);
      }
      if (command === "load_database_table_page") {
        return Promise.resolve({
          columns: [{ name: "id", data_type: "INT" }],
          rows: [[{ kind: "number", value: "1" }]],
          total_rows: 1,
          page: 1,
          page_size: 200,
          duration_ms: 9,
          primary_key_columns: ["id"],
          editable: true,
        });
      }
      return Promise.resolve([]);
    });

    renderDatabaseWorkspace("app");
    await userEvent.dblClick(await screen.findByText("users"));

    const tableLabel = await screen.findByText("表 users");
    const toolbar = tableLabel.closest(".database-table-browser__toolbar");

    expect(toolbar).not.toBeNull();
    expect(within(toolbar as HTMLElement).getByRole("button", { name: "导出" })).toBeInTheDocument();
    expect(document.querySelector(".database-table-browser__grid-actions")).not.toBeInTheDocument();
  });

  it("omits empty new row fields so database defaults can apply", async () => {
    callBackendMock.mockImplementation((command, payload) => {
      if (command === "list_database_objects") {
        const request = (payload as { request: { parent_kind?: string } }).request;
        if (!request.parent_kind) {
          return Promise.resolve([{ id: "database:app", name: "app", kind: "database", has_children: true }]);
        }
        return Promise.resolve([{ id: "table:app.users", name: "users", kind: "table", has_children: true }]);
      }
      if (command === "load_database_table_page") {
        return Promise.resolve({
          columns: [
            { name: "id", data_type: "INT" },
            { name: "name", data_type: "VARCHAR" },
            { name: "create_time", data_type: "DATETIME" },
          ],
          rows: [],
          total_rows: 0,
          page: 1,
          page_size: 200,
          duration_ms: 9,
          primary_key_columns: ["id"],
          editable: true,
        });
      }
      if (command === "insert_database_table_rows") {
        return Promise.resolve({ updated_rows: 1, updated_fields: 2, duration_ms: 4 });
      }
      return Promise.resolve([]);
    });

    renderDatabaseWorkspace("app");
    await userEvent.dblClick(await screen.findByText("users"));
    await userEvent.click(await screen.findByRole("button", { name: "添加行" }));
    await userEvent.dblClick(screen.getByLabelText("第 1 行 id"));
    await userEvent.type(screen.getByLabelText("编辑 id"), "2{Enter}");
    await userEvent.dblClick(screen.getByLabelText("第 1 行 name"));
    await userEvent.type(screen.getByLabelText("编辑 name"), "Bob{Enter}");
    await userEvent.click(screen.getByRole("button", { name: "保存更改" }));
    await userEvent.click(screen.getByRole("button", { name: "确认" }));

    await waitFor(() => {
      expect(callBackendMock).toHaveBeenCalledWith("insert_database_table_rows", {
        request: {
          connection_id: "mysql-dev",
          database: "app",
          table: "users",
          rows: [{
            values: {
              id: { kind: "text", value: "2" },
              name: { kind: "text", value: "Bob" },
            },
          }],
        },
      });
    });
  });

  it("deletes a table row from the cell context menu after confirmation", async () => {
    callBackendMock.mockImplementation((command, payload) => {
      if (command === "list_database_objects") {
        const request = (payload as { request: { parent_kind?: string } }).request;
        if (!request.parent_kind) {
          return Promise.resolve([{ id: "database:app", name: "app", kind: "database", has_children: true }]);
        }
        return Promise.resolve([{ id: "table:app.users", name: "users", kind: "table", has_children: true }]);
      }
      if (command === "load_database_table_page") {
        return Promise.resolve({
          columns: [
            { name: "id", data_type: "INT" },
            { name: "name", data_type: "VARCHAR" },
          ],
          rows: [[{ kind: "number", value: "1" }, { kind: "text", value: "Alice" }]],
          total_rows: 1,
          page: 1,
          page_size: 200,
          duration_ms: 9,
          primary_key_columns: ["id"],
          editable: true,
        });
      }
      if (command === "delete_database_table_rows") {
        return Promise.resolve({ updated_rows: 1, updated_fields: 0, duration_ms: 5 });
      }
      return Promise.resolve([]);
    });

    renderDatabaseWorkspace("app");
    await userEvent.dblClick(await screen.findByText("users"));
    await screen.findByLabelText("表数据");
    const cell = screen.getByText("Alice").closest("td");
    expect(cell).not.toBeNull();

    fireEvent.contextMenu(cell!, { clientX: 10, clientY: 20 });
    await userEvent.click(screen.getByRole("menuitem", { name: "删除行" }));
    expect(screen.getByText("确认删除当前行？")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "确认" }));

    await waitFor(() => {
      expect(callBackendMock).toHaveBeenCalledWith("delete_database_table_rows", {
        request: {
          connection_id: "mysql-dev",
          database: "app",
          table: "users",
          primary_key_columns: ["id"],
          rows: [{
            primary_key_values: {
              id: { kind: "number", value: "1" },
            },
          }],
        },
      });
    });
  });

  it("does not mark a cell dirty when the edited value is unchanged", async () => {
    callBackendMock.mockImplementation((command, payload) => {
      if (command === "list_database_objects") {
        const request = (payload as { request: { parent_kind?: string } }).request;
        if (!request.parent_kind) {
          return Promise.resolve([{ id: "database:app", name: "app", kind: "database", has_children: true }]);
        }
        return Promise.resolve([{ id: "table:app.users", name: "users", kind: "table", has_children: true }]);
      }
      if (command === "load_database_table_page") {
        return Promise.resolve({
          columns: [
            { name: "id", data_type: "INT" },
            { name: "name", data_type: "VARCHAR" },
          ],
          rows: [[{ kind: "number", value: "1" }, { kind: "text", value: "Alice" }]],
          total_rows: 1,
          page: 1,
          page_size: 200,
          duration_ms: 9,
          primary_key_columns: ["id"],
          editable: true,
        });
      }
      return Promise.resolve([]);
    });

    renderDatabaseWorkspace("app");
    await userEvent.dblClick(await screen.findByText("users"));
    await screen.findByLabelText("表数据");

    await userEvent.dblClick(screen.getByText("Alice"));
    await userEvent.type(screen.getByLabelText("编辑 name"), "{Enter}");

    expect(screen.queryByText("未保存 1 行 / 1 字段")).not.toBeInTheDocument();
    expect(screen.getByText("Alice").closest("td")).not.toHaveClass("database-table-browser__cell--dirty");
  });

  it("closes the table page size menu when clicking outside", async () => {
    callBackendMock.mockImplementation((command, payload) => {
      if (command === "list_database_objects") {
        const request = (payload as { request: { parent_kind?: string } }).request;
        if (!request.parent_kind) {
          return Promise.resolve([{ id: "database:app", name: "app", kind: "database", has_children: true }]);
        }
        return Promise.resolve([{ id: "table:app.users", name: "users", kind: "table", has_children: true }]);
      }
      if (command === "load_database_table_page") {
        return Promise.resolve({
          columns: [{ name: "id", data_type: "INT" }],
          rows: [[{ kind: "number", value: "1" }]],
          total_rows: 501,
          page: 1,
          page_size: 200,
          duration_ms: 9,
          primary_key_columns: ["id"],
          editable: true,
        });
      }
      return Promise.resolve([]);
    });

    renderDatabaseWorkspace("app");
    await userEvent.dblClick(await screen.findByText("users"));
    await userEvent.click(await screen.findByRole("button", { name: "每页" }));
    expect(screen.getByRole("menu", { name: "Page Size" })).toBeInTheDocument();

    await userEvent.click(screen.getByText("表 users"));

    expect(screen.queryByRole("menu", { name: "Page Size" })).not.toBeInTheDocument();
  });

  it("confirms and saves edited table cells", async () => {
    callBackendMock.mockImplementation((command, payload) => {
      if (command === "list_database_objects") {
        const request = (payload as { request: { parent_kind?: string } }).request;
        if (!request.parent_kind) {
          return Promise.resolve([{ id: "database:app", name: "app", kind: "database", has_children: true }]);
        }
        return Promise.resolve([{ id: "table:app.users", name: "users", kind: "table", has_children: true }]);
      }
      if (command === "load_database_table_page") {
        return Promise.resolve({
          columns: [
            { name: "id", data_type: "INT" },
            { name: "name", data_type: "VARCHAR" },
          ],
          rows: [[{ kind: "number", value: "1" }, { kind: "text", value: "Alice" }]],
          total_rows: 1,
          page: 1,
          page_size: 200,
          duration_ms: 9,
          primary_key_columns: ["id"],
          editable: true,
        });
      }
      if (command === "update_database_table_rows") {
        return Promise.resolve({ updated_rows: 1, updated_fields: 1, duration_ms: 6 });
      }
      return Promise.resolve([]);
    });

    renderDatabaseWorkspace("app");
    await userEvent.dblClick(await screen.findByText("users"));
    await userEvent.dblClick(await screen.findByText("Alice"));
    await userEvent.clear(screen.getByLabelText("编辑 name"));
    await userEvent.type(screen.getByLabelText("编辑 name"), "Bob{Enter}");

    await userEvent.click(screen.getByRole("button", { name: "保存更改" }));
    expect(screen.getByText("确认保存 1 行 1 个字段的更改？")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "确认" }));

    await waitFor(() => {
      expect(callBackendMock).toHaveBeenCalledWith("update_database_table_rows", {
        request: {
          connection_id: "mysql-dev",
          database: "app",
          table: "users",
          primary_key_columns: ["id"],
          rows: [{
            primary_key_values: { id: { kind: "number", value: "1" } },
            changes: { name: { kind: "text", value: "Bob" } },
          }],
        },
      });
    });
  });

  it("confirms before discarding edited table cells during refresh", async () => {
    callBackendMock.mockImplementation((command, payload) => {
      if (command === "list_database_objects") {
        const request = (payload as { request: { parent_kind?: string } }).request;
        if (!request.parent_kind) {
          return Promise.resolve([{ id: "database:app", name: "app", kind: "database", has_children: true }]);
        }
        return Promise.resolve([{ id: "table:app.users", name: "users", kind: "table", has_children: true }]);
      }
      if (command === "load_database_table_page") {
        return Promise.resolve({
          columns: [
            { name: "id", data_type: "INT" },
            { name: "name", data_type: "VARCHAR" },
          ],
          rows: [[{ kind: "number", value: "1" }, { kind: "text", value: "Alice" }]],
          total_rows: 1,
          page: 1,
          page_size: 200,
          duration_ms: 9,
          primary_key_columns: ["id"],
          editable: true,
        });
      }
      return Promise.resolve([]);
    });

    renderDatabaseWorkspace("app");
    await userEvent.dblClick(await screen.findByText("users"));
    await userEvent.dblClick(await screen.findByText("Alice"));
    await userEvent.clear(screen.getByLabelText("编辑 name"));
    await userEvent.type(screen.getByLabelText("编辑 name"), "Bob{Enter}");
    callBackendMock.mockClear();

    await userEvent.click(screen.getByRole("button", { name: "刷新" }));

    expect(screen.getByText("当前有未保存更改，继续操作会放弃这些更改。")).toBeInTheDocument();
    expect(callBackendMock).not.toHaveBeenCalledWith("load_database_table_page", expect.anything());

    await userEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(screen.getByText("未保存 1 行 / 1 字段")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "刷新" }));
    await userEvent.click(screen.getByRole("button", { name: "确认" }));

    await waitFor(() => {
      expect(callBackendMock).toHaveBeenCalledWith("load_database_table_page", expect.anything());
    });
  });

  it("switches from table browser back to query result after running selected SQL", async () => {
    callBackendMock.mockImplementation((command, payload) => {
      if (command === "list_database_objects") {
        const request = (payload as { request: { parent_kind?: string } }).request;
        if (!request.parent_kind) {
          return Promise.resolve([{ id: "database:app", name: "app", kind: "database", has_children: true }]);
        }
        return Promise.resolve([{ id: "table:app.users", name: "users", kind: "table", has_children: true }]);
      }
      if (command === "load_database_table_page") {
        return Promise.resolve({
          columns: [{ name: "id", data_type: "INT" }],
          rows: [[{ kind: "number", value: "1" }]],
          total_rows: 1,
          page: 1,
          page_size: 200,
          duration_ms: 9,
          primary_key_columns: ["id"],
          editable: true,
        });
      }
      if (command === "execute_database_query") {
        return Promise.resolve({
          columns: [{ name: "count(1)", data_type: "BIGINT" }],
          rows: [[{ kind: "number", value: "1" }]],
          affected_rows: 0,
          duration_ms: 4,
          limited: false,
        });
      }
      return Promise.resolve([]);
    });

    renderDatabaseWorkspace("app");

    await userEvent.dblClick(await screen.findByText("users"));
    expect(await screen.findByLabelText("表数据")).toBeInTheDocument();

    setSelectedSqlText("select count(1) from users");
    await executeSelectedSqlFromContextMenu(screen.getByLabelText("SQL 编辑器"));

    expect(await screen.findByText("1 行，耗时 4 ms")).toBeInTheDocument();
    expect(screen.queryByLabelText("表数据")).not.toBeInTheDocument();
  });

  it("loads SQL files for the selected database and switches editor content", async () => {
    callBackendMock.mockImplementation((command) => {
      if (command === "list_database_sql_files") {
        return Promise.resolve([
          { name: "z-report", content: "select * from z" },
          { name: "default", content: "select * from users" },
          { name: "report", content: "select count(*) from users" },
        ]);
      }
      return Promise.resolve([]);
    });

    renderDatabaseWorkspace("app");

    expect(callBackendMock).toHaveBeenCalledWith("list_database_sql_files", {
      request: {
        connection_id: "mysql-dev",
        database: "app",
      },
    });
    expect(await screen.findByLabelText("SQL 编辑器")).toHaveValue("select * from users");
    expect(within(screen.getByLabelText("SQL 文件")).getAllByRole("option").map((option) => option.textContent)).toEqual([
      "新增 SQL 文件",
      "default",
      "report",
      "z-report",
    ]);

    await userEvent.selectOptions(screen.getByLabelText("SQL 文件"), "report");

    expect(screen.getByLabelText("SQL 编辑器")).toHaveValue("select count(*) from users");
  });

  it("deduplicates SQL file loading and does not save immediately in strict mode", async () => {
    callBackendMock.mockImplementation((command) => {
      if (command === "list_database_sql_files") {
        return Promise.resolve([{ name: "default", content: "select * from users" }]);
      }
      if (command === "save_database_sql_file") return Promise.resolve(undefined);
      return Promise.resolve([]);
    });

    renderDatabaseWorkspaceInStrictMode("app");

    expect(await screen.findByLabelText("SQL 编辑器")).toHaveValue("select * from users");
    await waitFor(() => {
      expect(callBackendMock.mock.calls.filter(([command]) => command === "list_database_sql_files")).toHaveLength(1);
    });
    await new Promise((resolve) => window.setTimeout(resolve, 650));
    expect(callBackendMock.mock.calls.filter(([command]) => command === "save_database_sql_file")).toHaveLength(0);
  });

  it("keeps edited SQL file content when switching files before debounce save", async () => {
    callBackendMock.mockImplementation((command) => {
      if (command === "list_database_sql_files") {
        return Promise.resolve([
          { name: "default", content: "select 1" },
          { name: "report", content: "select 2" },
        ]);
      }
      return Promise.resolve([]);
    });

    renderDatabaseWorkspace("app");

    const editor = await screen.findByLabelText("SQL 编辑器");
    expect(editor).toHaveValue("select 1");

    await userEvent.clear(editor);
    await userEvent.type(editor, "select 1 modified");
    await userEvent.selectOptions(screen.getByLabelText("SQL 文件"), "report");

    expect(screen.getByLabelText("SQL 编辑器")).toHaveValue("select 2");
    await waitFor(() => {
      expect(callBackendMock).toHaveBeenCalledWith("save_database_sql_file", {
        request: {
          connection_id: "mysql-dev",
          database: "app",
          name: "default",
          content: "select 1 modified",
        },
      });
    });

    await userEvent.selectOptions(screen.getByLabelText("SQL 文件"), "default");

    expect(screen.getByLabelText("SQL 编辑器")).toHaveValue("select 1 modified");
  });

  it("creates a SQL file from the selector dialog and cancels it with Escape", async () => {
    callBackendMock.mockImplementation((command) => {
      if (command === "list_database_sql_files") {
        return Promise.resolve([{ name: "default", content: "" }]);
      }
      return Promise.resolve([]);
    });

    renderDatabaseWorkspace("app");

    await userEvent.selectOptions(await screen.findByLabelText("SQL 文件"), "__create_sql_file__");
    const createDialog = screen.getByRole("dialog", { name: "新增 SQL 文件" });
    expect(createDialog).toBeInTheDocument();
    expect(createDialog).toHaveClass("database-dialog", "database-sql-file-dialog");
    expect(createDialog.querySelector(".database-dialog__header")).toBeInTheDocument();
    expect(createDialog.querySelector(".database-dialog__actions")).toBeInTheDocument();

    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "新增 SQL 文件" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("SQL 文件")).toHaveValue("default");

    await userEvent.selectOptions(screen.getByLabelText("SQL 文件"), "__create_sql_file__");
    await userEvent.type(screen.getByLabelText("SQL 文件名"), "daily");
    await userEvent.click(screen.getByRole("button", { name: "确认" }));

    await waitFor(() => {
      expect(callBackendMock).toHaveBeenCalledWith("save_database_sql_file", {
        request: {
          connection_id: "mysql-dev",
          database: "app",
          name: "daily",
          content: "",
        },
      });
    });
    expect(screen.getByLabelText("SQL 文件")).toHaveValue("daily");
    expect(screen.getByLabelText("SQL 编辑器")).toHaveValue("");
  });

  it("toggles the SQL editor visibility", async () => {
    renderDatabaseWorkspace("app");

    expect(screen.getByTestId("database-monaco-editor")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "收起编辑器" }));

    expect(screen.queryByTestId("database-monaco-editor")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "打开编辑器" }));
    expect(screen.getByTestId("database-monaco-editor")).toBeInTheDocument();
  });

  it("previews and executes a selected SQL file", async () => {
    pickSqlFileMock.mockResolvedValue("C:\\tmp\\seed.sql");
    let resolveExecution: (value: {
      executed_statements: number;
      affected_rows: number;
      duration_ms: number;
    }) => void = () => {};
    callBackendMock.mockImplementation((command) => {
      if (command === "preview_database_sql_file") {
        return Promise.resolve({
          path: "C:\\tmp\\seed.sql",
          file_name: "seed.sql",
          size_bytes: 42,
          preview: "insert into users(id, name) values (1, 'Alice');",
          estimated_statement_count: 1,
          dangerous: true,
        });
      }
      if (command === "execute_database_sql_file") {
        return new Promise((resolve) => {
          resolveExecution = resolve;
        });
      }
      if (command === "list_database_sql_files") {
        return Promise.resolve([{ name: "default", content: "" }]);
      }
      return Promise.resolve([]);
    });

    renderDatabaseWorkspace("app");

    await userEvent.click(await screen.findByRole("button", { name: "执行 SQL 文件" }));

    expect(pickSqlFileMock).toHaveBeenCalledTimes(1);
    expect(callBackendMock).toHaveBeenCalledWith("preview_database_sql_file", {
      request: {
        connection_id: "mysql-dev",
        database: "app",
        path: "C:\\tmp\\seed.sql",
      },
    });
    const dialog = await screen.findByRole("dialog", { name: "执行 SQL 文件" });
    expect(dialog).toHaveTextContent("seed.sql");
    expect(dialog).toHaveTextContent("42 B");
    expect(dialog).toHaveTextContent("1 条语句");
    expect(dialog).toHaveTextContent("insert into users");
    expect(dialog).toHaveTextContent("检测到危险 SQL 关键词：insert、update、delete、drop、truncate、alter、create、replace、grant、revoke");

    await userEvent.click(within(dialog).getByRole("button", { name: "执行" }));

    expect(within(dialog).getByRole("button", { name: "执行中..." })).toBeDisabled();
    resolveExecution({
      executed_statements: 1,
      affected_rows: 1,
      duration_ms: 12,
    });
    expect(callBackendMock).toHaveBeenCalledWith("execute_database_sql_file", {
      request: {
        connection_id: "mysql-dev",
        database: "app",
        path: "C:\\tmp\\seed.sql",
      },
    });
    expect(await within(dialog).findByText("执行完成：1 条语句，影响 1 行，耗时 12 ms")).toBeInTheDocument();
    expect(screen.getAllByText("执行完成：1 条语句，影响 1 行，耗时 12 ms")).toHaveLength(1);
    expect(within(dialog).getByRole("button", { name: "已执行" })).toBeDisabled();
  });

  it("shows SQL file execution errors inside the preview dialog", async () => {
    pickSqlFileMock.mockResolvedValue("C:\\tmp\\bad.sql");
    callBackendMock.mockImplementation((command) => {
      if (command === "preview_database_sql_file") {
        return Promise.resolve({
          path: "C:\\tmp\\bad.sql",
          file_name: "bad.sql",
          size_bytes: 15,
          preview: "select * from missing;",
          estimated_statement_count: 1,
          dangerous: false,
        });
      }
      if (command === "execute_database_sql_file") {
        return Promise.reject(new Error("table missing"));
      }
      if (command === "list_database_sql_files") {
        return Promise.resolve([{ name: "default", content: "" }]);
      }
      return Promise.resolve([]);
    });

    renderDatabaseWorkspace("app");

    await userEvent.click(await screen.findByRole("button", { name: "执行 SQL 文件" }));
    const dialog = await screen.findByRole("dialog", { name: "执行 SQL 文件" });
    await userEvent.click(within(dialog).getByRole("button", { name: "执行" }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent("table missing");
    expect(within(dialog).getByRole("button", { name: "执行" })).not.toBeDisabled();
  });

  it("exports the current query result to CSV", async () => {
    pickDatabaseExportPathMock.mockResolvedValue("C:\\tmp\\app.result.20260625093000.csv");
    callBackendMock.mockImplementation((command) => {
      if (command === "execute_database_query") {
        return Promise.resolve({
          columns: [{ name: "id", data_type: "INT" }, { name: "name", data_type: "VARCHAR" }],
          rows: [[{ kind: "number", value: "1" }, { kind: "text", value: "Alice" }]],
          affected_rows: 0,
          duration_ms: 8,
          limited: false,
        });
      }
      if (command === "export_database_result") {
        return Promise.resolve({ exported_rows: 1, duration_ms: 3 });
      }
      if (command === "list_database_sql_files") {
        return Promise.resolve([{ name: "default", content: "" }]);
      }
      return Promise.resolve([]);
    });

    renderDatabaseWorkspace("app");
    const editor = await screen.findByLabelText("SQL 编辑器");
    await userEvent.type(editor, "select id, name from users");
    setSelectedSqlText("select id, name from users");
    await executeSelectedSqlFromContextMenu(editor);

    await userEvent.click(await screen.findByRole("button", { name: "导出" }));
    const dialog = await screen.findByRole("dialog", { name: "导出结果" });
    expect(within(dialog).getByLabelText("导出格式")).toHaveValue("csv");
    expect(within(dialog).getByLabelText("添加列标题")).toBeChecked();
    expect(within(dialog).getByLabelText("id")).toBeChecked();
    expect(within(dialog).getByLabelText("name")).toBeChecked();
    await userEvent.click(within(dialog).getByLabelText("id"));
    await userEvent.click(within(dialog).getByLabelText("添加列标题"));
    await userEvent.click(within(dialog).getByRole("button", { name: "导出" }));

    expect(pickDatabaseExportPathMock).toHaveBeenCalledWith(expect.stringMatching(/app\.result\.\d{14}\.csv/), "csv");
    expect(callBackendMock).toHaveBeenCalledWith("export_database_result", {
      request: {
        connection_id: "mysql-dev",
        database: "app",
        table: null,
        path: "C:\\tmp\\app.result.20260625093000.csv",
        format: "csv",
        include_header: false,
        columns: [{ name: "name", data_type: "VARCHAR" }],
        rows: [[{ kind: "text", value: "Alice" }]],
      },
    });
    expect(await screen.findByText("已导出 1 行，耗时 3 ms")).toBeInTheDocument();
  });

  it("renders query result summary and export actions in the unified toolbar", async () => {
    callBackendMock.mockImplementation((command) => {
      if (command === "execute_database_query") {
        return Promise.resolve({
          columns: [{ name: "id", data_type: "INT" }],
          rows: [[{ kind: "number", value: "1" }]],
          affected_rows: 0,
          duration_ms: 8,
          limited: false,
        });
      }
      if (command === "list_database_sql_files") {
        return Promise.resolve([{ name: "default", content: "" }]);
      }
      return Promise.resolve([]);
    });

    renderDatabaseWorkspace("app");
    const editor = await screen.findByLabelText("SQL 编辑器");
    await userEvent.type(editor, "select id from users");
    setSelectedSqlText("select id from users");
    await executeSelectedSqlFromContextMenu(editor);

    const summary = await screen.findByText("1 行，耗时 8 ms");
    const toolbar = summary.closest(".database-table-browser__toolbar");

    expect(toolbar).not.toBeNull();
    expect(within(toolbar as HTMLElement).getByRole("button", { name: "导出" })).toBeInTheDocument();
    expect(document.querySelector(".database-table-browser__grid-actions")).not.toBeInTheDocument();
  });

  it("asks for a target table when exporting free query result as INSERT SQL", async () => {
    pickDatabaseExportPathMock.mockResolvedValue("C:\\tmp\\app.users.20260625093000.sql");
    callBackendMock.mockImplementation((command) => {
      if (command === "execute_database_query") {
        return Promise.resolve({
          columns: [{ name: "id", data_type: "INT" }],
          rows: [[{ kind: "number", value: "1" }]],
          affected_rows: 0,
          duration_ms: 8,
          limited: false,
        });
      }
      if (command === "export_database_result") {
        return Promise.resolve({ exported_rows: 1, duration_ms: 3 });
      }
      if (command === "list_database_sql_files") {
        return Promise.resolve([{ name: "default", content: "" }]);
      }
      return Promise.resolve([]);
    });

    renderDatabaseWorkspace("app");
    const editor = await screen.findByLabelText("SQL 编辑器");
    await userEvent.type(editor, "select id from users");
    setSelectedSqlText("select id from users");
    await executeSelectedSqlFromContextMenu(editor);

    await userEvent.click(await screen.findByRole("button", { name: "导出" }));
    const exportDialog = await screen.findByRole("dialog", { name: "导出结果" });
    await userEvent.selectOptions(within(exportDialog).getByLabelText("导出格式"), "insert_sql");
    await userEvent.click(within(exportDialog).getByRole("button", { name: "导出" }));

    const dialog = await screen.findByRole("dialog", { name: "导出 INSERT SQL" });
    await userEvent.type(within(dialog).getByLabelText("目标表名"), "users");
    await userEvent.click(within(dialog).getByRole("button", { name: "导出" }));

    expect(pickDatabaseExportPathMock).toHaveBeenCalledWith(expect.stringMatching(/app\.users\.\d{14}\.sql/), "sql");
    expect(callBackendMock).toHaveBeenCalledWith("export_database_result", expect.objectContaining({
      request: expect.objectContaining({
        table: "users",
        format: "insert_sql",
      }),
    }));
  });

  it("uses the configured default limit and disables context execution without selected SQL", async () => {
    callBackendMock.mockImplementation((command) => {
      if (command === "execute_database_query") {
        return Promise.resolve({
          columns: [],
          rows: [],
          affected_rows: 0,
          duration_ms: 1,
          limited: false,
        });
      }
      return Promise.resolve([]);
    });

    renderDatabaseWorkspace("app");

    expect(screen.queryByRole("button", { name: "执行 SQL" })).not.toBeInTheDocument();
    await userEvent.clear(screen.getByLabelText("默认 LIMIT"));
    await userEvent.type(screen.getByLabelText("默认 LIMIT"), "50");
    const editor = screen.getByLabelText("SQL 编辑器");
    await userEvent.type(editor, "select * from users");
    readClipboardTextMock.mockResolvedValue("where id = 1");
    fireEvent.contextMenu(editor, { clientX: 10, clientY: 20 });
    expect(screen.getByRole("menuitem", { name: "执行选择 SQL" })).toBeDisabled();
    expect(callBackendMock).not.toHaveBeenCalledWith("execute_database_query", expect.anything());
    await userEvent.keyboard("{Escape}");

    setSelectedSqlText("select * from users");
    await executeSelectedSqlFromContextMenu(editor);

    await waitFor(() => {
      expect(callBackendMock).toHaveBeenCalledWith("execute_database_query", {
        request: {
          connection_id: "mysql-dev",
          database: "app",
          sql: "select * from users",
          limit: 50,
        },
      });
    });
  });

  it("shows only selected SQL, Cut, Copy and Paste in the SQL editor context menu", async () => {
    renderDatabaseWorkspace("app");

    const editor = screen.getByLabelText("SQL 编辑器");
    setSelectedSqlText("select 1");
    fireEvent.contextMenu(editor, { clientX: 10, clientY: 20 });

    expect(within(screen.getByRole("menu")).getAllByRole("menuitem").map((item) => item.textContent)).toEqual([
      "执行选择 SQL",
      "Cut",
      "Copy",
      "Paste",
    ]);

    await userEvent.click(screen.getByRole("menuitem", { name: "Cut" }));
    expect(focusMock).toHaveBeenCalled();
    expect(triggerMock).toHaveBeenCalledWith("devhub", "editor.action.clipboardCutAction", null);

    fireEvent.contextMenu(editor, { clientX: 10, clientY: 20 });
    await userEvent.click(screen.getByRole("menuitem", { name: "Copy" }));
    expect(triggerMock).toHaveBeenCalledWith("devhub", "editor.action.clipboardCopyAction", null);

    fireEvent.contextMenu(editor, { clientX: 10, clientY: 20 });
    await userEvent.click(screen.getByRole("menuitem", { name: "Paste" }));
    expect(readClipboardTextMock).toHaveBeenCalledTimes(1);
    expect(executeEditsMock).toHaveBeenCalledWith("devhub", [
      {
        forceMoveMarkers: true,
        range: expect.any(Object),
        text: "where id = 1",
      },
    ]);
    expect(pushUndoStopMock).toHaveBeenCalledTimes(2);
    expect(triggerMock).not.toHaveBeenCalledWith("devhub", "editor.action.clipboardPasteAction", null);
  });
});

async function executeSelectedSqlFromContextMenu(target: HTMLElement) {
  fireEvent.contextMenu(target, { clientX: 10, clientY: 20 });
  await userEvent.click(screen.getByRole("menuitem", { name: "执行选择 SQL" }));
}
