import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TerminalWorkspace } from "./TerminalWorkspace";
import { I18nProvider } from "../../i18n/I18nProvider";

vi.mock("../../lib/tauri", () => ({
  callBackend: vi.fn().mockResolvedValue({ session_id: "session-1" }),
  listenBackend: vi.fn().mockResolvedValue(vi.fn()),
}));

describe("TerminalWorkspace", () => {
  const terminalSettings = {
    log_highlight: {
      auto_detect_tail: true,
      case_sensitive: false,
      rules: [
        { pattern: "\\bERROR\\b", color: "#e06c75" },
      ],
    },
  };

  function renderTerminalWorkspace(connectionId: string | null) {
    return render(
      <I18nProvider language="zh-CN">
        <TerminalWorkspace
          connectionId={connectionId}
          fontFamily="JetBrains Mono"
          fontSize={14}
          theme="dark"
          isActive={true}
          terminalSettings={terminalSettings}
        />
      </I18nProvider>,
    );
  }

  it("prompts for a connection when none is selected", () => {
    renderTerminalWorkspace(null);
    expect(screen.getByText("未选择连接")).toBeInTheDocument();
  });

  it("renders terminal container for selected connection", () => {
    renderTerminalWorkspace("prod-web-01");
    expect(screen.getByLabelText("SSH 终端")).toBeInTheDocument();
  });
});
