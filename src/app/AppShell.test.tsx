import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppShell } from "./AppShell";
import type { DevHubSettings } from "../features/settings/settingsTypes";
import { callBackend } from "../lib/tauri";

let settings: DevHubSettings;
const saveSettings = vi.fn();
const callBackendMock = vi.mocked(callBackend);

function createSettings(): DevHubSettings {
  return {
    appearance: {
      theme: "dark",
      ui_font_family: "Inter",
      ui_font_size: 13,
      terminal_font_family: "JetBrains Mono",
      terminal_font_size: 14,
    },
    layout: {
      connection_sidebar_width: 280,
    },
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
  listenBackend: vi.fn().mockResolvedValue(vi.fn()),
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
    settings = createSettings();
    saveSettings.mockClear();
    callBackendMock.mockClear();
    callBackendMock.mockResolvedValue({ session_id: "session-1" });
  });

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

  it("applies appearance settings to the shell immediately", () => {
    settings = {
      ...createSettings(),
      appearance: {
        theme: "light",
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
      "--ui-font-size": "15px",
      "--ui-font-size-small": "14px",
      "--ui-font-size-large": "17px",
      "--terminal-font-family": "Maple Mono",
      "--terminal-font-size": "16px",
      "--connection-sidebar-width": "280px",
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
});
