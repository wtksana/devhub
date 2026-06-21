import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n/I18nProvider";
import { readClipboardText } from "../../lib/clipboard";
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
}));

vi.mock("@monaco-editor/react", () => ({
  default: monacoEditorMock,
}));

const callBackendMock = vi.mocked(callBackend);
const readClipboardTextMock = vi.mocked(readClipboardText);

describe("DatabaseWorkspace", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    setSelectedSqlText("");
  });

  function renderDatabaseWorkspace(initialDatabase?: string) {
    return render(
      <I18nProvider language="zh-CN">
        <DatabaseWorkspace
          connectionId="mysql-dev"
          initialDatabase={initialDatabase}
          theme="light"
          fontFamily="Consolas"
          fontSize={14}
        />
      </I18nProvider>,
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
    expect(screen.getByText("NULL")).toBeInTheDocument();
    expect(screen.getByText("true")).toBeInTheDocument();
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
    expect(screen.getByText("共 501 条")).toBeInTheDocument();
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
          filter: null,
        },
      });
    });
    expect(screen.getByText("1")).toBeInTheDocument();
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
    await waitFor(() => {
      expect(callBackendMock).toHaveBeenCalledWith("load_database_table_page", {
        request: expect.objectContaining({
          page: 1,
          sort_column: "id",
          sort_direction: "asc",
        }),
      });
    });

    await userEvent.click(screen.getByRole("button", { name: "id INT ↑" }));
    await waitFor(() => {
      expect(callBackendMock).toHaveBeenCalledWith("load_database_table_page", {
        request: expect.objectContaining({
          sort_column: "id",
          sort_direction: "desc",
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

    const pageInput = screen.getByLabelText("页码");
    await userEvent.clear(pageInput);
    await userEvent.type(pageInput, "2");
    expect(callBackendMock).not.toHaveBeenCalledWith("load_database_table_page", expect.anything());

    await userEvent.keyboard("{Enter}");
    await waitFor(() => {
      expect(callBackendMock).toHaveBeenCalledWith("load_database_table_page", {
        request: expect.objectContaining({
          page: 2,
        }),
      });
    });

    callBackendMock.mockClear();
    const pageSizeInput = screen.getByLabelText("每页");
    await userEvent.clear(pageSizeInput);
    await userEvent.type(pageSizeInput, "500");
    expect(callBackendMock).not.toHaveBeenCalledWith("load_database_table_page", expect.anything());

    fireEvent.blur(pageSizeInput);
    await waitFor(() => {
      expect(callBackendMock).toHaveBeenCalledWith("load_database_table_page", {
        request: expect.objectContaining({
          page: 1,
          page_size: 500,
        }),
      });
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
