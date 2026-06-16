import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AiPanel } from "./AiPanel";

vi.mock("../../lib/tauri", () => ({
  callBackend: vi.fn(),
}));

describe("AiPanel", () => {
  it("states that generated commands are not executed automatically", () => {
    render(<AiPanel />);
    expect(screen.getByText(/不会自动执行/)).toBeInTheDocument();
  });
});
