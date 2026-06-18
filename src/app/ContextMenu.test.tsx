import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ContextMenu } from "./ContextMenu";

describe("ContextMenu", () => {
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
});
