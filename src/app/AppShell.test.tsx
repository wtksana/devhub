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
