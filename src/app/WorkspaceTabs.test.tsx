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
});
