import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppShell } from "./AppShell";
import type { DevHubSettings } from "../features/settings/settingsTypes";
import { callBackend, listenBackend } from "../lib/tauri";

let settings: DevHubSettings;
const saveSettings = vi.fn();
const callBackendMock = vi.mocked(callBackend);
const listenBackendMock = vi.mocked(listenBackend);
type TerminalOutputPayload = { session_id: string; data: string; status?: string };
let terminalOutputHandler: ((payload: TerminalOutputPayload) => void) | null = null;

function waitForEffects() {
  return new Promise((resolve) => {
    window.setTimeout(resolve, 0);
  });
}

function createSettings(): DevHubSettings {
  return {
    appearance: {
      theme: "dark",
      language: "zh-CN",
      ui_font_family: "Consolas",
      ui_font_size: 16,
      terminal_font_family: "Consolas",
      terminal_font_size: 14,
    },
    layout: {
      connection_sidebar_width: 280,
    },
    sftp: {
      file_size_unit: "bytes",
    },
    terminal: {
      term: "xterm-256color",
      colorterm: "truecolor",
      log_highlight: {
        auto_detect_tail: true,
        case_sensitive: false,
        rules: [
          { pattern: "\\bERROR\\b", color: "#e06c75" },
        ],
      },
    },
    logging: {
      enabled: true,
      level: "info",
      retention_days: 14,
      include_sql: false,
    },
    connection_groups: [],
    connections: [],
  };
}

const remoteConnection = {
  id: "prod-web-01",
  name: "生产 Web",
  host: "10.0.0.10",
  port: 22,
  username: "root",
  auth: {
    type: "password" as const,
    password: "secret",
  },
};

const redisConnection = {
  kind: "redis" as const,
  id: "redis-local",
  name: "本地 Redis",
  host: "127.0.0.1",
  port: 6379,
  database: 1,
  password: "redis-password",
};

const mysqlConnection = {
  kind: "mysql" as const,
  id: "mysql-dev",
  name: "开发 MySQL",
  host: "127.0.0.1",
  port: 3306,
  username: "root",
  password: "secret",
  database: "app",
};

vi.mock("../features/settings/useSettings", () => ({
  useSettings: () => ({
    settings,
    rawJson: "{}",
    error: null,
    saveSettings,
    saveRawJson: vi.fn(),
    reload: vi.fn(),
  }),
}));

vi.mock("../lib/tauri", () => ({
  callBackend: vi.fn().mockResolvedValue({ session_id: "session-1" }),
  listenBackend: vi.fn().mockImplementation(async (_event, handler) => {
    terminalOutputHandler = handler as (payload: TerminalOutputPayload) => void;
    return vi.fn();
  }),
}));

vi.mock("../features/logs/LogViewer", () => ({
  LogViewer: () => <section aria-label="日志">日志查看器</section>,
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    minimize: vi.fn(),
    toggleMaximize: vi.fn(),
    close: vi.fn(),
  }),
}));

