import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import App from "./App";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue({
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
  }),
}));

test("renders settings screen", () => {
  render(<App />);

  expect(screen.getByRole("heading", { name: "设置" })).toBeInTheDocument();
  expect(screen.getByText("settings.json")).toBeInTheDocument();
});
