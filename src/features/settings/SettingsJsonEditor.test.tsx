import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SettingsJsonEditor } from "./SettingsJsonEditor";
import type { DevHubSettings } from "./settingsTypes";

const { editorMock } = vi.hoisted(() => ({
  editorMock: vi.fn((props: { options: { fontFamily?: string; fontSize?: number } }) => (
    <div data-testid="monaco-editor" data-font-family={props.options.fontFamily} data-font-size={props.options.fontSize} />
  )),
}));

vi.mock("@monaco-editor/react", () => ({
  default: editorMock,
}));

const settings: DevHubSettings = {
  appearance: {
    theme: "dark",
    ui_font_family: "Zed Sans",
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

describe("SettingsJsonEditor", () => {
  it("uses 14px and the UI font family in the settings json editor", () => {
    render(<SettingsJsonEditor settings={settings} rawJson="{}" saveRawJson={vi.fn()} />);

    expect(screen.getByTestId("monaco-editor")).toHaveAttribute("data-font-size", "14");
    expect(screen.getByTestId("monaco-editor")).toHaveAttribute("data-font-family", "Zed Sans");
  });
});
