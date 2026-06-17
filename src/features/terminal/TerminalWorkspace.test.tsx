import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TerminalWorkspace } from "./TerminalWorkspace";

vi.mock("../../lib/tauri", () => ({
  callBackend: vi.fn().mockResolvedValue({ session_id: "session-1" }),
  listenBackend: vi.fn().mockResolvedValue(vi.fn()),
}));

describe("TerminalWorkspace", () => {
  it("prompts for a connection when none is selected", () => {
    render(<TerminalWorkspace connectionId={null} fontFamily="JetBrains Mono" fontSize={14} theme="dark" isActive={true} />);
    expect(screen.getByText("未选择连接")).toBeInTheDocument();
  });

  it("renders terminal container for selected connection", () => {
    render(
      <TerminalWorkspace connectionId="prod-web-01" fontFamily="JetBrains Mono" fontSize={14} theme="dark" isActive={true} />,
    );
    expect(screen.getByLabelText("SSH 终端")).toBeInTheDocument();
  });
});

