import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsPanel } from "./SettingsPanel";
import type { DevHubSettings } from "./settingsTypes";

const saveSettings = vi.fn();
const listSystemFonts = vi.fn(async () => ["Inter", "Zed Sans", "JetBrains Mono", "Consolas"]);
const settings: DevHubSettings = {
  appearance: {
    theme: "dark",
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
  connections: [],
};

vi.mock("../../lib/tauri", () => ({
  callBackend: (command: string) => {
    if (command === "list_system_fonts") return listSystemFonts();
    throw new Error(`unexpected command: ${command}`);
  },
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
  });

  it("shows appearance, layout, and connection sections", () => {
    render(<SettingsPanel />);

    expect(screen.getByRole("heading", { name: "外观" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "布局" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "连接" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "AI" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "settings.json" })).toBeInTheDocument();
    expect(screen.queryByText("User")).not.toBeInTheDocument();
  });

  it("saves typed input edits after the field loses focus", async () => {
    render(<SettingsPanel />);

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

  it("loads system fonts for UI and terminal font selection", async () => {
    render(<SettingsPanel />);

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
    render(<SettingsPanel />);

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

    render(<SettingsPanel />);

    await userEvent.click(within(screen.getByLabelText("设置分类")).getByRole("button", { name: "连接" }));

    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth", block: "start" });
    expect(within(screen.getByLabelText("设置分类")).getByRole("button", { name: "连接" })).toHaveAttribute("aria-pressed", "true");
  });

  it("scrolls to settings json when clicking the edit button", async () => {
    const scrollIntoView = vi.fn();
    window.HTMLElement.prototype.scrollIntoView = scrollIntoView;

    render(<SettingsPanel />);

    await userEvent.click(screen.getByRole("button", { name: "Edit in settings.json" }));

    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth", block: "start" });
    expect(within(screen.getByLabelText("设置分类")).getByRole("button", { name: "settings.json" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("saves layout panel widths after blur", async () => {
    render(<SettingsPanel />);

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
    render(<SettingsPanel />);

    await userEvent.selectOptions(screen.getByLabelText("SFTP 文件大小单位"), "auto");

    expect(saveSettings).toHaveBeenLastCalledWith({
      ...settings,
      sftp: {
        file_size_unit: "auto",
      },
    });
  });
});
