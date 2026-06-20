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
});
