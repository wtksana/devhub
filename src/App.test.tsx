import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import App from "./App";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue({
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
  }),
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    minimize: vi.fn(),
    toggleMaximize: vi.fn(),
    close: vi.fn(),
  }),
}));

test("renders app shell", () => {
  render(<App />);

  expect(screen.getByLabelText("Connections")).toBeInTheDocument();
  expect(screen.getByLabelText("Workspace")).toBeInTheDocument();
  expect(screen.queryByLabelText("Settings categories")).not.toBeInTheDocument();
  expect(screen.getByLabelText("Workspace tabs")).toBeEmptyDOMElement();
  expect(screen.getByText("No tabs open")).toBeInTheDocument();
});