describe("AppShell", () => {
  beforeEach(() => {
    cleanup();
    window.HTMLElement.prototype.scrollIntoView = vi.fn();
    settings = createSettings();
    saveSettings.mockClear();
    callBackendMock.mockClear();
    callBackendMock.mockResolvedValue({ session_id: "session-1" });
    listenBackendMock.mockClear();
    terminalOutputHandler = null;
  });

  function getConnectionItem(name: string) {
    return within(screen.getByLabelText("连接列表")).getByText(name).closest("li") as HTMLElement;
  }

  it("renders Zed-style dock, workspace, command, status, and settings regions", () => {
    render(<AppShell />);

    expect(screen.getByLabelText("连接列表")).toBeInTheDocument();
    expect(screen.getByLabelText("工作区")).toBeInTheDocument();
    expect(screen.getByLabelText("命令面板")).toBeInTheDocument();
    expect(screen.getByLabelText("窗口控制")).toBeInTheDocument();
    expect(screen.getByLabelText("状态栏")).toBeInTheDocument();
    expect(screen.queryByLabelText("设置分类")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("主题")).not.toBeInTheDocument();
    expect(screen.getByLabelText("工作区标签")).toBeEmptyDOMElement();
    expect(screen.getByText("未打开标签")).toBeInTheDocument();
  });

  it("renders the shell in English when configured", () => {
    settings = {
      ...createSettings(),
      appearance: {
        ...createSettings().appearance,
        language: "en-US",
      },
    };

    render(<AppShell />);

    expect(screen.getByLabelText("Connections")).toBeInTheDocument();
    expect(screen.getByLabelText("Workspace")).toBeInTheDocument();
    expect(screen.getByText("No tabs open")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Toggle connection panel" })).toBeInTheDocument();
  });

  it("opens settings as a closable workspace tab", async () => {
    render(<AppShell />);

    await userEvent.click(screen.getByRole("button", { name: "打开设置" }));

    expect(within(screen.getByLabelText("工作区标签")).getByRole("button", { name: "设置" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByLabelText("设置分类")).toBeInTheDocument();

    await userEvent.click(within(screen.getByLabelText("工作区标签")).getByRole("button", { name: "关闭 设置" }));

    expect(screen.queryByLabelText("设置分类")).not.toBeInTheDocument();
    expect(screen.getByText("未打开标签")).toBeInTheDocument();
  });

  it("opens logs from the settings logging section as a closable workspace tab", async () => {
    render(<AppShell />);

    await userEvent.click(screen.getByRole("button", { name: "打开设置" }));
    await userEvent.click(within(screen.getByLabelText("设置分类")).getByRole("button", { name: "日志" }));
    await userEvent.click(screen.getByRole("button", { name: "查看日志" }));

    expect(within(screen.getByLabelText("工作区标签")).getByRole("button", { name: "日志" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByText("日志查看器")).toBeInTheDocument();

    await userEvent.click(within(screen.getByLabelText("工作区标签")).getByRole("button", { name: "关闭 日志" }));

    expect(screen.queryByText("日志查看器")).not.toBeInTheDocument();
  });

  it("toggles dark and light theme from the top bar", async () => {
    render(<AppShell />);

    await userEvent.click(screen.getByRole("button", { name: "切换主题" }));

    expect(saveSettings).toHaveBeenCalledWith({
      ...settings,
      appearance: {
        ...settings.appearance,
        theme: "light",
      },
    });

    settings = {
      ...settings,
      appearance: {
        ...settings.appearance,
        theme: "light",
      },
    };

    cleanup();
    render(<AppShell />);
    await userEvent.click(screen.getByRole("button", { name: "切换主题" }));

    expect(saveSettings).toHaveBeenLastCalledWith({
      ...settings,
      appearance: {
        ...settings.appearance,
        theme: "dark",
      },
    });
  });

  it("applies appearance settings to the shell immediately", () => {
    settings = {
      ...createSettings(),
      appearance: {
        theme: "light",
        language: "zh-CN",
        ui_font_family: "Zed Sans",
        ui_font_size: 15,
        terminal_font_family: "Maple Mono",
        terminal_font_size: 16,
      },
    };

    render(<AppShell />);

    const shell = screen.getByRole("main");
    expect(shell).toHaveAttribute("data-theme", "light");
    expect(shell).toHaveStyle({
      fontFamily: "Zed Sans",
      fontSize: "15px",
      "--ui-font-family": "Zed Sans",
      "--ui-font-size": "15px",
      "--ui-font-size-small": "14px",
      "--ui-font-size-large": "17px",
      "--terminal-font-family": "Maple Mono",
      "--terminal-font-size": "16px",
      "--connection-sidebar-width": "280px",
    });
  });

  it("applies default font settings to shell CSS variables", () => {
    render(<AppShell />);

    expect(screen.getByRole("main")).toHaveStyle({
      fontFamily: "Consolas",
      fontSize: "16px",
      "--ui-font-family": "Consolas",
      "--ui-font-size": "16px",
      "--ui-font-size-small": "15px",
      "--ui-font-size-large": "18px",
      "--terminal-font-family": "Consolas",
      "--terminal-font-size": "14px",
    });
  });

  it("applies layout settings to the connection panel", async () => {
    settings = {
      ...createSettings(),
      layout: {
        connection_sidebar_width: 360,
      },
    };

    render(<AppShell />);
    await userEvent.dblClick(within(screen.getByLabelText("连接列表")).getByText("本地终端").closest("li") as HTMLElement);

    const shell = screen.getByRole("main");
    expect(shell).toHaveStyle({
      "--connection-sidebar-width": "360px",
    });
  });

  it("resizes the connection panel for the current session without saving settings", () => {
    render(<AppShell />);

    const handle = screen.getByRole("separator", { name: "调整连接面板宽度" });
    fireEvent.mouseDown(handle, { clientX: 280 });
    fireEvent.mouseMove(window, { clientX: 340 });
    fireEvent.mouseUp(window);

    expect(screen.getByRole("main")).toHaveStyle({
      "--connection-sidebar-width": "340px",
    });
    expect(saveSettings).not.toHaveBeenCalled();
  });

  it("resizes split workspace columns for the current session", async () => {
    settings = {
      ...createSettings(),
      connections: [remoteConnection],
    };

    render(<AppShell />);

    await userEvent.dblClick(screen.getByText("生产 Web").closest("li") as HTMLElement);
    await userEvent.pointer({
      keys: "[MouseRight]",
      target: within(screen.getAllByLabelText("工作区标签")[0]).getByRole("button", { name: "生产 Web" }),
    });
    await userEvent.click(screen.getByRole("menuitem", { name: "向右拆分" }));

    expect(screen.getByLabelText("工作区面板 1")).toHaveStyle({ left: "0%", width: "50%" });
    expect(screen.getByLabelText("工作区面板 2")).toHaveStyle({ left: "50%", width: "50%" });

    const handle = screen.getByRole("separator", { name: "调整工作区列 1 宽度" });
    fireEvent.mouseDown(handle, { clientX: 500 });
    fireEvent.mouseMove(window, { clientX: 620 });
    fireEvent.mouseUp(window);

    expect(screen.getByLabelText("工作区面板 1")).toHaveStyle({ left: "0%", width: "62%" });
    expect(screen.getByLabelText("工作区面板 2")).toHaveStyle({ left: "62%", width: "38%" });
    expect(saveSettings).not.toHaveBeenCalled();
  });

  it("resizes visible terminals after dragging a workspace split handle", async () => {
    settings = {
      ...createSettings(),
      connections: [remoteConnection],
    };

    render(<AppShell />);

    await userEvent.dblClick(screen.getByText("生产 Web").closest("li") as HTMLElement);
    await userEvent.pointer({
      keys: "[MouseRight]",
      target: within(screen.getAllByLabelText("工作区标签")[0]).getByRole("button", { name: "生产 Web" }),
    });
    await userEvent.click(screen.getByRole("menuitem", { name: "向右拆分" }));

    await waitFor(() => {
      expect(callBackendMock.mock.calls.filter(([command]) => command === "open_terminal")).toHaveLength(2);
    });
    callBackendMock.mockClear();

    const handle = screen.getByRole("separator", { name: "调整工作区列 1 宽度" });
    fireEvent.mouseDown(handle, { clientX: 500 });
    fireEvent.mouseMove(window, { clientX: 620 });
    fireEvent.mouseUp(window);

    await waitFor(() => {
      expect(callBackendMock).toHaveBeenCalledWith("resize_terminal", {
        request: { session_id: "session-1", cols: expect.any(Number), rows: expect.any(Number) },
      });
    });
  });

  it("resizes the original terminal after splitting its pane down", async () => {
    settings = {
      ...createSettings(),
      connections: [remoteConnection],
    };

    let openTerminalCalls = 0;
    callBackendMock.mockImplementation((command) => {
      if (command === "open_terminal") {
        openTerminalCalls += 1;
        return Promise.resolve({ session_id: `session-${openTerminalCalls}` });
      }
      return Promise.resolve({ session_id: "session-1" });
    });

    render(<AppShell />);

    await userEvent.dblClick(screen.getByText("生产 Web").closest("li") as HTMLElement);
    await waitFor(() => {
      expect(callBackendMock.mock.calls.filter(([command]) => command === "open_terminal")).toHaveLength(1);
    });
    callBackendMock.mockClear();

    await userEvent.pointer({
      keys: "[MouseRight]",
      target: within(screen.getAllByLabelText("工作区标签")[0]).getByRole("button", { name: "生产 Web" }),
    });
    await userEvent.click(screen.getByRole("menuitem", { name: "向下拆分" }));

    await waitFor(() => {
      expect(callBackendMock).toHaveBeenCalledWith("resize_terminal", {
        request: { session_id: "session-1", cols: expect.any(Number), rows: expect.any(Number) },
      });
    });
  });

  it("resizes the original terminal after splitting its pane down beside an existing right pane", async () => {
    settings = {
      ...createSettings(),
      connections: [remoteConnection],
    };

    let openTerminalCalls = 0;
    callBackendMock.mockImplementation((command) => {
      if (command === "open_terminal") {
        openTerminalCalls += 1;
        return Promise.resolve({ session_id: `session-${openTerminalCalls}` });
      }
      return Promise.resolve({ session_id: "session-1" });
    });

    render(<AppShell />);

    await userEvent.dblClick(screen.getByText("生产 Web").closest("li") as HTMLElement);
    await userEvent.pointer({
      keys: "[MouseRight]",
      target: within(screen.getAllByLabelText("工作区标签")[0]).getByRole("button", { name: "生产 Web" }),
    });
    await userEvent.click(screen.getByRole("menuitem", { name: "向右拆分" }));

    await waitFor(() => {
      expect(callBackendMock.mock.calls.filter(([command]) => command === "open_terminal")).toHaveLength(2);
    });
    callBackendMock.mockClear();

    await userEvent.pointer({
      keys: "[MouseRight]",
      target: within(screen.getAllByLabelText(/^工作区面板/)[0]).getByRole("button", { name: "生产 Web" }),
    });
    await userEvent.click(screen.getByRole("menuitem", { name: "向下拆分" }));

    await waitFor(() => {
      expect(callBackendMock).toHaveBeenCalledWith("resize_terminal", {
        request: { session_id: "session-1", cols: expect.any(Number), rows: expect.any(Number) },
      });
    });
  });

  it("keeps workspace columns evenly sized after splitting three panes to the right", async () => {
    settings = {
      ...createSettings(),
      connections: [remoteConnection],
    };

    render(<AppShell />);

    await userEvent.dblClick(screen.getByText("生产 Web").closest("li") as HTMLElement);
    await userEvent.pointer({
      keys: "[MouseRight]",
      target: within(screen.getAllByLabelText("工作区标签")[0]).getByRole("button", { name: "生产 Web" }),
    });
    await userEvent.click(screen.getByRole("menuitem", { name: "向右拆分" }));

    await userEvent.pointer({
      keys: "[MouseRight]",
      target: screen.getByRole("button", { name: "生产 Web 2" }),
    });
    await userEvent.click(screen.getByRole("menuitem", { name: "向右拆分" }));

    expect(screen.getByLabelText("工作区面板 1")).toHaveStyle({ left: "0%", width: "33.33333333333333%" });
    expect(screen.getByLabelText("工作区面板 2")).toHaveStyle({
      left: "33.33333333333333%",
      width: "33.33333333333333%",
    });
    expect(screen.getByLabelText("工作区面板 3")).toHaveStyle({
      left: "66.66666666666666%",
      width: "33.33333333333333%",
    });
  });

  it("resizes split workspace rows for the current session", async () => {
    settings = {
      ...createSettings(),
      connections: [remoteConnection],
    };

    render(<AppShell />);

    await userEvent.dblClick(screen.getByText("生产 Web").closest("li") as HTMLElement);
    await userEvent.pointer({
      keys: "[MouseRight]",
      target: within(screen.getAllByLabelText("工作区标签")[0]).getByRole("button", { name: "生产 Web" }),
    });
    await userEvent.click(screen.getByRole("menuitem", { name: "向下拆分" }));

    expect(screen.getByLabelText("工作区面板 1")).toHaveStyle({ top: "0%", height: "50%" });
    expect(screen.getByLabelText("工作区面板 2")).toHaveStyle({ top: "50%", height: "50%" });

    const handle = screen.getByRole("separator", { name: "调整工作区行 1 高度" });
    fireEvent.mouseDown(handle, { clientY: 360 });
    fireEvent.mouseMove(window, { clientY: 460 });
    fireEvent.mouseUp(window);

    expect(screen.getByLabelText("工作区面板 1")).toHaveStyle({ top: "0%", height: "60%" });
    expect(screen.getByLabelText("工作区面板 2")).toHaveStyle({ top: "60%", height: "40%" });
    expect(saveSettings).not.toHaveBeenCalled();
  });

  it("limits row resize handles to the columns that are actually split", async () => {
    settings = {
      ...createSettings(),
      connections: [remoteConnection],
    };

    render(<AppShell />);

    await userEvent.dblClick(screen.getByText("生产 Web").closest("li") as HTMLElement);
    await userEvent.pointer({
      keys: "[MouseRight]",
      target: within(screen.getAllByLabelText("工作区标签")[0]).getByRole("button", { name: "生产 Web" }),
    });
    await userEvent.click(screen.getByRole("menuitem", { name: "向右拆分" }));

    await userEvent.pointer({
      keys: "[MouseRight]",
      target: screen.getByRole("button", { name: "生产 Web 2" }),
    });
    await userEvent.click(screen.getByRole("menuitem", { name: "向下拆分" }));

    const rowHandle = screen.getAllByRole("separator", { name: "调整工作区行 1 高度" })[0];
    expect(rowHandle).toHaveStyle({ left: "50%", width: "50%", top: "50%" });
  });

  it("resizes only the split group that owns the dragged workspace handle", async () => {
    settings = {
      ...createSettings(),
      connections: [remoteConnection],
    };

    render(<AppShell />);

    await userEvent.dblClick(screen.getByText("生产 Web").closest("li") as HTMLElement);
    await userEvent.pointer({
      keys: "[MouseRight]",
      target: within(screen.getAllByLabelText("工作区标签")[0]).getByRole("button", { name: "生产 Web" }),
    });
    await userEvent.click(screen.getByRole("menuitem", { name: "向右拆分" }));
    await userEvent.pointer({
      keys: "[MouseRight]",
      target: screen.getByRole("button", { name: "生产 Web 2" }),
    });
    await userEvent.click(screen.getByRole("menuitem", { name: "向右拆分" }));

    await userEvent.pointer({
      keys: "[MouseRight]",
      target: within(screen.getAllByLabelText(/^工作区面板/)[0]).getByRole("button", { name: "生产 Web" }),
    });
    await userEvent.click(screen.getByRole("menuitem", { name: "向下拆分" }));
    await userEvent.pointer({
      keys: "[MouseRight]",
      target: screen.getByRole("button", { name: "生产 Web 2" }),
    });
    await userEvent.click(screen.getByRole("menuitem", { name: "向下拆分" }));
    await userEvent.pointer({
      keys: "[MouseRight]",
      target: screen.getByRole("button", { name: "生产 Web 3" }),
    });
    await userEvent.click(screen.getByRole("menuitem", { name: "向下拆分" }));

    expect(screen.getByLabelText("工作区面板 1")).toHaveStyle({ top: "0%", height: "50%" });
    expect(screen.getByLabelText("工作区面板 2")).toHaveStyle({ top: "0%", height: "50%" });
    expect(screen.getByLabelText("工作区面板 3")).toHaveStyle({ top: "0%", height: "50%" });
    expect(screen.getByLabelText("工作区面板 4")).toHaveStyle({ top: "50%", height: "50%" });
    expect(screen.getByLabelText("工作区面板 5")).toHaveStyle({ top: "50%", height: "50%" });
    expect(screen.getByLabelText("工作区面板 6")).toHaveStyle({ top: "50%", height: "50%" });

    const middleRowHandle = screen.getAllByRole("separator", { name: "调整工作区行 1 高度" })[1];
    fireEvent.mouseDown(middleRowHandle, { clientY: 360 });
    fireEvent.mouseMove(window, { clientY: 460 });
    fireEvent.mouseUp(window);

    expect(screen.getByLabelText("工作区面板 1")).toHaveStyle({ top: "0%", height: "50%" });
    expect(screen.getByLabelText("工作区面板 2")).toHaveStyle({ top: "0%", height: "60%" });
    expect(screen.getByLabelText("工作区面板 3")).toHaveStyle({ top: "0%", height: "50%" });
    expect(screen.getByLabelText("工作区面板 4")).toHaveStyle({ top: "50%", height: "50%" });
    expect(screen.getByLabelText("工作区面板 5")).toHaveStyle({ top: "60%", height: "40%" });
    expect(screen.getByLabelText("工作区面板 6")).toHaveStyle({ top: "50%", height: "50%" });
  });

  it("removes workspace split handles when the split is removed", async () => {
    settings = {
      ...createSettings(),
      connections: [remoteConnection],
    };

    render(<AppShell />);

    await userEvent.dblClick(screen.getByText("生产 Web").closest("li") as HTMLElement);
    await userEvent.pointer({
      keys: "[MouseRight]",
      target: within(screen.getAllByLabelText("工作区标签")[0]).getByRole("button", { name: "生产 Web" }),
    });
    await userEvent.click(screen.getByRole("menuitem", { name: "向右拆分" }));

    expect(screen.getByRole("separator", { name: "调整工作区列 1 宽度" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /关闭 生产 Web 2/ }));

    expect(screen.queryByRole("separator", { name: "调整工作区列 1 宽度" })).not.toBeInTheDocument();
  });

  it("resets row sizes after bottom panes are closed and only one row remains", async () => {
    settings = {
      ...createSettings(),
      connections: [remoteConnection],
    };

    render(<AppShell />);

    await userEvent.dblClick(screen.getByText("生产 Web").closest("li") as HTMLElement);
    await userEvent.pointer({
      keys: "[MouseRight]",
      target: within(screen.getAllByLabelText("工作区标签")[0]).getByRole("button", { name: "生产 Web" }),
    });
    await userEvent.click(screen.getByRole("menuitem", { name: "向右拆分" }));

    await userEvent.pointer({
      keys: "[MouseRight]",
      target: within(screen.getAllByLabelText(/^工作区面板/)[0]).getByRole("button", { name: "生产 Web" }),
    });
    await userEvent.click(screen.getByRole("menuitem", { name: "向下拆分" }));

    await userEvent.pointer({
      keys: "[MouseRight]",
      target: screen.getByRole("button", { name: "生产 Web 2" }),
    });
    await userEvent.click(screen.getByRole("menuitem", { name: "向下拆分" }));

    const rowHandle = screen.getAllByRole("separator", { name: "调整工作区行 1 高度" })[0];
    fireEvent.mouseDown(rowHandle, { clientY: 400 });
    fireEvent.mouseMove(window, { clientY: 500 });
    fireEvent.mouseUp(window);

    await userEvent.click(screen.getByRole("button", { name: /关闭 生产 Web 3/ }));
    await userEvent.click(screen.getByRole("button", { name: /关闭 生产 Web 4/ }));

    expect(screen.getByLabelText("工作区面板 1")).toHaveStyle({ top: "0%", height: "100%" });
    expect(screen.getByLabelText("工作区面板 2")).toHaveStyle({ top: "0%", height: "100%" });
    expect(screen.queryByRole("separator", { name: "调整工作区行 1 高度" })).not.toBeInTheDocument();
  });

  it("opens terminal tabs named by connection and closes sessions with the tab", async () => {
    settings = {
      ...createSettings(),
      connections: [remoteConnection],
    };

    render(<AppShell />);

    await userEvent.dblClick(screen.getByText("生产 Web").closest("li") as HTMLElement);

    expect(within(screen.getByLabelText("工作区标签")).getByRole("button", { name: "生产 Web" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    await userEvent.click(within(screen.getByLabelText("工作区标签")).getByRole("button", { name: "关闭 生产 Web" }));

    expect(screen.queryByRole("button", { name: "生产 Web" })).not.toBeInTheDocument();
    expect(callBackendMock).toHaveBeenCalledWith("close_terminal", { sessionId: "session-1" });
  });

  it("shows terminal connection status dots on workspace tabs", async () => {
    settings = {
      ...createSettings(),
      connections: [remoteConnection],
    };

    let openTerminalCalls = 0;
    callBackendMock.mockImplementation((command) => {
      if (command === "open_terminal") {
        openTerminalCalls += 1;
        if (openTerminalCalls === 2) {
          return Promise.reject(new Error("ssh timeout"));
        }
        return Promise.resolve({ session_id: `session-${openTerminalCalls}` });
      }
      return Promise.resolve({ session_id: "session-1" });
    });

    const { rerender } = render(<AppShell />);

    await userEvent.dblClick(screen.getByText("生产 Web").closest("li") as HTMLElement);

    await waitFor(() => {
      expect(screen.getByLabelText("生产 Web 状态：连接中")).toBeInTheDocument();
    });
    terminalOutputHandler?.({ session_id: "session-1", data: "", status: "connected" });
    await waitFor(() => {
      expect(screen.getByLabelText("生产 Web 状态：已连接")).toBeInTheDocument();
    });

    await userEvent.pointer({ keys: "[MouseRight]", target: getConnectionItem("生产 Web") });
    await userEvent.click(screen.getByRole("menuitem", { name: "新标签连接" }));

    rerender(<AppShell />);

    await waitFor(() => {
      expect(screen.getByLabelText("生产 Web 2 状态：连接失败")).toBeInTheDocument();
    });
  });

  it("opens a Redis workspace tab from a Redis connection", async () => {
    settings = {
      ...createSettings(),
      connections: [redisConnection],
    };
    callBackendMock.mockImplementation((command) => {
      if (command === "list_redis_keys") {
        return Promise.resolve({
          total_count: 1,
          entries: [
            { key: "user:1", key_type: "hash", ttl: -1 },
          ],
        });
      }
      if (command === "get_redis_key_value") {
        return Promise.resolve({
          key: "user:1",
          key_type: "hash",
          ttl: -1,
          value: {
            kind: "hash",
            entries: [["name", "devhub"]],
            truncated: false,
            length: 1,
          },
        });
      }
      return Promise.resolve({ session_id: "session-1" });
    });

    render(<AppShell />);

    await userEvent.dblClick(screen.getByText("本地 Redis").closest("li") as HTMLElement);

    expect(within(screen.getByLabelText("工作区标签")).getByRole("button", { name: "本地 Redis" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByLabelText("Redis key 列表")).toBeInTheDocument();
    await userEvent.click(await screen.findByRole("button", { name: "展开 user" }));
    await screen.findByText("user:1");
    expect(callBackendMock).toHaveBeenCalledWith("list_redis_keys", {
      request: {
        connection_id: "redis-local",
        database: 1,
        pattern: "*",
        count: 5000,
        cursor: 0,
      },
    });
  });

  it("opens a database workspace tab from a MySQL connection", async () => {
    settings = {
      ...createSettings(),
      connections: [mysqlConnection],
    };
    callBackendMock.mockImplementation((command) => {
      if (command === "list_database_objects") return Promise.resolve([]);
      return Promise.resolve({ session_id: "session-1" });
    });

    render(<AppShell />);

    await userEvent.dblClick(screen.getByText("开发 MySQL").closest("li") as HTMLElement);

    expect(within(screen.getByLabelText("工作区标签")).getByRole("button", { name: "开发 MySQL" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByLabelText("数据库工作区")).toBeInTheDocument();
    expect(callBackendMock).toHaveBeenCalledWith("list_database_objects", {
      request: {
        connection_id: "mysql-dev",
        parent_kind: "database",
        database: "app",
      },
    });
  });

  it("toggles panels from the status bar", async () => {
    render(<AppShell />);
    await userEvent.dblClick(within(screen.getByLabelText("连接列表")).getByText("本地终端").closest("li") as HTMLElement);

    expect(screen.getByLabelText("连接列表")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "切换连接面板" }));
    expect(screen.queryByLabelText("连接列表")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "切换连接面板" }));
    expect(screen.getByLabelText("连接列表")).toBeInTheDocument();
  });

  it("places status bar toggles next to their panel sides", () => {
    render(<AppShell />);

    expect(screen.getByLabelText("状态栏左侧区域")).toContainElement(
      screen.getByRole("button", { name: "切换连接面板" }),
    );
    expect(screen.queryByRole("button", { name: "切换AI面板" })).not.toBeInTheDocument();
  });

  it("saves a new SSH password connection from the connection panel", async () => {
    render(<AppShell />);

    await userEvent.click(screen.getByRole("button", { name: "添加连接" }));
    await userEvent.type(screen.getByLabelText("连接名称"), "测试服务器");
    await userEvent.type(screen.getByLabelText("主机"), "192.168.1.10");
    await userEvent.type(screen.getByLabelText("用户名"), "root");
    await userEvent.type(screen.getByLabelText("密码"), "root-password");
    await userEvent.click(screen.getByRole("button", { name: "保存连接" }));

    expect(saveSettings).toHaveBeenCalledWith({
      ...settings,
      connections: [
        {
          id: expect.stringMatching(/^ssh-/),
          name: "测试服务器",
          host: "192.168.1.10",
          port: 22,
          username: "root",
          auth: {
            type: "password",
            password: "root-password",
          },
        },
      ],
    });
  });

  it("adds a new connection group to portable settings when saving a grouped connection", async () => {
    render(<AppShell />);

    await userEvent.click(screen.getByRole("button", { name: "添加连接" }));
    await userEvent.type(screen.getByLabelText("连接名称"), "测试服务器");
    await userEvent.type(screen.getByLabelText("分组"), "生产环境");
    await userEvent.type(screen.getByLabelText("主机"), "192.168.1.10");
    await userEvent.type(screen.getByLabelText("用户名"), "root");
    await userEvent.type(screen.getByLabelText("密码"), "root-password");
    await userEvent.click(screen.getByRole("button", { name: "保存连接" }));

    expect(saveSettings).toHaveBeenCalledWith({
      ...settings,
      connection_groups: ["生产环境"],
      connections: [
        {
          id: expect.stringMatching(/^ssh-/),
          name: "测试服务器",
          group: "生产环境",
          host: "192.168.1.10",
          port: 22,
          username: "root",
          auth: {
            type: "password",
            password: "root-password",
          },
        },
      ],
    });
  });

  it("shows connection context actions for opening, duplicating, editing, and SFTP", async () => {
    settings = {
      ...createSettings(),
      connections: [remoteConnection],
    };
    callBackendMock.mockImplementation((command) => {
      if (command === "list_sftp_directory") {
        return Promise.resolve([]);
      }
      return Promise.resolve({ session_id: "session-1" });
    });

    render(<AppShell />);

    await userEvent.pointer({ keys: "[MouseRight]", target: getConnectionItem("生产 Web") });

    expect(screen.getByRole("menuitem", { name: "连接" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "新标签连接" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "SFTP" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "编辑" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "复制" })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("menuitem", { name: "连接" }));
    expect(within(screen.getByLabelText("工作区标签")).getByRole("button", { name: "生产 Web" })).toBeInTheDocument();

    await userEvent.pointer({ keys: "[MouseRight]", target: getConnectionItem("生产 Web") });
    await userEvent.click(screen.getByRole("menuitem", { name: "新标签连接" }));
    expect(within(screen.getByLabelText("工作区标签")).getByRole("button", { name: "生产 Web 2" })).toBeInTheDocument();

    await userEvent.pointer({ keys: "[MouseRight]", target: getConnectionItem("生产 Web") });
    await userEvent.click(screen.getByRole("menuitem", { name: "SFTP" }));
    expect(within(screen.getByLabelText("工作区标签")).getByRole("button", { name: "生产 Web SFTP" })).toBeInTheDocument();
    expect(screen.getByLabelText("远程路径")).toBeInTheDocument();
  });

  it("opens a normal connection tab when new tab connection has no existing terminal tab", async () => {
    settings = {
      ...createSettings(),
      connections: [remoteConnection],
    };

    render(<AppShell />);

    await userEvent.pointer({ keys: "[MouseRight]", target: getConnectionItem("生产 Web") });
    await userEvent.click(screen.getByRole("menuitem", { name: "新标签连接" }));

    expect(within(screen.getByLabelText("工作区标签")).getByRole("button", { name: "生产 Web" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.queryByRole("button", { name: "生产 Web 1" })).not.toBeInTheDocument();
  });

  it("keeps the newest rapid new-terminal tab active without showing the empty workspace", async () => {
    settings = {
      ...createSettings(),
      connections: [remoteConnection],
    };
    const dateSpy = vi.spyOn(Date, "now").mockReturnValue(1782000000000);
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      render(<AppShell />);

      await userEvent.dblClick(screen.getByText("生产 Web").closest("li") as HTMLElement);
      await userEvent.pointer({ keys: "[MouseRight]", target: getConnectionItem("生产 Web") });
      await userEvent.click(screen.getByRole("menuitem", { name: "新标签连接" }));
      await userEvent.pointer({ keys: "[MouseRight]", target: getConnectionItem("生产 Web") });
      await userEvent.click(screen.getByRole("menuitem", { name: "新标签连接" }));

      expect(screen.queryByText("未打开标签")).not.toBeInTheDocument();
      expect(consoleErrorSpy).not.toHaveBeenCalledWith(expect.stringContaining("Encountered two children with the same key"), expect.anything());
      expect(within(screen.getByLabelText("工作区标签")).getByRole("button", { name: "生产 Web 3" })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
    } finally {
      dateSpy.mockRestore();
      consoleErrorSpy.mockRestore();
    }
  });

  it("edits and copies an existing connection from the connection context menu", async () => {
    settings = {
      ...createSettings(),
      connections: [remoteConnection],
    };

    render(<AppShell />);

    await userEvent.pointer({ keys: "[MouseRight]", target: getConnectionItem("生产 Web") });
    await userEvent.click(screen.getByRole("menuitem", { name: "编辑" }));
    expect(screen.getByRole("dialog", { name: "编辑 SSH 连接" })).toBeInTheDocument();
    expect(screen.getByLabelText("连接名称")).toHaveValue("生产 Web");

    await userEvent.clear(screen.getByLabelText("连接名称"));
    await userEvent.type(screen.getByLabelText("连接名称"), "生产 Web 变更");
    await userEvent.click(screen.getByRole("button", { name: "保存连接" }));

    expect(saveSettings).toHaveBeenLastCalledWith({
      ...settings,
      connections: [
        {
          ...remoteConnection,
          name: "生产 Web 变更",
        },
      ],
    });

    await userEvent.pointer({ keys: "[MouseRight]", target: getConnectionItem("生产 Web") });
    await userEvent.click(screen.getByRole("menuitem", { name: "复制" }));
    expect(screen.getByRole("dialog", { name: "复制 SSH 连接" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "保存连接" }));

    expect(saveSettings).toHaveBeenLastCalledWith({
      ...settings,
      connections: [
        remoteConnection,
        {
          ...remoteConnection,
          id: expect.stringMatching(/^ssh-/),
        },
      ],
    });
  });

  it("deletes a saved connection from the connection context menu", async () => {
    settings = {
      ...createSettings(),
      connections: [
        remoteConnection,
        { ...remoteConnection, id: "stage-web-01", name: "预发 Web", host: "10.0.0.11" },
      ],
    };

    render(<AppShell />);

    await userEvent.pointer({ keys: "[MouseRight]", target: getConnectionItem("生产 Web") });
    await userEvent.click(screen.getByRole("menuitem", { name: "删除" }));
    expect(screen.getByRole("dialog", { name: "确认删除连接" })).toHaveTextContent(
      "确认删除 生产 Web 连接？该操作不可逆！",
    );

    await userEvent.click(screen.getByRole("button", { name: "确认" }));

    expect(saveSettings).toHaveBeenLastCalledWith({
      ...settings,
      connections: [
        { ...remoteConnection, id: "stage-web-01", name: "预发 Web", host: "10.0.0.11" },
      ],
    });
  });

  it("shows workspace tab context close actions", async () => {
    settings = {
      ...createSettings(),
      connections: [
        remoteConnection,
        { ...remoteConnection, id: "stage-web-01", name: "预发 Web", host: "10.0.0.11" },
      ],
    };

    render(<AppShell />);

    await userEvent.dblClick(screen.getByText("生产 Web").closest("li") as HTMLElement);
    await userEvent.dblClick(screen.getByText("预发 Web").closest("li") as HTMLElement);

    await userEvent.pointer({
      keys: "[MouseRight]",
      target: within(screen.getByLabelText("工作区标签")).getByRole("button", { name: "预发 Web" }),
    });

    expect(screen.getByRole("menuitem", { name: "关闭" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "关闭其他" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "关闭左侧" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "关闭右侧" })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("menuitem", { name: "关闭左侧" }));

    expect(screen.queryByRole("button", { name: "生产 Web" })).not.toBeInTheDocument();
    expect(within(screen.getByLabelText("工作区标签")).getByRole("button", { name: "预发 Web" })).toBeInTheDocument();
  });

  it("splits a tab to the right and opens new connections in the focused pane", async () => {
    settings = {
      ...createSettings(),
      connections: [
        remoteConnection,
        { ...remoteConnection, id: "stage-web-01", name: "预发 Web", host: "10.0.0.11" },
      ],
    };

    render(<AppShell />);

    await userEvent.dblClick(screen.getByText("生产 Web").closest("li") as HTMLElement);
    await userEvent.pointer({
      keys: "[MouseRight]",
      target: within(screen.getAllByLabelText("工作区标签")[0]).getByRole("button", { name: "生产 Web" }),
    });
    await userEvent.click(screen.getByRole("menuitem", { name: "向右拆分" }));

    let panes = screen.getAllByLabelText(/^工作区面板/);
    expect(panes).toHaveLength(2);

    await userEvent.click(panes[1]);
    await userEvent.dblClick(screen.getByText("预发 Web").closest("li") as HTMLElement);

    panes = screen.getAllByLabelText(/^工作区面板/);
    expect(within(panes[1]).getByRole("button", { name: "预发 Web" })).toHaveAttribute("aria-pressed", "true");
    expect(within(panes[0]).queryByRole("button", { name: "预发 Web" })).not.toBeInTheDocument();
  });

  it("splits only the target pane down without changing existing right splits", async () => {
    settings = {
      ...createSettings(),
      connections: [remoteConnection],
    };

    render(<AppShell />);

    await userEvent.dblClick(screen.getByText("生产 Web").closest("li") as HTMLElement);
    await userEvent.pointer({
      keys: "[MouseRight]",
      target: within(screen.getAllByLabelText("工作区标签")[0]).getByRole("button", { name: "生产 Web" }),
    });
    await userEvent.click(screen.getByRole("menuitem", { name: "向右拆分" }));

    await userEvent.pointer({
      keys: "[MouseRight]",
      target: within(screen.getAllByLabelText(/^工作区面板/)[0]).getByRole("button", { name: "生产 Web" }),
    });
    await userEvent.click(screen.getByRole("menuitem", { name: "向下拆分" }));

    const panes = screen.getAllByLabelText(/^工作区面板/);
    expect(panes).toHaveLength(3);
    expect(screen.getByLabelText("工作区面板 1")).toHaveStyle({ left: "0%", top: "0%", width: "50%", height: "50%" });
    expect(screen.getByLabelText("工作区面板 2")).toHaveStyle({ left: "50%", top: "0%", width: "50%", height: "100%" });
    expect(screen.getByLabelText("工作区面板 3")).toHaveStyle({ left: "0%", top: "50%", width: "50%", height: "50%" });
  });

  it("expands the sibling pane after closing the bottom pane in a split column", async () => {
    settings = {
      ...createSettings(),
      connections: [remoteConnection],
    };

    render(<AppShell />);

    await userEvent.dblClick(screen.getByText("生产 Web").closest("li") as HTMLElement);
    await userEvent.pointer({
      keys: "[MouseRight]",
      target: within(screen.getAllByLabelText("工作区标签")[0]).getByRole("button", { name: "生产 Web" }),
    });
    await userEvent.click(screen.getByRole("menuitem", { name: "向右拆分" }));

    await userEvent.pointer({
      keys: "[MouseRight]",
      target: within(screen.getAllByLabelText(/^工作区面板/)[0]).getByRole("button", { name: "生产 Web" }),
    });
    await userEvent.click(screen.getByRole("menuitem", { name: "向下拆分" }));

    await userEvent.pointer({
      keys: "[MouseRight]",
      target: screen.getByRole("button", { name: "生产 Web 2" }),
    });
    await userEvent.click(screen.getByRole("menuitem", { name: "向下拆分" }));

    expect(screen.getAllByLabelText(/^工作区面板/)).toHaveLength(4);
    expect(screen.getByLabelText("工作区面板 2")).toHaveStyle({ left: "50%", top: "0%", width: "50%", height: "50%" });
    expect(screen.getByLabelText("工作区面板 4")).toHaveStyle({ left: "50%", top: "50%", width: "50%", height: "50%" });

    await userEvent.click(screen.getByRole("button", { name: /关闭 生产 Web 4/ }));

    expect(screen.getAllByLabelText(/^工作区面板/)).toHaveLength(3);
    expect(screen.getByLabelText("工作区面板 2")).toHaveStyle({ left: "50%", top: "0%", width: "50%", height: "100%" });
  });

  it("expands the top-left pane after closing the bottom-left pane", async () => {
    settings = {
      ...createSettings(),
      connections: [remoteConnection],
    };

    render(<AppShell />);

    await userEvent.dblClick(screen.getByText("生产 Web").closest("li") as HTMLElement);
    await userEvent.pointer({
      keys: "[MouseRight]",
      target: within(screen.getAllByLabelText("工作区标签")[0]).getByRole("button", { name: "生产 Web" }),
    });
    await userEvent.click(screen.getByRole("menuitem", { name: "向右拆分" }));

    await userEvent.pointer({
      keys: "[MouseRight]",
      target: within(screen.getAllByLabelText(/^工作区面板/)[0]).getByRole("button", { name: "生产 Web" }),
    });
    await userEvent.click(screen.getByRole("menuitem", { name: "向下拆分" }));

    await userEvent.pointer({
      keys: "[MouseRight]",
      target: screen.getByRole("button", { name: "生产 Web 2" }),
    });
    await userEvent.click(screen.getByRole("menuitem", { name: "向下拆分" }));

    expect(screen.getAllByLabelText(/^工作区面板/)).toHaveLength(4);
    await userEvent.click(screen.getByRole("button", { name: /关闭 生产 Web 3/ }));

    expect(screen.getAllByLabelText(/^工作区面板/)).toHaveLength(3);
    expect(screen.getByLabelText("工作区面板 1")).toHaveStyle({ left: "0%", top: "0%", width: "50%", height: "100%" });
  });

  it("resizes a visible terminal after its pane expands when another pane closes", async () => {
    settings = {
      ...createSettings(),
      connections: [remoteConnection],
    };

    render(<AppShell />);

    await userEvent.dblClick(screen.getByText("生产 Web").closest("li") as HTMLElement);
    await userEvent.pointer({
      keys: "[MouseRight]",
      target: within(screen.getAllByLabelText("工作区标签")[0]).getByRole("button", { name: "生产 Web" }),
    });
    await userEvent.click(screen.getByRole("menuitem", { name: "向右拆分" }));

    await userEvent.pointer({
      keys: "[MouseRight]",
      target: within(screen.getAllByLabelText(/^工作区面板/)[0]).getByRole("button", { name: "生产 Web" }),
    });
    await userEvent.click(screen.getByRole("menuitem", { name: "向下拆分" }));

    await userEvent.pointer({
      keys: "[MouseRight]",
      target: screen.getByRole("button", { name: "生产 Web 2" }),
    });
    await userEvent.click(screen.getByRole("menuitem", { name: "向下拆分" }));

    await waitFor(() => {
      expect(callBackendMock.mock.calls.filter(([command]) => command === "open_terminal")).toHaveLength(4);
    });
    callBackendMock.mockClear();

    await userEvent.click(screen.getByRole("button", { name: /关闭 生产 Web 3/ }));

    await waitFor(() => {
      expect(callBackendMock).toHaveBeenCalledWith("resize_terminal", {
        request: { session_id: "session-1", cols: expect.any(Number), rows: expect.any(Number) },
      });
    });
  });

  it("removes a split pane after its last tab closes", async () => {
    settings = {
      ...createSettings(),
      connections: [remoteConnection],
    };

    render(<AppShell />);

    await userEvent.dblClick(screen.getByText("生产 Web").closest("li") as HTMLElement);
    await userEvent.pointer({
      keys: "[MouseRight]",
      target: within(screen.getAllByLabelText("工作区标签")[0]).getByRole("button", { name: "生产 Web" }),
    });
    await userEvent.click(screen.getByRole("menuitem", { name: "向右拆分" }));

    expect(screen.getAllByLabelText(/^工作区面板/)).toHaveLength(2);
    await userEvent.click(within(screen.getAllByLabelText(/^工作区面板/)[1]).getByRole("button", { name: /关闭 生产 Web/ }));

    expect(screen.getAllByLabelText(/^工作区面板/)).toHaveLength(1);
  });

  it("keeps existing terminal sessions mounted when splitting a tab", async () => {
    settings = {
      ...createSettings(),
      connections: [remoteConnection],
    };

    render(<AppShell />);

    await userEvent.dblClick(screen.getByText("生产 Web").closest("li") as HTMLElement);

    await waitFor(() => {
      expect(callBackendMock).toHaveBeenCalledWith("open_terminal", expect.anything());
    });
    callBackendMock.mockClear();

    await userEvent.pointer({
      keys: "[MouseRight]",
      target: within(screen.getAllByLabelText("工作区标签")[0]).getByRole("button", { name: "生产 Web" }),
    });
    await userEvent.click(screen.getByRole("menuitem", { name: "向右拆分" }));

    await waitFor(() => {
      expect(callBackendMock.mock.calls.filter(([command]) => command === "open_terminal")).toHaveLength(1);
    });
  });

  it("moves a terminal tab to another workspace pane without reconnecting", async () => {
    settings = {
      ...createSettings(),
      connections: [remoteConnection],
    };

    render(<AppShell />);

    await userEvent.dblClick(screen.getByText("生产 Web").closest("li") as HTMLElement);
    await userEvent.pointer({
      keys: "[MouseRight]",
      target: within(screen.getAllByLabelText("工作区标签")[0]).getByRole("button", { name: "生产 Web" }),
    });
    await userEvent.click(screen.getByRole("menuitem", { name: "向右拆分" }));

    await waitFor(() => {
      expect(callBackendMock.mock.calls.filter(([command]) => command === "open_terminal")).toHaveLength(2);
    });

    const sourceTabList = screen.getAllByLabelText("工作区标签")[0];
    const targetTabList = screen.getAllByLabelText("工作区标签")[1];
    const movedTabButton = within(sourceTabList).getByRole("button", { name: "生产 Web" });
    Object.defineProperty(document, "elementFromPoint", {
      configurable: true,
      value: vi.fn().mockReturnValue(targetTabList),
    });
    callBackendMock.mockClear();

    fireEvent.pointerDown(movedTabButton, { clientX: 12, clientY: 12, pointerId: 1, button: 0 });
    fireEvent.pointerMove(window, { clientX: 72, clientY: 12, pointerId: 1 });
    fireEvent.pointerUp(window, { clientX: 720, clientY: 12, pointerId: 1 });

    expect(within(sourceTabList).queryByRole("button", { name: "生产 Web" })).not.toBeInTheDocument();
    expect(within(targetTabList).getByRole("button", { name: "生产 Web" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getAllByLabelText(/^工作区面板/)).toHaveLength(1);
    expect(callBackendMock.mock.calls.filter(([command]) => command === "open_terminal")).toHaveLength(0);
    expect(callBackendMock.mock.calls.filter(([command]) => command === "close_terminal")).toHaveLength(0);
  });

  it("reorders tabs inside the same workspace pane by dropping before another tab", async () => {
    settings = {
      ...createSettings(),
      connections: [remoteConnection],
    };

    render(<AppShell />);

    await userEvent.pointer({ keys: "[MouseRight]", target: getConnectionItem("生产 Web") });
    await userEvent.click(screen.getByRole("menuitem", { name: "连接" }));
    await userEvent.pointer({ keys: "[MouseRight]", target: getConnectionItem("生产 Web") });
    await userEvent.click(screen.getByRole("menuitem", { name: "新标签连接" }));
    await userEvent.pointer({ keys: "[MouseRight]", target: getConnectionItem("生产 Web") });
    await userEvent.click(screen.getByRole("menuitem", { name: "新标签连接" }));

    const tabList = screen.getByLabelText("工作区标签");
    const firstTab = within(tabList).getByRole("button", { name: "生产 Web" }).closest(".workspace-tab") as HTMLElement;
    const thirdTabButton = within(tabList).getByRole("button", { name: "生产 Web 3" });
    firstTab.getBoundingClientRect = () => ({ left: 10, right: 110, top: 0, bottom: 36, width: 100, height: 36, x: 10, y: 0, toJSON: () => ({}) });
    Object.defineProperty(document, "elementFromPoint", {
      configurable: true,
      value: vi.fn().mockReturnValue(firstTab),
    });

    fireEvent.pointerDown(thirdTabButton, { clientX: 260, clientY: 12, pointerId: 1, button: 0 });
    fireEvent.pointerMove(window, { clientX: 40, clientY: 12, pointerId: 1 });
    expect(document.querySelector(".workspace-tab-drag-preview")).toHaveTextContent("生产 Web 3");
    expect(document.querySelector(".workspace-tab-drop-indicator")).toBeInTheDocument();
    fireEvent.pointerUp(window, { clientX: 40, clientY: 12, pointerId: 1 });

    expect(within(tabList).getAllByRole("button", { name: /^生产 Web/ }).map((button) => button.textContent)).toEqual([
      "生产 Web 3",
      "生产 Web",
      "生产 Web 2",
    ]);
    expect(document.querySelector(".workspace-tab-drag-preview")).not.toBeInTheDocument();
  });

  it("keeps tab order unchanged when dropping a dragged tab outside tab bars", async () => {
    settings = {
      ...createSettings(),
      connections: [remoteConnection],
    };

    render(<AppShell />);

    await userEvent.pointer({ keys: "[MouseRight]", target: getConnectionItem("生产 Web") });
    await userEvent.click(screen.getByRole("menuitem", { name: "连接" }));
    await userEvent.pointer({ keys: "[MouseRight]", target: getConnectionItem("生产 Web") });
    await userEvent.click(screen.getByRole("menuitem", { name: "新标签连接" }));

    const tabList = screen.getByLabelText("工作区标签");
    const secondTabButton = within(tabList).getByRole("button", { name: "生产 Web 2" });
    Object.defineProperty(document, "elementFromPoint", {
      configurable: true,
      value: vi.fn().mockReturnValue(screen.getByLabelText("工作区")),
    });

    fireEvent.pointerDown(secondTabButton, { clientX: 160, clientY: 12, pointerId: 1, button: 0 });
    fireEvent.pointerMove(window, { clientX: 500, clientY: 500, pointerId: 1 });
    fireEvent.pointerUp(window, { clientX: 500, clientY: 500, pointerId: 1 });

    expect(within(tabList).getAllByRole("button", { name: /^生产 Web/ }).map((button) => button.textContent)).toEqual([
      "生产 Web",
      "生产 Web 2",
    ]);
    expect(document.querySelector(".workspace-tab-drop-indicator")).not.toBeInTheDocument();
  });

  it("inserts a dragged tab before a target tab in another workspace pane", async () => {
    settings = {
      ...createSettings(),
      connections: [remoteConnection],
    };

    render(<AppShell />);

    await userEvent.dblClick(screen.getByText("生产 Web").closest("li") as HTMLElement);
    await userEvent.pointer({
      keys: "[MouseRight]",
      target: within(screen.getAllByLabelText("工作区标签")[0]).getByRole("button", { name: "生产 Web" }),
    });
    await userEvent.click(screen.getByRole("menuitem", { name: "向右拆分" }));
    await userEvent.pointer({ keys: "[MouseRight]", target: getConnectionItem("生产 Web") });
    await userEvent.click(screen.getByRole("menuitem", { name: "新标签连接" }));

    const sourceTabList = screen.getAllByLabelText("工作区标签")[0];
    const targetTabList = screen.getAllByLabelText("工作区标签")[1];
    const targetFirstTab = within(targetTabList).getByRole("button", { name: "生产 Web 2" }).closest(".workspace-tab") as HTMLElement;
    const movedTabButton = within(sourceTabList).getByRole("button", { name: "生产 Web" });
    targetFirstTab.getBoundingClientRect = () => ({ left: 410, right: 510, top: 0, bottom: 36, width: 100, height: 36, x: 410, y: 0, toJSON: () => ({}) });
    Object.defineProperty(document, "elementFromPoint", {
      configurable: true,
      value: vi.fn().mockReturnValue(targetFirstTab),
    });

    fireEvent.pointerDown(movedTabButton, { clientX: 12, clientY: 12, pointerId: 1, button: 0 });
    fireEvent.pointerMove(window, { clientX: 430, clientY: 12, pointerId: 1 });
    fireEvent.pointerUp(window, { clientX: 430, clientY: 12, pointerId: 1 });

    expect(within(targetTabList).getAllByRole("button", { name: /^生产 Web/ }).map((button) => button.textContent)).toEqual([
      "生产 Web",
      "生产 Web 2",
      "生产 Web 3",
    ]);
  });

  it("does not reconnect terminal tabs when moving them between populated split panes", async () => {
    settings = {
      ...createSettings(),
      connections: [remoteConnection],
    };

    render(<AppShell />);

    await userEvent.pointer({ keys: "[MouseRight]", target: getConnectionItem("生产 Web") });
    await userEvent.click(screen.getByRole("menuitem", { name: "连接" }));
    await userEvent.pointer({
      keys: "[MouseRight]",
      target: within(screen.getAllByLabelText("工作区标签")[0]).getByRole("button", { name: "生产 Web" }),
    });
    await userEvent.click(screen.getByRole("menuitem", { name: "向右拆分" }));
    await userEvent.pointer({
      keys: "[MouseRight]",
      target: within(screen.getAllByLabelText("工作区标签")[0]).getByRole("button", { name: "生产 Web" }),
    });
    await userEvent.click(screen.getByRole("menuitem", { name: "向右拆分" }));

    await waitFor(() => {
      expect(callBackendMock.mock.calls.filter(([command]) => command === "open_terminal")).toHaveLength(3);
    });
    const initialPanelOrder = Array.from(document.querySelectorAll("[data-workspace-tab-panel-id]")).map((element) =>
      element.getAttribute("data-workspace-tab-panel-id"),
    );
    callBackendMock.mockClear();

    const tabListWith = (title: string) => {
      const tabList = screen.getAllByLabelText("工作区标签").find((item) => within(item).queryByRole("button", { name: title }));
      if (!tabList) throw new Error(`missing tab list for ${title}`);
      return tabList;
    };

    const secondTabList = tabListWith("生产 Web 2");
    const thirdTabList = tabListWith("生产 Web 3");
    const secondTabButton = within(secondTabList).getByRole("button", { name: "生产 Web 2" });
    Object.defineProperty(document, "elementFromPoint", {
      configurable: true,
      value: vi.fn().mockReturnValue(thirdTabList),
    });

    fireEvent.pointerDown(secondTabButton, { clientX: 310, clientY: 12, pointerId: 1, button: 0 });
    fireEvent.pointerMove(window, { clientX: 720, clientY: 12, pointerId: 1 });
    fireEvent.pointerUp(window, { clientX: 720, clientY: 12, pointerId: 1 });
    await waitForEffects();

    expect(callBackendMock.mock.calls.filter(([command]) => command === "open_terminal")).toHaveLength(0);
    expect(callBackendMock.mock.calls.filter(([command]) => command === "close_terminal")).toHaveLength(0);
    expect(Array.from(document.querySelectorAll("[data-workspace-tab-panel-id]")).map((element) =>
      element.getAttribute("data-workspace-tab-panel-id"),
    )).toEqual(initialPanelOrder);

    const movedSecondTabButton = within(tabListWith("生产 Web 2")).getByRole("button", { name: "生产 Web 2" });
    const firstPaneFirstTab = within(tabListWith("生产 Web")).getByRole("button", { name: "生产 Web" }).closest(".workspace-tab") as HTMLElement;
    firstPaneFirstTab.getBoundingClientRect = () => ({
      left: 10,
      right: 120,
      top: 0,
      bottom: 36,
      width: 110,
      height: 36,
      x: 10,
      y: 0,
      toJSON: () => ({}),
    });
    Object.defineProperty(document, "elementFromPoint", {
      configurable: true,
      value: vi.fn().mockReturnValue(firstPaneFirstTab),
    });

    fireEvent.pointerDown(movedSecondTabButton, { clientX: 710, clientY: 12, pointerId: 2, button: 0 });
    fireEvent.pointerMove(window, { clientX: 30, clientY: 12, pointerId: 2 });
    fireEvent.pointerUp(window, { clientX: 30, clientY: 12, pointerId: 2 });
    await waitForEffects();

    expect(callBackendMock.mock.calls.filter(([command]) => command === "open_terminal")).toHaveLength(0);
    expect(callBackendMock.mock.calls.filter(([command]) => command === "close_terminal")).toHaveLength(0);
    expect(Array.from(document.querySelectorAll("[data-workspace-tab-panel-id]")).map((element) =>
      element.getAttribute("data-workspace-tab-panel-id"),
    )).toEqual(initialPanelOrder);
  });

  it("uses unique title numbers when splitting the same terminal multiple times", async () => {
    settings = {
      ...createSettings(),
      connections: [remoteConnection],
    };

    render(<AppShell />);

    await userEvent.dblClick(screen.getByText("生产 Web").closest("li") as HTMLElement);
    await userEvent.pointer({
      keys: "[MouseRight]",
      target: within(screen.getAllByLabelText("工作区标签")[0]).getByRole("button", { name: "生产 Web" }),
    });
    await userEvent.click(screen.getByRole("menuitem", { name: "向右拆分" }));

    await userEvent.pointer({
      keys: "[MouseRight]",
      target: within(screen.getAllByLabelText("工作区标签")[0]).getByRole("button", { name: "生产 Web" }),
    });
    await userEvent.click(screen.getByRole("menuitem", { name: "向右拆分" }));

    expect(screen.getByRole("button", { name: "生产 Web 2" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "生产 Web 3" })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "生产 Web 3" })).toHaveLength(1);
  });

  it("shows empty workspace context actions for settings and connection panel", async () => {
    render(<AppShell />);

    await userEvent.click(screen.getByRole("button", { name: "切换连接面板" }));
    expect(screen.queryByLabelText("连接列表")).not.toBeInTheDocument();

    await userEvent.pointer({ keys: "[MouseRight]", target: screen.getByText("未打开标签").closest("section") as HTMLElement });

    expect(screen.getByRole("menuitem", { name: "打开设置" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "显示连接面板" })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("menuitem", { name: "显示连接面板" }));
    expect(screen.getByLabelText("连接列表")).toBeInTheDocument();

    await userEvent.pointer({ keys: "[MouseRight]", target: screen.getByText("未打开标签").closest("section") as HTMLElement });
    await userEvent.click(screen.getByRole("menuitem", { name: "打开设置" }));
    expect(screen.getByLabelText("设置分类")).toBeInTheDocument();
  });

  it("prevents the browser context menu in areas without custom context actions", () => {
    render(<AppShell />);

    const event = new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
    });
    screen.getByLabelText("命令面板").dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });
});
