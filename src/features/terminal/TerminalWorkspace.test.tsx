import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TerminalWorkspace } from "./TerminalWorkspace";

describe("TerminalWorkspace", () => {
  it("prompts for a connection when none is selected", () => {
    render(<TerminalWorkspace connectionId={null} />);
    expect(screen.getByText("未选择连接")).toBeInTheDocument();
  });

  it("renders terminal container for selected connection", () => {
    render(<TerminalWorkspace connectionId="prod-web-01" />);
    expect(screen.getByLabelText("SSH 终端")).toBeInTheDocument();
  });
});

