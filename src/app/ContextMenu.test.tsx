import "@testing-library/jest-dom/vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ContextMenu } from "./ContextMenu";

describe("ContextMenu", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("keeps submenu panels hidden until hover or focus styles reveal them", () => {
    render(
      <ContextMenu
        menu={{
          x: 12,
          y: 24,
          items: [
            {
              type: "submenu",
              label: "移动到分组",
              items: [{ label: "aliyun", onSelect: vi.fn() }],
            },
          ],
        }}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByRole("menuitem", { name: "移动到分组" })).toBeInTheDocument();
    expect(screen.getByLabelText("移动到分组 子菜单")).toHaveAttribute("data-visible-on-hover", "true");
    expect(screen.getByText("移动到分组").closest(".context-menu__submenu")).toHaveAttribute("data-hover-bridge", "true");
    expect(screen.getByLabelText("移动到分组 子菜单")).toHaveClass("context-menu__submenu-panel");
  });

  it("keeps the root menu inside the viewport near the bottom edge", async () => {
    const originalInnerHeight = window.innerHeight;
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 120 });
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 300 });

    render(
      <ContextMenu
        menu={{
          x: 80,
          y: 100,
          items: [
            { label: "连接", onSelect: vi.fn() },
            { label: "新标签连接", onSelect: vi.fn() },
            { label: "SFTP", onSelect: vi.fn() },
            { label: "编辑", onSelect: vi.fn() },
          ],
        }}
        onClose={vi.fn()}
      />,
    );

    const menu = screen.getByRole("menuitem", { name: "连接" }).closest(".context-menu") as HTMLElement;
    vi.spyOn(menu, "getBoundingClientRect").mockReturnValue({
      x: 80,
      y: 100,
      width: 140,
      height: 110,
      top: 100,
      right: 220,
      bottom: 210,
      left: 80,
      toJSON: () => ({}),
    });

    await act(async () => {
      window.dispatchEvent(new Event("resize"));
    });

    expect(menu).toHaveStyle({ top: "8px" });
    expect(menu.style.maxHeight).toBe("");

    Object.defineProperty(window, "innerHeight", { configurable: true, value: originalInnerHeight });
  });

  it("keeps submenu panels inside the viewport near the bottom edge", async () => {
    const originalInnerHeight = window.innerHeight;
    const originalInnerWidth = window.innerWidth;
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 160 });
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 420 });

    render(
      <ContextMenu
        menu={{
          x: 120,
          y: 60,
          items: [
            {
              type: "submenu",
              label: "移动到分组",
              items: [
                { label: "未分组", onSelect: vi.fn() },
                { label: "IDC", onSelect: vi.fn() },
                { label: "测试", onSelect: vi.fn() },
              ],
            },
          ],
        }}
        onClose={vi.fn()}
      />,
    );

    const submenu = screen.getByText("移动到分组").closest(".context-menu__submenu") as HTMLElement;
    const panel = screen.getByLabelText("移动到分组 子菜单");
    vi.spyOn(submenu, "getBoundingClientRect").mockReturnValue({
      x: 220,
      y: 130,
      width: 120,
      height: 26,
      top: 130,
      right: 340,
      bottom: 156,
      left: 220,
      toJSON: () => ({}),
    });
    vi.spyOn(panel, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      width: 120,
      height: 100,
      top: 0,
      right: 120,
      bottom: 100,
      left: 0,
      toJSON: () => ({}),
    });

    await act(async () => {
      window.dispatchEvent(new Event("resize"));
    });

    expect(panel).toHaveStyle({ top: "-78px" });

    Object.defineProperty(window, "innerHeight", { configurable: true, value: originalInnerHeight });
    Object.defineProperty(window, "innerWidth", { configurable: true, value: originalInnerWidth });
  });

  it("keeps submenu panels inside the viewport near the right edge", async () => {
    const originalInnerHeight = window.innerHeight;
    const originalInnerWidth = window.innerWidth;
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 300 });
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 260 });

    render(
      <ContextMenu
        menu={{
          x: 80,
          y: 40,
          items: [
            {
              type: "submenu",
              label: "移动到分组",
              items: [{ label: "未分组", onSelect: vi.fn() }],
            },
          ],
        }}
        onClose={vi.fn()}
      />,
    );

    const submenu = screen.getByText("移动到分组").closest(".context-menu__submenu") as HTMLElement;
    const panel = screen.getByLabelText("移动到分组 子菜单");
    vi.spyOn(submenu, "getBoundingClientRect").mockReturnValue({
      x: 170,
      y: 80,
      width: 80,
      height: 26,
      top: 80,
      right: 250,
      bottom: 106,
      left: 170,
      toJSON: () => ({}),
    });
    vi.spyOn(panel, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      width: 100,
      height: 40,
      top: 0,
      right: 100,
      bottom: 40,
      left: 0,
      toJSON: () => ({}),
    });

    await act(async () => {
      window.dispatchEvent(new Event("resize"));
    });

    expect(panel).toHaveStyle({ left: "-18px" });

    Object.defineProperty(window, "innerHeight", { configurable: true, value: originalInnerHeight });
    Object.defineProperty(window, "innerWidth", { configurable: true, value: originalInnerWidth });
  });

  it("renders nested submenu items recursively", () => {
    render(
      <ContextMenu
        menu={{
          x: 12,
          y: 24,
          items: [
            {
              type: "submenu",
              label: "移动到分组",
              items: [
                {
                  type: "submenu",
                  label: "更多分组",
                  items: [{ label: "三级项", onSelect: vi.fn() }],
                },
              ],
            },
          ],
        }}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByRole("menuitem", { name: "更多分组" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "三级项" })).toBeInTheDocument();
  });
});
