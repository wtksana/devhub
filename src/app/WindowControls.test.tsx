import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WindowControls } from "./WindowControls";

const getCurrentWindowMock = vi.fn();

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => getCurrentWindowMock(),
}));

describe("WindowControls", () => {
  beforeEach(() => {
    cleanup();
    getCurrentWindowMock.mockReset();
  });

  it("calls the current window controls in the Tauri runtime", async () => {
    const appWindow = {
      close: vi.fn(),
      minimize: vi.fn(),
      toggleMaximize: vi.fn(),
    };
    getCurrentWindowMock.mockReturnValue(appWindow);

    render(<WindowControls />);

    screen.getByRole("button", { name: "最小化窗口" }).click();
    screen.getByRole("button", { name: "最大化窗口" }).click();
    screen.getByRole("button", { name: "关闭窗口" }).click();

    expect(appWindow.minimize).toHaveBeenCalledTimes(1);
    expect(appWindow.toggleMaximize).toHaveBeenCalledTimes(1);
    expect(appWindow.close).toHaveBeenCalledTimes(1);
  });

  it("does not crash outside the Tauri runtime", () => {
    getCurrentWindowMock.mockImplementation(() => {
      throw new TypeError("Tauri metadata is unavailable");
    });

    render(<WindowControls />);

    expect(screen.getByLabelText("窗口控制")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "最小化窗口" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "最大化窗口" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "关闭窗口" })).toBeDisabled();
  });
});
