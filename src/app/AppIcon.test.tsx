import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { AppIcon } from "./AppIcon";

describe("AppIcon", () => {
  beforeEach(() => {
    cleanup();
  });

  function TestSvg(props: React.SVGProps<SVGSVGElement>) {
    return (
      <svg viewBox="0 0 16 16" {...props}>
        <path fill="currentColor" d="M1 1h14v14H1z" />
      </svg>
    );
  }

  it("renders monochrome svg icons inline", () => {
    render(<AppIcon icon={TestSvg} label="测试图标" className="custom-icon" />);

    const icon = screen.getByRole("img", { name: "测试图标" });
    expect(icon).toHaveClass("app-icon", "custom-icon");
    expect(icon.tagName.toLowerCase()).toBe("svg");
    expect(icon.querySelector("path")).toHaveAttribute("fill", "currentColor");
  });

  it("can be hidden from assistive technology", () => {
    render(<AppIcon icon={TestSvg} decorative />);

    const icon = document.querySelector(".app-icon");
    expect(icon).toHaveAttribute("aria-hidden", "true");
    expect(icon).not.toHaveAttribute("aria-label");
  });
});
