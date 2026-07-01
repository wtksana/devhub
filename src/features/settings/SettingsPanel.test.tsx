import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsPanel } from "./SettingsPanel";
import type { DevHubSettings } from "./settingsTypes";
import { I18nProvider } from "../../i18n/I18nProvider";

const saveSettings = vi.fn();
const listSystemFonts = vi.fn(async () => ["Inter", "Zed Sans", "JetBrains Mono", "Consolas"]);
const callBackendMock = vi.fn((command: string) => {
  if (command === "list_system_fonts") return listSystemFonts();
  if (command === "open_log_directory") return Promise.resolve();
  if (command === "get_log_directory") return Promise.resolve("C:\\Users\\ttat\\AppData\\Roaming\\devhub\\logs");
  throw new Error(`unexpected command: ${command}`);
});
const settings: DevHubSettings = {
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

vi.mock("../../lib/tauri", () => ({
  callBackend: (command: string, _args?: Record<string, unknown>) => callBackendMock(command),
}));

vi.mock("./useSettings", () => ({
  useSettings: () => ({
    settings,
    rawJson: "{}",
    error: null,
    saveSettings,
    saveRawJson: vi.fn(),
    reload: vi.fn(),
  }),
}));

describe("SettingsPanel", () => {
  beforeEach(() => {
    cleanup();
    saveSettings.mockClear();
    listSystemFonts.mockClear();
    callBackendMock.mockClear();
    window.localStorage.clear();
  });

  function renderSettingsPanel() {
    return render(
      <I18nProvider language={settings.appearance.language}>
        <SettingsPanel />
      </I18nProvider>,
    );
  }

  it("shows appearance, layout, and connection sections", () => {
    renderSettingsPanel();

    expect(screen.getByRole("heading", { name: "外观" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "布局" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "连接" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "AI" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "settings.json" })).toBeInTheDocument();
    expect(screen.queryByText("User")).not.toBeInTheDocument();
  });

  it("saves typed input edits after the field loses focus", async () => {
    renderSettingsPanel();

    await userEvent.selectOptions(screen.getByLabelText("主题"), "system");

    expect(saveSettings).toHaveBeenCalledWith({
      ...settings,
      appearance: {
        ...settings.appearance,
        theme: "system",
      },
    });
    expect(saveSettings).toHaveBeenCalledTimes(1);

    await within(screen.getByLabelText("界面字体")).findByRole("option", { name: "Zed Sans" });
    await userEvent.selectOptions(screen.getByLabelText("界面字体"), "Zed Sans");

    expect(saveSettings).toHaveBeenLastCalledWith({
      ...settings,
      appearance: {
        ...settings.appearance,
        theme: "system",
        ui_font_family: "Zed Sans",
      },
    });
  });

  it("saves the selected UI language", async () => {
    renderSettingsPanel();

    await userEvent.selectOptions(screen.getByLabelText("语言"), "en-US");

    expect(saveSettings).toHaveBeenLastCalledWith({
      ...settings,
      appearance: {
        ...settings.appearance,
        language: "en-US",
      },
    });
  });

  it("loads system fonts for UI and terminal font selection", async () => {
    renderSettingsPanel();

    await within(screen.getByLabelText("界面字体")).findByRole("option", { name: "Zed Sans" });

    expect(listSystemFonts).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText("界面字体")).toHaveDisplayValue("Consolas");
    expect(screen.getByLabelText("终端字体")).toHaveDisplayValue("Consolas");

    await userEvent.selectOptions(screen.getByLabelText("终端字体"), "Consolas");

    expect(saveSettings).toHaveBeenLastCalledWith({
      ...settings,
      appearance: {
        ...settings.appearance,
        terminal_font_family: "Consolas",
      },
    });
  });

  it("saves UI font size after blur", async () => {
    renderSettingsPanel();

    await userEvent.clear(screen.getByLabelText("界面字号"));
    await userEvent.type(screen.getByLabelText("界面字号"), "15");

    expect(saveSettings).not.toHaveBeenCalled();

    await userEvent.tab();

    expect(saveSettings).toHaveBeenLastCalledWith({
      ...settings,
      appearance: {
        ...settings.appearance,
        ui_font_size: 15,
      },
    });
  });

  it("scrolls to the matching section when selecting a settings category", async () => {
    const scrollIntoView = vi.fn();
    window.HTMLElement.prototype.scrollIntoView = scrollIntoView;

    renderSettingsPanel();

    await userEvent.click(within(screen.getByLabelText("设置分类")).getByRole("button", { name: "连接" }));

    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth", block: "start" });
    expect(within(screen.getByLabelText("设置分类")).getByRole("button", { name: "连接" })).toHaveAttribute("aria-pressed", "true");
  });

  it("scrolls to settings json when clicking the edit button", async () => {
    const scrollIntoView = vi.fn();
    window.HTMLElement.prototype.scrollIntoView = scrollIntoView;

    renderSettingsPanel();

    await userEvent.click(screen.getByRole("button", { name: "在 settings.json 中编辑" }));

    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth", block: "start" });
    expect(within(screen.getByLabelText("设置分类")).getByRole("button", { name: "settings.json" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("filters settings rows and categories from the search box", async () => {
    renderSettingsPanel();

    await userEvent.type(screen.getByLabelText("搜索设置"), "日志目录");

    expect(screen.getByRole("heading", { name: "日志" })).toBeInTheDocument();
    expect(screen.getByText("启用日志")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "外观" })).not.toBeInTheDocument();
    expect(screen.queryByText("主题")).not.toBeInTheDocument();
    expect(within(screen.getByLabelText("设置分类")).getByRole("button", { name: "日志" })).toBeInTheDocument();
    expect(within(screen.getByLabelText("设置分类")).queryByRole("button", { name: "外观" })).not.toBeInTheDocument();

    await userEvent.clear(screen.getByLabelText("搜索设置"));

    expect(screen.getByRole("heading", { name: "外观" })).toBeInTheDocument();
    expect(within(screen.getByLabelText("设置分类")).getByRole("button", { name: "外观" })).toBeInTheDocument();
  });

  it("saves layout panel widths after blur", async () => {
    renderSettingsPanel();

    expect(screen.queryByLabelText("连接栏宽度")).not.toBeInTheDocument();

    await userEvent.clear(screen.getByLabelText("连接面板宽度"));
    await userEvent.type(screen.getByLabelText("连接面板宽度"), "320");
    await userEvent.tab();

    expect(saveSettings).toHaveBeenLastCalledWith({
      ...settings,
      layout: {
        ...settings.layout,
        connection_sidebar_width: 320,
      },
    });
  });

  it("saves SFTP file size unit changes", async () => {
    renderSettingsPanel();

    await userEvent.selectOptions(screen.getByLabelText("SFTP 文件大小单位"), "auto");

    expect(saveSettings).toHaveBeenLastCalledWith({
      ...settings,
      sftp: {
        file_size_unit: "auto",
      },
    });
  });

  it("saves terminal log highlight settings", async () => {
    renderSettingsPanel();

    await userEvent.click(screen.getByLabelText("自动检测 tail 日志高亮"));
    expect(saveSettings).toHaveBeenLastCalledWith({
      ...settings,
      terminal: {
        ...settings.terminal,
        log_highlight: {
          ...settings.terminal.log_highlight,
          auto_detect_tail: false,
        },
      },
    });

    await userEvent.click(screen.getByLabelText("日志高亮区分大小写"));
    expect(saveSettings).toHaveBeenLastCalledWith({
      ...settings,
      terminal: {
        ...settings.terminal,
        log_highlight: {
          auto_detect_tail: false,
          case_sensitive: true,
          rules: settings.terminal.log_highlight.rules,
        },
      },
    });

    fireEvent.change(screen.getByLabelText("日志高亮规则 1"), { target: { value: "WARN" } });
    fireEvent.blur(screen.getByLabelText("日志高亮规则 1"));
    fireEvent.change(screen.getByLabelText("日志高亮颜色 1"), { target: { value: "#e5c07b" } });

    expect(saveSettings).toHaveBeenLastCalledWith({
      ...settings,
      terminal: {
        ...settings.terminal,
        log_highlight: {
          auto_detect_tail: false,
          case_sensitive: true,
          rules: [{ pattern: "WARN", color: "#e5c07b" }],
        },
      },
    });
  });

  it("adds and removes terminal log highlight rules", async () => {
    renderSettingsPanel();

    await userEvent.click(screen.getByRole("button", { name: "添加日志高亮规则" }));

    expect(saveSettings).toHaveBeenLastCalledWith({
      ...settings,
      terminal: {
        ...settings.terminal,
        log_highlight: {
          ...settings.terminal.log_highlight,
          rules: [
            ...settings.terminal.log_highlight.rules,
            { pattern: "", color: "#56b6c2" },
          ],
        },
      },
    });

    expect(screen.getByLabelText("日志高亮规则 2")).toHaveValue("");

    await userEvent.click(screen.getByRole("button", { name: "删除日志高亮规则 2" }));

    expect(saveSettings).toHaveBeenLastCalledWith({
      ...settings,
      terminal: {
        ...settings.terminal,
        log_highlight: {
          ...settings.terminal.log_highlight,
          rules: settings.terminal.log_highlight.rules,
        },
      },
    });
  });

  it("shows command history opener instead of inline history entries", async () => {
    window.localStorage.setItem(
      "devhub.terminal.commandHistory.prod-web-01",
      JSON.stringify(["nginx -t", "systemctl status nginx"]),
    );
    renderSettingsPanel();

    expect(screen.getByText("终端命令历史")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "查看命令历史" })).toBeInTheDocument();
    expect(screen.queryByText("prod-web-01")).not.toBeInTheDocument();
    expect(screen.queryByText("nginx -t")).not.toBeInTheDocument();
  });

  it("opens command history from the settings terminal section", async () => {
    const onOpenCommandHistory = vi.fn();
    render(
      <I18nProvider language={settings.appearance.language}>
        <SettingsPanel onOpenCommandHistory={onOpenCommandHistory} />
      </I18nProvider>,
    );

    await userEvent.click(screen.getByRole("button", { name: "查看命令历史" }));

    expect(onOpenCommandHistory).toHaveBeenCalledTimes(1);
  });

  it("edits logging settings and opens the log directory", async () => {
    renderSettingsPanel();

    await userEvent.click(within(screen.getByLabelText("设置分类")).getByRole("button", { name: "日志" }));
    await userEvent.click(screen.getByLabelText("启用日志"));
    await userEvent.selectOptions(screen.getByLabelText("日志级别"), "debug");
    await userEvent.clear(screen.getByLabelText("日志保留天数"));
    await userEvent.type(screen.getByLabelText("日志保留天数"), "3");
    await userEvent.tab();
    await userEvent.click(screen.getByLabelText("记录完整 SQL"));
    await userEvent.click(screen.getByRole("button", { name: "打开日志目录" }));

    expect(callBackendMock).toHaveBeenCalledWith("open_log_directory");
    expect(saveSettings).toHaveBeenLastCalledWith({
      ...settings,
      logging: {
        enabled: false,
        level: "debug",
        retention_days: 3,
        include_sql: true,
      },
    });
  });

  it("does not show copy log directory path action", async () => {
    window.HTMLElement.prototype.scrollIntoView = vi.fn();
    renderSettingsPanel();

    await userEvent.click(within(screen.getByLabelText("设置分类")).getByRole("button", { name: "日志" }));

    expect(screen.queryByRole("button", { name: "复制日志目录路径" })).not.toBeInTheDocument();
    expect(callBackendMock).not.toHaveBeenCalledWith("get_log_directory");
  });

  it("shows the log viewer action when an opener is provided", async () => {
    const onOpenLogs = vi.fn();
    render(
      <I18nProvider language={settings.appearance.language}>
        <SettingsPanel onOpenLogs={onOpenLogs} />
      </I18nProvider>,
    );

    await userEvent.click(within(screen.getByLabelText("设置分类")).getByRole("button", { name: "日志" }));
    await userEvent.click(screen.getByRole("button", { name: "查看日志" }));

    expect(onOpenLogs).toHaveBeenCalledTimes(1);
  });
});
