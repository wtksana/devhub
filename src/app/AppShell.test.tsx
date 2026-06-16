import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AppShell } from "./AppShell";

vi.mock("../features/settings/useSettings", () => ({
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

describe("AppShell", () => {
  it("renders Zed-style dock, workspace, assistant, command, and status regions", () => {
    render(<AppShell />);

    expect(screen.getByLabelText("连接列表")).toBeInTheDocument();
    expect(screen.getByLabelText("工作区")).toBeInTheDocument();
    expect(screen.getByLabelText("AI 面板")).toBeInTheDocument();
    expect(screen.getByLabelText("命令面板")).toBeInTheDocument();
    expect(screen.getByLabelText("状态栏")).toBeInTheDocument();
  });
});
