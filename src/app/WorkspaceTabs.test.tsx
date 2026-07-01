import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkspaceTabs } from "./WorkspaceTabs";

describe("WorkspaceTabs", () => {
  afterEach(() => {
    cleanup();
  });

  it("marks the tab list as horizontally scrollable without shrinking tabs", () => {
    render(
      <WorkspaceTabs
        paneId="pane-1"
        tabs={Array.from({ length: 12 }, (_, index) => ({
          id: `tab-${index}`,
          title: `连接 ${index}`,
        }))}
        activeTabId="tab-0"
        onSelect={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByLabelText("工作区标签")).toHaveAttribute("data-scrollable", "true");
    expect(screen.getByLabelText("工作区标签")).toHaveAttribute("data-wheel-scroll", "horizontal");
    expect(screen.getByText("连接 0").closest(".workspace-tab")).toHaveAttribute("data-fixed-width", "true");
  });

  it("translates mouse wheel movement into horizontal tab scrolling", () => {
    render(
      <WorkspaceTabs
        paneId="pane-1"
        tabs={Array.from({ length: 12 }, (_, index) => ({
          id: `tab-${index}`,
          title: `连接 ${index}`,
        }))}
        activeTabId="tab-0"
        onSelect={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    const tabList = screen.getByLabelText("工作区标签");
    fireEvent.wheel(tabList, { deltaY: 120 });

    expect(tabList.scrollLeft).toBe(120);
  });

  it("starts tab dragging from the tab button with pointer movement", () => {
    const onTabDragStart = vi.fn();
    const onTabDragEnd = vi.fn();
    render(
      <WorkspaceTabs
        paneId="pane-1"
        tabs={[
          { id: "tab-1", title: "连接 1" },
          { id: "tab-2", title: "连接 2" },
        ]}
        activeTabId="tab-1"
        onSelect={vi.fn()}
        onClose={vi.fn()}
        onTabDragStart={onTabDragStart}
        onTabDragEnd={onTabDragEnd}
      />,
    );

    const tab = screen.getByText("连接 1").closest(".workspace-tab") as HTMLElement;
    const tabButton = screen.getByRole("button", { name: "连接 1" });

    fireEvent.pointerDown(tabButton, { clientX: 12, clientY: 12, pointerId: 1, button: 0 });
    fireEvent.pointerMove(window, { clientX: 40, clientY: 12, pointerId: 1 });
    fireEvent.pointerUp(window, { clientX: 40, clientY: 12, pointerId: 1 });

    expect(onTabDragStart).toHaveBeenCalledWith("tab-1", expect.any(PointerEvent));
    expect(onTabDragEnd).toHaveBeenCalledTimes(1);
    expect(tab).not.toHaveAttribute("data-dragging");
    expect(screen.getByLabelText("工作区标签")).toHaveAttribute("data-workspace-tabs-pane-id", "pane-1");
    expect(tab).toHaveAttribute("data-tab-id", "tab-1");
  });

  it("does not start tab dragging from the close button", () => {
    const onTabDragStart = vi.fn();
    render(
      <WorkspaceTabs
        paneId="pane-1"
        tabs={[
          { id: "tab-1", title: "连接 1" },
          { id: "tab-2", title: "连接 2" },
        ]}
        activeTabId="tab-1"
        onSelect={vi.fn()}
        onClose={vi.fn()}
        onTabDragStart={onTabDragStart}
      />,
    );

    const closeButton = screen.getByRole("button", { name: "关闭 连接 1" });

    fireEvent.pointerDown(closeButton, { clientX: 12, clientY: 12, pointerId: 1, button: 0 });
    fireEvent.pointerMove(window, { clientX: 40, clientY: 12, pointerId: 1 });
    fireEvent.pointerUp(window, { clientX: 40, clientY: 12, pointerId: 1 });

    expect(onTabDragStart).not.toHaveBeenCalled();
  });

  it("closes a workspace tab with the middle mouse button", () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    render(
      <WorkspaceTabs
        paneId="pane-1"
        tabs={[
          { id: "tab-1", title: "连接 1" },
          { id: "tab-2", title: "连接 2" },
        ]}
        activeTabId="tab-1"
        onSelect={onSelect}
        onClose={onClose}
      />,
    );

    const tab = screen.getByText("连接 2").closest(".workspace-tab") as HTMLElement;
    fireEvent(tab, new MouseEvent("auxclick", { bubbles: true, button: 1 }));

    expect(onClose).toHaveBeenCalledWith("tab-2");
    expect(onSelect).not.toHaveBeenCalled();
  });
});
