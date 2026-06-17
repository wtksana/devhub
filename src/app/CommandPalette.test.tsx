import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CommandPalette } from "./CommandPalette";
import { getSafeCurrentWindow } from "./windowRuntime";

vi.mock("./windowRuntime", () => ({
  getSafeCurrentWindow: vi.fn(),
}));

describe("CommandPalette", () => {
  beforeEach(() => {
    cleanup();
    vi.mocked(getSafeCurrentWindow).mockReset();
  });

  it("starts dragging from the top command area", () => {
    const appWindow = {
      startDragging: vi.fn(),
      toggleMaximize: vi.fn(),
    };
    vi.mocked(getSafeCurrentWindow).mockReturnValue(appWindow as never);

    render(<CommandPalette onOpenSettings={vi.fn()} />);

    fireEvent.mouseDown(screen.getByLabelText("命令面板"), { button: 0, detail: 1 });

    expect(appWindow.startDragging).toHaveBeenCalledTimes(1);
  });

  it("does not start dragging when clicking the settings button", () => {
    const appWindow = {
      startDragging: vi.fn(),
      toggleMaximize: vi.fn(),
    };
    const onOpenSettings = vi.fn();
    vi.mocked(getSafeCurrentWindow).mockReturnValue(appWindow as never);

    render(<CommandPalette onOpenSettings={onOpenSettings} />);

    fireEvent.mouseDown(screen.getByRole("button", { name: "打开设置" }), { button: 0, detail: 1 });
    screen.getByRole("button", { name: "打开设置" }).click();

    expect(appWindow.startDragging).not.toHaveBeenCalled();
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
  });

  it("does not start dragging when pressing window controls", () => {
    const appWindow = {
      close: vi.fn(),
      minimize: vi.fn(),
      startDragging: vi.fn(),
      toggleMaximize: vi.fn(),
    };
    vi.mocked(getSafeCurrentWindow).mockReturnValue(appWindow as never);

    render(<CommandPalette onOpenSettings={vi.fn()} />);

    fireEvent.mouseDown(screen.getByRole("button", { name: "最小化窗口" }), { button: 0, detail: 1 });
    screen.getByRole("button", { name: "最小化窗口" }).click();

    expect(appWindow.startDragging).not.toHaveBeenCalled();
    expect(appWindow.minimize).toHaveBeenCalledTimes(1);
  });
});
