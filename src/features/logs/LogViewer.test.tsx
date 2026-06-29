import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n/I18nProvider";
import { writeClipboardText } from "../../lib/clipboard";
import { callBackend } from "../../lib/tauri";
import { LogViewer } from "./LogViewer";

vi.mock("../../lib/tauri", () => ({
  callBackend: vi.fn(),
}));

vi.mock("../../lib/clipboard", () => ({
  writeClipboardText: vi.fn(),
}));

const callBackendMock = vi.mocked(callBackend);
const writeClipboardTextMock = vi.mocked(writeClipboardText);

describe("LogViewer", () => {
  beforeEach(() => {
    cleanup();
    callBackendMock.mockReset();
    writeClipboardTextMock.mockReset();
    callBackendMock.mockResolvedValue([
      {
        file_name: "devhub-2026-06-27.log",
        line_number: 3,
        raw: "{\"level\":\"error\",\"module\":\"database\",\"action\":\"execute_query\",\"error\":\"table missing\"}",
        ts: "2026-06-27T10:03:00+08:00",
        level: "error",
        module: "database",
        action: "execute_query",
        target: "mysql-dev/app",
        result: "failed",
        duration_ms: 18,
        message: null,
        error: "table missing",
        metadata: { table: "users" },
      },
      {
        file_name: "devhub-2026-06-27.log",
        line_number: 2,
        raw: "{\"level\":\"info\",\"module\":\"sftp\",\"action\":\"list_directory\"}",
        ts: "2026-06-27T10:02:00+08:00",
        level: "info",
        module: "sftp",
        action: "list_directory",
        target: "/var/log",
        result: "success",
        duration_ms: 5,
        message: "loaded",
        error: null,
        metadata: null,
      },
    ]);
  });

  function renderViewer() {
    return render(
      <I18nProvider language="zh-CN">
        <LogViewer />
      </I18nProvider>,
    );
  }

  it("loads recent logs and shows selected log detail", async () => {
    renderViewer();

    expect(callBackendMock).toHaveBeenCalledWith("list_app_logs", { limit: 500 });
    await screen.findByRole("button", { name: /database execute_query/ });
    const rows = await screen.findAllByRole("row");
    expect(rows).toHaveLength(3);
    expect(screen.getByRole("button", { name: /database execute_query/ })).toBeInTheDocument();
    expect(within(screen.getByLabelText("日志详情")).getByText("2026-06-27 10:03:00")).toBeInTheDocument();
    expect(within(screen.getByLabelText("日志详情")).queryByText("2026-06-27T10:03:00+08:00")).not.toBeInTheDocument();
    expect(screen.getByText("table missing")).toBeInTheDocument();
    expect(screen.getByText(/\"table\": \"users\"/)).toBeInTheDocument();
  });

  it("filters logs by level, module, and keyword", async () => {
    renderViewer();
    await screen.findByRole("button", { name: /database execute_query/ });

    await userEvent.selectOptions(screen.getByLabelText("日志级别筛选"), "error");
    expect(screen.getByRole("button", { name: /database execute_query/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /sftp list_directory/ })).not.toBeInTheDocument();

    await userEvent.selectOptions(screen.getByLabelText("日志模块筛选"), "sftp");
    expect(screen.getByText("没有匹配的日志")).toBeInTheDocument();

    await userEvent.selectOptions(screen.getByLabelText("日志级别筛选"), "all");
    await userEvent.clear(screen.getByLabelText("日志关键字筛选"));
    await userEvent.type(screen.getByLabelText("日志关键字筛选"), "loaded");
    expect(screen.getByRole("button", { name: /sftp list_directory/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /database execute_query/ })).not.toBeInTheDocument();
  });

  it("refreshes and copies selected log raw content", async () => {
    renderViewer();
    await screen.findByRole("button", { name: /database execute_query/ });

    await userEvent.click(screen.getByRole("button", { name: "刷新日志" }));
    expect(callBackendMock).toHaveBeenCalledTimes(2);

    await userEvent.click(within(screen.getByLabelText("日志详情")).getByRole("button", { name: "复制日志" }));
    expect(writeClipboardTextMock).toHaveBeenCalledWith(
      "{\"level\":\"error\",\"module\":\"database\",\"action\":\"execute_query\",\"error\":\"table missing\"}",
    );
  });

  it("clears logs after confirmation and reloads the empty list", async () => {
    callBackendMock
      .mockResolvedValueOnce([
        {
          file_name: "devhub-2026-06-27.log",
          line_number: 3,
          raw: "{\"level\":\"error\",\"module\":\"database\",\"action\":\"execute_query\"}",
          ts: "2026-06-27T10:03:00+08:00",
          level: "error",
          module: "database",
          action: "execute_query",
          target: "mysql-dev/app",
          result: "failed",
          duration_ms: 18,
          message: null,
          error: "table missing",
          metadata: null,
        },
      ])
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce([]);

    renderViewer();
    await screen.findByRole("button", { name: /database execute_query/ });

    await userEvent.click(screen.getByRole("button", { name: "清除日志" }));
    const dialog = screen.getByRole("dialog", { name: "确认清除日志" });
    expect(dialog.querySelector(".connection-form")).toBeInTheDocument();
    expect(dialog).toHaveTextContent("确认清除所有本地日志？该操作不可逆。");
    expect(screen.getByRole("button", { name: "关闭" })).toHaveTextContent("×");

    await userEvent.click(screen.getByRole("button", { name: "确认" }));

    expect(callBackendMock).toHaveBeenCalledWith("clear_app_logs");
    await screen.findByText("没有匹配的日志");
    expect(screen.getByLabelText("日志详情")).toHaveTextContent("请选择一条日志");
  });
});
