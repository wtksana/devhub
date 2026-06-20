import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n/I18nProvider";
import { callBackend } from "../../lib/tauri";
import { DatabaseWorkspace } from "./DatabaseWorkspace";

vi.mock("../../lib/tauri", () => ({
  callBackend: vi.fn(),
}));

const callBackendMock = vi.mocked(callBackend);

describe("DatabaseWorkspace", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  function renderDatabaseWorkspace() {
    return render(
      <I18nProvider language="zh-CN">
        <DatabaseWorkspace connectionId="mysql-dev" />
      </I18nProvider>,
    );
  }

  it("loads and expands database object tree nodes", async () => {
    callBackendMock.mockImplementation((command, payload) => {
      if (command !== "list_database_objects") return Promise.resolve([]);
      const request = (payload as { request: { parent_kind?: string; database?: string } }).request;
      if (!request.parent_kind) {
        return Promise.resolve([{ id: "database:app", name: "app", kind: "database", has_children: true }]);
      }
      return Promise.resolve([
        { id: "table:app.users", name: "users", kind: "table", has_children: true, detail: "BASE TABLE" },
      ]);
    });

    renderDatabaseWorkspace();

    expect(await screen.findByText("app")).toBeInTheDocument();
    expect(callBackendMock).toHaveBeenCalledWith("list_database_objects", {
      request: {
        connection_id: "mysql-dev",
      },
    });

    await userEvent.click(screen.getByRole("button", { name: "展开 app" }));

    expect(await screen.findByText("users")).toBeInTheDocument();
    expect(screen.getByText("BASE TABLE")).toBeInTheDocument();
    expect(callBackendMock).toHaveBeenLastCalledWith("list_database_objects", {
      request: {
        connection_id: "mysql-dev",
        parent_kind: "database",
        database: "app",
      },
    });
    expect(screen.getByLabelText("数据库对象树")).toBeInTheDocument();
    expect(within(screen.getByLabelText("数据库工作区")).getByText("mysql-dev")).toBeInTheDocument();
  });

  it("shows node loading errors below the database object tree", async () => {
    callBackendMock.mockRejectedValue(new Error("metadata failed"));

    renderDatabaseWorkspace();

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("metadata failed");
    });
  });

  it("executes SQL and renders query result rows", async () => {
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

    renderDatabaseWorkspace();

    await userEvent.type(screen.getByLabelText("SQL 编辑器"), "select * from users");
    await userEvent.click(screen.getByRole("button", { name: "执行 SQL" }));

    await waitFor(() => {
      expect(callBackendMock).toHaveBeenCalledWith("execute_database_query", {
        request: {
          connection_id: "mysql-dev",
          database: null,
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
    callBackendMock.mockResolvedValueOnce([]);
    callBackendMock.mockResolvedValueOnce({
      columns: [],
      rows: [],
      affected_rows: 3,
      duration_ms: 8,
      limited: false,
    });
    callBackendMock.mockRejectedValueOnce(new Error("syntax error near from"));

    renderDatabaseWorkspace();

    await waitFor(() => expect(callBackendMock).toHaveBeenCalledWith("list_database_objects", {
      request: {
        connection_id: "mysql-dev",
      },
    }));
    await userEvent.clear(screen.getByLabelText("SQL 编辑器"));
    await userEvent.type(screen.getByLabelText("SQL 编辑器"), "update users set active = 1");
    await userEvent.click(screen.getByRole("button", { name: "执行 SQL" }));

    expect(await screen.findByText("影响 3 行，耗时 8 ms")).toBeInTheDocument();

    await userEvent.clear(screen.getByLabelText("SQL 编辑器"));
    await userEvent.type(screen.getByLabelText("SQL 编辑器"), "select from");
    await userEvent.click(screen.getByRole("button", { name: "执行 SQL" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("syntax error near from");
  });
});
