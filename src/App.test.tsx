import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import App from "./App";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue({
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

  expect(screen.getByLabelText("连接列表")).toBeInTheDocument();
  expect(screen.getByLabelText("工作区")).toBeInTheDocument();
  expect(screen.queryByLabelText("设置分类")).not.toBeInTheDocument();
  expect(screen.getByLabelText("工作区标签")).toBeEmptyDOMElement();
  expect(screen.getByText("未打开标签")).toBeInTheDocument();
});
