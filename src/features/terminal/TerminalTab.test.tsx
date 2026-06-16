import { render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Terminal } from "@xterm/xterm";
import { TerminalTab } from "./TerminalTab";
import { callBackend, listenBackend } from "../../lib/tauri";

vi.mock("../../lib/tauri", () => ({
  callBackend: vi.fn(),
  listenBackend: vi.fn(),
}));

const callBackendMock = vi.mocked(callBackend);
const listenBackendMock = vi.mocked(listenBackend);

interface MockTerminal {
  write: ReturnType<typeof vi.fn>;
  onData: ReturnType<typeof vi.fn>;
  dispose: ReturnType<typeof vi.fn>;
}

describe("TerminalTab", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("opens backend session, streams matching output, sends input, and closes session", async () => {
    let outputHandler: ((payload: { session_id: string; data: string }) => void) | null = null;
    const unlisten = vi.fn();
    callBackendMock.mockResolvedValueOnce({ session_id: "session-1" });
    listenBackendMock.mockImplementationOnce(async (_event, handler) => {
      outputHandler = handler as (payload: { session_id: string; data: string }) => void;
      return unlisten;
    });

    const { unmount } = render(<TerminalTab connectionId="prod-web-01" />);

    await waitFor(() => {
      expect(callBackendMock).toHaveBeenCalledWith("open_terminal", {
        request: { connection_id: "prod-web-01", cols: expect.any(Number), rows: expect.any(Number) },
      });
    });
    expect(listenBackendMock).toHaveBeenCalledWith("terminal://output", expect.any(Function));

    const terminal = vi.mocked(Terminal).mock.instances[0] as unknown as MockTerminal;
    expect(outputHandler).not.toBeNull();
    const emitOutput = outputHandler as unknown as (payload: { session_id: string; data: string }) => void;
    emitOutput({ session_id: "other-session", data: "ignored" });
    emitOutput({ session_id: "session-1", data: "hello" });

    expect(terminal.write).toHaveBeenCalledTimes(1);
    expect(terminal.write).toHaveBeenCalledWith("hello");

    const onData = terminal.onData.mock.calls[0]?.[0] as ((data: string) => void) | undefined;
    onData?.("ls\r");

    await waitFor(() => {
      expect(callBackendMock).toHaveBeenCalledWith("write_terminal", {
        request: { session_id: "session-1", data: "ls\r" },
      });
    });

    unmount();

    await waitFor(() => {
      expect(callBackendMock).toHaveBeenCalledWith("close_terminal", { sessionId: "session-1" });
    });
    expect(unlisten).toHaveBeenCalledTimes(1);
    expect(terminal.dispose).toHaveBeenCalledTimes(1);
  });
});
