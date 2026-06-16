import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SettingsPanel } from "./SettingsPanel";

vi.mock("./useSettings", () => ({
  useSettings: () => ({
    settings: {
      appearance: {
        theme: "dark",
        ui_font_family: "Inter",
        terminal_font_family: "JetBrains Mono",
        terminal_font_size: 14,
      },
      layout: {
        ai_panel: "right",
        connection_sidebar_width: 280,
        open_ai_panel_by_default: true,
      },
      connections: [],
      ai: {
        provider: "openai_compatible",
        base_url: "https://api.openai.com/v1",
        model: "gpt-4.1",
        api_key_ref: "ai:default",
      },
    },
    rawJson: "{}",
    error: null,
    saveRawJson: vi.fn(),
    reload: vi.fn(),
  }),
}));

describe("SettingsPanel", () => {
  it("shows appearance, layout, connections, and AI sections", () => {
    render(<SettingsPanel />);

    expect(screen.getByText("外观")).toBeInTheDocument();
    expect(screen.getByText("布局")).toBeInTheDocument();
    expect(screen.getByText("连接")).toBeInTheDocument();
    expect(screen.getByText("AI")).toBeInTheDocument();
    expect(screen.getByText("settings.json")).toBeInTheDocument();
  });
});
