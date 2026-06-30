import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { TerminalTab } from "./TerminalTab";
import { callBackend, listenBackend } from "../../lib/tauri";
import { readClipboardText, writeClipboardText } from "../../lib/clipboard";
import { I18nProvider } from "../../i18n/I18nProvider";
import type { TerminalSettings } from "../settings/settingsTypes";

vi.mock("../../lib/tauri", () => ({
  callBackend: vi.fn(),
  listenBackend: vi.fn(),
}));

vi.mock("../../lib/clipboard", () => ({
  readClipboardText: vi.fn(),
  writeClipboardText: vi.fn(),
}));

const callBackendMock = vi.mocked(callBackend);
const listenBackendMock = vi.mocked(listenBackend);
const readClipboardTextMock = vi.mocked(readClipboardText);
const writeClipboardTextMock = vi.mocked(writeClipboardText);

interface MockTerminal {
  cols: number;
  rows: number;
  options: Record<string, unknown>;
  write: ReturnType<typeof vi.fn>;
  writeln: ReturnType<typeof vi.fn>;
  onData: ReturnType<typeof vi.fn>;
  dispose: ReturnType<typeof vi.fn>;
  focus: ReturnType<typeof vi.fn>;
  refresh: ReturnType<typeof vi.fn>;
  scrollToBottom: ReturnType<typeof vi.fn>;
  getSelection: ReturnType<typeof vi.fn>;
  clear: ReturnType<typeof vi.fn>;
  buffer?: {
    active: {
      type: "normal" | "alternate";
      baseY?: number;
      cursorX: number;
      cursorY: number;
      length: number;
      getLine: (index: number) => { translateToString: (trimRight?: boolean) => string } | undefined;
    };
  };
}

const terminalSettings: TerminalSettings = {
  log_highlight: {
    auto_detect_tail: true,
    case_sensitive: false,
    rules: [
      { pattern: "\\bERROR\\b", color: "#e06c75" },
      { pattern: "\\bWARN\\b", color: "#e5c07b" },
    ],
  },
};

interface MockFitAddon {
  fit: ReturnType<typeof vi.fn>;
}

class MockResizeObserver {
  static instances: MockResizeObserver[] = [];

  callback: ResizeObserverCallback;
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
    MockResizeObserver.instances.push(this);
  }

  emit() {
    this.callback([], this as unknown as ResizeObserver);
  }
}

describe("TerminalTab", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.useRealTimers();
    MockResizeObserver.instances = [];
    vi.unstubAllGlobals();
  });

  function renderTerminalTab(props: Partial<React.ComponentProps<typeof TerminalTab>> = {}) {
    return render(
      <I18nProvider language="zh-CN">
        <TerminalTab {...terminalProps(props)} />
      </I18nProvider>,
    );
  }

  function terminalProps(overrides: Partial<React.ComponentProps<typeof TerminalTab>> = {}): React.ComponentProps<typeof TerminalTab> {
    return {
      connectionId: "prod-web-01",
      fontFamily: "Maple Mono",
      fontSize: 16,
      theme: "dark",
      isActive: true,
      terminalSettings,
      onStatusChange: vi.fn(),
      ...overrides,
    };
  }

  async function renderTerminalWithXtermTextarea(initialValue: string) {
    callBackendMock.mockResolvedValueOnce({ session_id: "session-1" });
    listenBackendMock.mockResolvedValueOnce(vi.fn());

    renderTerminalTab({ connectionId: "prod-web-01", fontFamily: "Maple Mono", fontSize: 16, theme: "dark", isActive: true });

    const terminalContainer = screen.getByLabelText("SSH 终端");
    const textarea = document.createElement("textarea");
    textarea.value = initialValue;
    terminalContainer.append(textarea);

    await waitFor(() => {
      expect(callBackendMock).toHaveBeenCalledWith("open_terminal", {
        request: { connection_id: "prod-web-01", cols: expect.any(Number), rows: expect.any(Number) },
      });
    });
    callBackendMock.mockClear();

    const terminal = vi.mocked(Terminal).mock.instances[0] as unknown as MockTerminal;
    const onData = terminal.onData.mock.calls[0]?.[0] as ((data: string) => void) | undefined;

    return { textarea, onData };
  }

  it("opens backend session, streams matching output, sends input, and closes session", async () => {
    let outputHandler: ((payload: { session_id: string; data: string }) => void) | null = null;
    const unlisten = vi.fn();
    callBackendMock.mockResolvedValue({ session_id: "session-1" });
    listenBackendMock.mockImplementationOnce(async (_event, handler) => {
      outputHandler = handler as (payload: { session_id: string; data: string }) => void;
      return unlisten;
    });

    const { unmount } = renderTerminalTab(terminalProps());

    await waitFor(() => {
      expect(callBackendMock).toHaveBeenCalledWith("open_terminal", {
        request: { connection_id: "prod-web-01", cols: expect.any(Number), rows: expect.any(Number) },
      });
    });
    expect(listenBackendMock).toHaveBeenCalledWith("terminal://output", expect.any(Function));
    expect(vi.mocked(Terminal)).toHaveBeenCalledWith(
      expect.objectContaining({
        fontFamily: "Maple Mono, Consolas, monospace",
        fontSize: 16,
      }),
    );

    const terminal = vi.mocked(Terminal).mock.instances[0] as unknown as MockTerminal;
    expect(terminal.focus).toHaveBeenCalled();
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

  it("reports connected only after the backend marks the terminal interactive", async () => {
    let outputHandler: ((payload: { session_id: string; data: string; status?: string }) => void) | null = null;
    const onStatusChange = vi.fn();
    listenBackendMock.mockImplementationOnce(async (_event, handler) => {
      outputHandler = handler as (payload: { session_id: string; data: string; status?: string }) => void;
      return () => {};
    });
    callBackendMock.mockResolvedValueOnce({ session_id: "session-1" });

    renderTerminalTab({ onStatusChange });

    expect(onStatusChange).toHaveBeenCalledWith("connecting");
    await waitFor(() => {
      expect(callBackendMock).toHaveBeenCalledWith("open_terminal", {
        request: { connection_id: "prod-web-01", cols: expect.any(Number), rows: expect.any(Number) },
      });
    });
    expect(onStatusChange).not.toHaveBeenCalledWith("connected");

    const emitOutput = outputHandler as unknown as (payload: { session_id: string; data: string; status?: string }) => void;
    emitOutput({ session_id: "session-1", data: "", status: "connected" });

    expect(onStatusChange).toHaveBeenCalledWith("connected");

    cleanup();
    vi.clearAllMocks();
    listenBackendMock.mockResolvedValueOnce(vi.fn());
    callBackendMock.mockRejectedValueOnce(new Error("ssh timeout"));

    renderTerminalTab({ onStatusChange });

    await waitFor(() => {
      expect(onStatusChange).toHaveBeenCalledWith("failed");
    });
  });

  it("reports closed when the backend marks the terminal session closed", async () => {
    let outputHandler: ((payload: { session_id: string; data: string; status?: string }) => void) | null = null;
    const onStatusChange = vi.fn();
    listenBackendMock.mockImplementationOnce(async (_event, handler) => {
      outputHandler = handler as (payload: { session_id: string; data: string; status?: string }) => void;
      return () => {};
    });
    callBackendMock.mockResolvedValueOnce({ session_id: "session-1" });

    renderTerminalTab({ onStatusChange });

    await waitFor(() => {
      expect(callBackendMock).toHaveBeenCalledWith("open_terminal", expect.anything());
    });

    const emitOutput = outputHandler as unknown as (payload: { session_id: string; data: string; status?: string }) => void;
    emitOutput({ session_id: "session-1", data: "", status: "connected" });
    emitOutput({ session_id: "session-1", data: "", status: "closed" });

    expect(onStatusChange).toHaveBeenCalledWith("closed");
    const terminal = vi.mocked(Terminal).mock.instances[0] as unknown as MockTerminal;
    expect(terminal.writeln).toHaveBeenCalledWith("[devhub] 连接已断开，按 Enter 重连。");
    await waitFor(() => {
      expect(callBackendMock).toHaveBeenCalledWith("close_terminal", { sessionId: "session-1" });
    });
  });

  it("reconnects when pressing Enter after the terminal session is closed", async () => {
    let outputHandler: ((payload: { session_id: string; data: string; status?: string }) => void) | null = null;
    listenBackendMock.mockImplementationOnce(async (_event, handler) => {
      outputHandler = handler as (payload: { session_id: string; data: string; status?: string }) => void;
      return () => {};
    });
    callBackendMock
      .mockResolvedValueOnce({ session_id: "session-1" })
      .mockResolvedValueOnce({ session_id: "session-2" });

    renderTerminalTab();

    await waitFor(() => {
      expect(callBackendMock).toHaveBeenCalledWith("open_terminal", expect.anything());
    });

    const emitOutput = outputHandler as unknown as (payload: { session_id: string; data: string; status?: string }) => void;
    emitOutput({ session_id: "session-1", data: "", status: "closed" });

    const terminal = vi.mocked(Terminal).mock.instances[0] as unknown as MockTerminal;
    const onData = terminal.onData.mock.calls[0]?.[0] as ((data: string) => void) | undefined;
    onData?.("\r");

    await waitFor(() => {
      const openTerminalCalls = callBackendMock.mock.calls.filter(([command]) => command === "open_terminal");
      expect(openTerminalCalls).toHaveLength(2);
      expect(openTerminalCalls[1]).toEqual([
        "open_terminal",
        { request: { connection_id: "prod-web-01", cols: expect.any(Number), rows: expect.any(Number) } },
      ]);
    });
  });

  it("marks the session as failed when backend emits an ssh error after opening", async () => {
    let outputHandler: ((payload: { session_id: string; data: string; status?: string }) => void) | null = null;
    const onStatusChange = vi.fn();
    listenBackendMock.mockImplementationOnce(async (_event, handler) => {
      outputHandler = handler as (payload: { session_id: string; data: string; status?: string }) => void;
      return () => {};
    });
    callBackendMock
      .mockResolvedValueOnce({ session_id: "session-1" })
      .mockResolvedValueOnce({ session_id: "session-2" });

    renderTerminalTab({ onStatusChange });

    await waitFor(() => {
      expect(callBackendMock).toHaveBeenCalledWith("open_terminal", expect.anything());
    });

    const emitOutput = outputHandler as unknown as (payload: { session_id: string; data: string; status?: string }) => void;
    emitOutput({ session_id: "session-1", data: "[devhub] ssh error: [Session(-13)] Failed getting banner\r\n" });

    expect(onStatusChange).toHaveBeenCalledWith("failed");

    const terminal = vi.mocked(Terminal).mock.instances[0] as unknown as MockTerminal;
    const onData = terminal.onData.mock.calls[0]?.[0] as ((data: string) => void) | undefined;
    onData?.("\r");

    await waitFor(() => {
      const openTerminalCalls = callBackendMock.mock.calls.filter(([command]) => command === "open_terminal");
      expect(openTerminalCalls).toHaveLength(2);
      expect(openTerminalCalls[openTerminalCalls.length - 1]).toEqual([
        "open_terminal",
        { request: { connection_id: "prod-web-01", cols: expect.any(Number), rows: expect.any(Number) } },
      ]);
    });
  });

  it("shows retry hint when backend marks the session failed before sending more output", async () => {
    let outputHandler: ((payload: { session_id: string; data: string; status?: string }) => void) | null = null;
    const onStatusChange = vi.fn();
    listenBackendMock.mockImplementationOnce(async (_event, handler) => {
      outputHandler = handler as (payload: { session_id: string; data: string; status?: string }) => void;
      return () => {};
    });
    callBackendMock
      .mockResolvedValueOnce({ session_id: "session-1" })
      .mockResolvedValueOnce({ session_id: "session-2" });

    renderTerminalTab({ onStatusChange });

    await waitFor(() => {
      expect(callBackendMock).toHaveBeenCalledWith("open_terminal", expect.anything());
    });

    const emitOutput = outputHandler as unknown as (payload: { session_id: string; data: string; status?: string }) => void;
    emitOutput({ session_id: "session-1", data: "", status: "failed" });
    emitOutput({ session_id: "session-1", data: "\r\n[devhub] ssh error: [Session(-13)] Failed getting banner\r\n" });

    const terminal = vi.mocked(Terminal).mock.instances[0] as unknown as MockTerminal;
    expect(onStatusChange).toHaveBeenCalledWith("failed");
    expect(terminal.writeln).toHaveBeenCalledWith("[devhub] 连接失败或超时，按 Enter 重连。");
    expect(terminal.write).toHaveBeenCalledWith("\r\n[devhub] ssh error: [Session(-13)] Failed getting banner\r\n");

    const onData = terminal.onData.mock.calls[0]?.[0] as ((data: string) => void) | undefined;
    onData?.("\r");

    await waitFor(() => {
      const openTerminalCalls = callBackendMock.mock.calls.filter(([command]) => command === "open_terminal");
      expect(openTerminalCalls).toHaveLength(2);
    });
  });

  it("shows connection errors and retries when pressing Enter after failure", async () => {
    const onStatusChange = vi.fn();
    listenBackendMock.mockResolvedValue(vi.fn());
    callBackendMock
      .mockRejectedValueOnce(new Error("ssh timeout"))
      .mockResolvedValueOnce({ session_id: "session-2" });

    renderTerminalTab({ onStatusChange });

    const terminal = vi.mocked(Terminal).mock.instances[0] as unknown as MockTerminal;
    await waitFor(() => {
      expect(terminal.writeln).toHaveBeenCalledWith(expect.stringContaining("按 Enter 重连"));
    });

    const onData = terminal.onData.mock.calls[0]?.[0] as ((data: string) => void) | undefined;
    onData?.("\r");

    await waitFor(() => {
      expect(callBackendMock).toHaveBeenCalledTimes(2);
      expect(callBackendMock).toHaveBeenLastCalledWith("open_terminal", {
        request: { connection_id: "prod-web-01", cols: expect.any(Number), rows: expect.any(Number) },
      });
    });
    expect(onStatusChange).not.toHaveBeenCalledWith("connected");
  });

  it("keeps output that arrives before the open terminal response resolves", async () => {
    let outputHandler: ((payload: { session_id: string; data: string }) => void) | null = null;
    let resolveOpenTerminal: (response: { session_id: string }) => void = () => {};
    callBackendMock.mockImplementation((command) => {
      if (command === "open_terminal") {
        return new Promise((resolve) => {
          resolveOpenTerminal = resolve as (response: { session_id: string }) => void;
        });
      }
      return Promise.resolve(undefined);
    });
    listenBackendMock.mockImplementationOnce(async (_event, handler) => {
      outputHandler = handler as (payload: { session_id: string; data: string }) => void;
      return () => {};
    });

    renderTerminalTab(terminalProps());

    await waitFor(() => {
      expect(outputHandler).not.toBeNull();
    });
    const emitOutput = outputHandler as unknown as (payload: { session_id: string; data: string }) => void;
    emitOutput({ session_id: "session-1", data: "root@host:~# " });
    resolveOpenTerminal({ session_id: "session-1" });

    const terminal = vi.mocked(Terminal).mock.instances[0] as unknown as MockTerminal;
    await waitFor(() => {
      expect(terminal.write).toHaveBeenCalledWith("root@host:~# ");
    });
  });

  it("highlights plain log output after an active terminal runs tail", async () => {
    let outputHandler: ((payload: { session_id: string; data: string }) => void) | null = null;
    callBackendMock.mockResolvedValueOnce({ session_id: "session-1" });
    listenBackendMock.mockImplementationOnce(async (_event, handler) => {
      outputHandler = handler as (payload: { session_id: string; data: string }) => void;
      return vi.fn<() => void>();
    });

    renderTerminalTab();

    await waitFor(() => {
      expect(callBackendMock).toHaveBeenCalledWith("open_terminal", {
        request: { connection_id: "prod-web-01", cols: expect.any(Number), rows: expect.any(Number) },
      });
    });
    const terminal = vi.mocked(Terminal).mock.instances[0] as unknown as MockTerminal;
    terminal.buffer = {
      active: {
        type: "normal",
        cursorX: 0,
        cursorY: 0,
        length: 24,
        getLine: () => ({ translateToString: () => "" }),
      },
    };

    const onData = terminal.onData.mock.calls[0]?.[0] as ((data: string) => void) | undefined;
    onData?.("tail -f /var/log/app.log\r");
    const emitOutput = outputHandler as unknown as (payload: { session_id: string; data: string }) => void;
    emitOutput({ session_id: "session-1", data: "2026 ERROR failed\n" });

    expect(terminal.write).toHaveBeenCalledWith("2026 \x1b[38;2;224;108;117mERROR\x1b[39m failed\n");
  });

  it("detects tail commands typed one character at a time", async () => {
    let outputHandler: ((payload: { session_id: string; data: string }) => void) | null = null;
    callBackendMock.mockResolvedValueOnce({ session_id: "session-1" });
    listenBackendMock.mockImplementationOnce(async (_event, handler) => {
      outputHandler = handler as (payload: { session_id: string; data: string }) => void;
      return vi.fn<() => void>();
    });

    renderTerminalTab();

    await waitFor(() => {
      expect(callBackendMock).toHaveBeenCalledWith("open_terminal", {
        request: { connection_id: "prod-web-01", cols: expect.any(Number), rows: expect.any(Number) },
      });
    });
    const terminal = vi.mocked(Terminal).mock.instances[0] as unknown as MockTerminal;
    terminal.buffer = {
      active: {
        type: "normal",
        cursorX: 0,
        cursorY: 0,
        length: 24,
        getLine: () => ({ translateToString: () => "" }),
      },
    };

    const onData = terminal.onData.mock.calls[0]?.[0] as ((data: string) => void) | undefined;
    for (const chunk of "tail -f /var/log/app.log\r") {
      onData?.(chunk);
    }
    const emitOutput = outputHandler as unknown as (payload: { session_id: string; data: string }) => void;
    emitOutput({ session_id: "session-1", data: "ERROR raw\n" });

    expect(terminal.write).toHaveBeenCalledWith("\x1b[38;2;224;108;117mERROR\x1b[39m raw\n");
  });

  it("detects tail commands submitted from the visible shell line", async () => {
    let outputHandler: ((payload: { session_id: string; data: string }) => void) | null = null;
    callBackendMock.mockResolvedValueOnce({ session_id: "session-1" });
    listenBackendMock.mockImplementationOnce(async (_event, handler) => {
      outputHandler = handler as (payload: { session_id: string; data: string }) => void;
      return vi.fn<() => void>();
    });

    renderTerminalTab();

    await waitFor(() => {
      expect(callBackendMock).toHaveBeenCalledWith("open_terminal", {
        request: { connection_id: "prod-web-01", cols: expect.any(Number), rows: expect.any(Number) },
      });
    });
    const terminal = vi.mocked(Terminal).mock.instances[0] as unknown as MockTerminal;
    terminal.buffer = {
      active: {
        type: "normal",
        baseY: 20,
        cursorX: 0,
        cursorY: 3,
        length: 24,
        getLine: (index) => ({
          translateToString: () => (index === 23 ? "root@prod:~# tail -f /var/log/app.log" : ""),
        }),
      },
    };

    const onData = terminal.onData.mock.calls[0]?.[0] as ((data: string) => void) | undefined;
    onData?.("\r");
    const emitOutput = outputHandler as unknown as (payload: { session_id: string; data: string }) => void;
    emitOutput({ session_id: "session-1", data: "WARN from history\n" });

    expect(terminal.write).toHaveBeenCalledWith("\x1b[38;2;229;192;123mWARN\x1b[39m from history\n");
  });

  it("detects tail commands pasted from the terminal context menu", async () => {
    let outputHandler: ((payload: { session_id: string; data: string }) => void) | null = null;
    readClipboardTextMock.mockResolvedValue("tail -f /var/log/app.log\r");
    callBackendMock.mockResolvedValueOnce({ session_id: "session-1" });
    listenBackendMock.mockImplementationOnce(async (_event, handler) => {
      outputHandler = handler as (payload: { session_id: string; data: string }) => void;
      return vi.fn<() => void>();
    });

    renderTerminalTab();

    await waitFor(() => {
      expect(callBackendMock).toHaveBeenCalledWith("open_terminal", {
        request: { connection_id: "prod-web-01", cols: expect.any(Number), rows: expect.any(Number) },
      });
    });
    const terminal = vi.mocked(Terminal).mock.instances[0] as unknown as MockTerminal;
    terminal.buffer = {
      active: {
        type: "normal",
        cursorX: 0,
        cursorY: 0,
        length: 24,
        getLine: () => ({ translateToString: () => "" }),
      },
    };
    fireEvent.contextMenu(screen.getByLabelText("SSH 终端"), { clientX: 12, clientY: 24 });
    fireEvent.click(screen.getByRole("menuitem", { name: "粘贴" }));

    await waitFor(() => {
      expect(callBackendMock).toHaveBeenCalledWith("write_terminal", {
        request: { session_id: "session-1", data: "tail -f /var/log/app.log\r" },
      });
    });
    const emitOutput = outputHandler as unknown as (payload: { session_id: string; data: string }) => void;
    emitOutput({ session_id: "session-1", data: "ERROR pasted\n" });

    expect(terminal.write).toHaveBeenCalledWith("\x1b[38;2;224;108;117mERROR\x1b[39m pasted\n");
  });

  it("writes raw output for inactive terminal tabs without running log highlighting", async () => {
    let outputHandler: ((payload: { session_id: string; data: string }) => void) | null = null;
    callBackendMock.mockResolvedValueOnce({ session_id: "session-1" });
    listenBackendMock.mockImplementationOnce(async (_event, handler) => {
      outputHandler = handler as (payload: { session_id: string; data: string }) => void;
      return vi.fn<() => void>();
    });

    renderTerminalTab({ isActive: false });

    await waitFor(() => {
      expect(callBackendMock).toHaveBeenCalledWith("open_terminal", {
        request: { connection_id: "prod-web-01", cols: expect.any(Number), rows: expect.any(Number) },
      });
    });
    const terminal = vi.mocked(Terminal).mock.instances[0] as unknown as MockTerminal;
    terminal.buffer = {
      active: {
        type: "normal",
        cursorX: 0,
        cursorY: 0,
        length: 24,
        getLine: () => ({ translateToString: () => "" }),
      },
    };

    const onData = terminal.onData.mock.calls[0]?.[0] as ((data: string) => void) | undefined;
    onData?.("tail -f /var/log/app.log\r");
    const emitOutput = outputHandler as unknown as (payload: { session_id: string; data: string }) => void;
    emitOutput({ session_id: "session-1", data: "ERROR raw\n" });

    expect(terminal.write).toHaveBeenCalledWith("ERROR raw\n");
    expect(terminal.write).not.toHaveBeenCalledWith("\x1b[38;2;224;108;117mERROR\x1b[39m raw\n");
  });

  it("keeps inactive terminal output live so tab switching does not need to flush buffered output", async () => {
    let outputHandler: ((payload: { session_id: string; data: string }) => void) | null = null;
    callBackendMock.mockResolvedValueOnce({ session_id: "session-1" });
    listenBackendMock.mockImplementationOnce(async (_event, handler) => {
      outputHandler = handler as (payload: { session_id: string; data: string }) => void;
      return vi.fn<() => void>();
    });

    const { rerender } = renderTerminalTab({ isActive: false });

    await waitFor(() => {
      expect(callBackendMock).toHaveBeenCalledWith("open_terminal", {
        request: { connection_id: "prod-web-01", cols: expect.any(Number), rows: expect.any(Number) },
      });
    });
    const terminal = vi.mocked(Terminal).mock.instances[0] as unknown as MockTerminal;
    terminal.write.mockClear();

    const emitOutput = outputHandler as unknown as (payload: { session_id: string; data: string }) => void;
    emitOutput({ session_id: "session-1", data: "line 1\n" });
    emitOutput({ session_id: "session-1", data: "line 2\n" });

    expect(terminal.write).toHaveBeenCalledWith("line 1\n");
    expect(terminal.write).toHaveBeenCalledWith("line 2\n");
    terminal.write.mockClear();

    rerender(
      <I18nProvider language="zh-CN">
        <TerminalTab {...terminalProps({ isActive: true })} />
      </I18nProvider>,
    );

    await Promise.resolve();
    expect(terminal.write).not.toHaveBeenCalled();
  });

  it("keeps inactive log output raw and highlights only new active output", async () => {
    let outputHandler: ((payload: { session_id: string; data: string }) => void) | null = null;
    callBackendMock.mockResolvedValueOnce({ session_id: "session-1" });
    listenBackendMock.mockImplementationOnce(async (_event, handler) => {
      outputHandler = handler as (payload: { session_id: string; data: string }) => void;
      return vi.fn<() => void>();
    });

    const { rerender } = renderTerminalTab({ isActive: false });

    await waitFor(() => {
      expect(callBackendMock).toHaveBeenCalledWith("open_terminal", {
        request: { connection_id: "prod-web-01", cols: expect.any(Number), rows: expect.any(Number) },
      });
    });
    const terminal = vi.mocked(Terminal).mock.instances[0] as unknown as MockTerminal;
    terminal.buffer = {
      active: {
        type: "normal",
        cursorX: 0,
        cursorY: 0,
        length: 24,
        getLine: () => ({ translateToString: () => "" }),
      },
    };
    const onData = terminal.onData.mock.calls[0]?.[0] as ((data: string) => void) | undefined;
    onData?.("tail -f /var/log/app.log\r");
    terminal.write.mockClear();

    const emitOutput = outputHandler as unknown as (payload: { session_id: string; data: string }) => void;
    emitOutput({ session_id: "session-1", data: "ERROR historical\n" });
    expect(terminal.write).toHaveBeenCalledWith("ERROR historical\n");
    terminal.write.mockClear();

    rerender(
      <I18nProvider language="zh-CN">
        <TerminalTab {...terminalProps({ isActive: true })} />
      </I18nProvider>,
    );

    await Promise.resolve();
    expect(terminal.write).not.toHaveBeenCalled();

    emitOutput({ session_id: "session-1", data: "ERROR live\n" });

    expect(terminal.write).toHaveBeenCalledWith("\x1b[38;2;224;108;117mERROR\x1b[39m live\n");
  });

  it("keeps server-colored log lines unchanged in tail highlight mode", async () => {
    let outputHandler: ((payload: { session_id: string; data: string }) => void) | null = null;
    callBackendMock.mockResolvedValueOnce({ session_id: "session-1" });
    listenBackendMock.mockImplementationOnce(async (_event, handler) => {
      outputHandler = handler as (payload: { session_id: string; data: string }) => void;
      return vi.fn<() => void>();
    });

    renderTerminalTab();

    await waitFor(() => {
      expect(callBackendMock).toHaveBeenCalledWith("open_terminal", {
        request: { connection_id: "prod-web-01", cols: expect.any(Number), rows: expect.any(Number) },
      });
    });
    const terminal = vi.mocked(Terminal).mock.instances[0] as unknown as MockTerminal;
    terminal.buffer = {
      active: {
        type: "normal",
        cursorX: 0,
        cursorY: 0,
        length: 24,
        getLine: () => ({ translateToString: () => "" }),
      },
    };

    const onData = terminal.onData.mock.calls[0]?.[0] as ((data: string) => void) | undefined;
    onData?.("tail -f /var/log/app.log\r");
    const emitOutput = outputHandler as unknown as (payload: { session_id: string; data: string }) => void;
    emitOutput({ session_id: "session-1", data: "\x1b[31mERROR\x1b[39m raw\n" });

    expect(terminal.write).toHaveBeenCalledWith("\x1b[31mERROR\x1b[39m raw\n");
  });

  it("requests a redraw when a sparse alternate buffer looks like a vim screen", async () => {
    let outputHandler: ((payload: { session_id: string; data: string }) => void) | null = null;
    callBackendMock.mockResolvedValueOnce({ session_id: "session-1" });
    listenBackendMock.mockImplementationOnce(async (_event, handler) => {
      outputHandler = handler as (payload: { session_id: string; data: string }) => void;
      return vi.fn<() => void>();
    });

    renderTerminalTab(terminalProps({ theme: "light" }));

    await waitFor(() => {
      expect(callBackendMock).toHaveBeenCalledWith("open_terminal", {
        request: { connection_id: "prod-web-01", cols: expect.any(Number), rows: expect.any(Number) },
      });
    });
    callBackendMock.mockClear();
    vi.useFakeTimers();

    const terminal = vi.mocked(Terminal).mock.instances[0] as unknown as MockTerminal;
    terminal.rows = 46;
    terminal.buffer = {
      active: {
        type: "alternate",
        cursorX: 0,
        cursorY: 0,
        length: 46,
        getLine: (index) => ({
          translateToString: () => (index === 45 ? "\"server-restart.sh\" 34L, 851C" : ""),
        }),
      },
    };

    const emitOutput = outputHandler as unknown as (payload: { session_id: string; data: string }) => void;
    emitOutput({ session_id: "session-1", data: "\u001b[?1049h\"server-restart.sh\" 34L, 851C" });

    vi.advanceTimersByTime(64);

    expect(callBackendMock).toHaveBeenCalledWith("write_terminal", {
      request: { session_id: "session-1", data: "\f" },
    });
    vi.useRealTimers();
  });

  it("does not request a redraw when alternate buffer already contains file content", async () => {
    let outputHandler: ((payload: { session_id: string; data: string }) => void) | null = null;
    callBackendMock.mockResolvedValueOnce({ session_id: "session-1" });
    listenBackendMock.mockImplementationOnce(async (_event, handler) => {
      outputHandler = handler as (payload: { session_id: string; data: string }) => void;
      return vi.fn<() => void>();
    });

    renderTerminalTab(terminalProps({ theme: "light" }));

    await waitFor(() => {
      expect(callBackendMock).toHaveBeenCalledWith("open_terminal", {
        request: { connection_id: "prod-web-01", cols: expect.any(Number), rows: expect.any(Number) },
      });
    });
    callBackendMock.mockClear();
    vi.useFakeTimers();

    const terminal = vi.mocked(Terminal).mock.instances[0] as unknown as MockTerminal;
    terminal.rows = 46;
    terminal.buffer = {
      active: {
        type: "alternate",
        cursorX: 0,
        cursorY: 0,
        length: 46,
        getLine: (index) => ({
          translateToString: () => (index < 20 ? `line ${index}` : ""),
        }),
      },
    };

    const emitOutput = outputHandler as unknown as (payload: { session_id: string; data: string }) => void;
    emitOutput({ session_id: "session-1", data: "\u001b[?1049hline 0" });

    vi.advanceTimersByTime(64);

    expect(callBackendMock).not.toHaveBeenCalledWith("write_terminal", expect.anything());
    vi.useRealTimers();
  });

  it("does not request a redraw for sparse non-vim alternate screen output", async () => {
    let outputHandler: ((payload: { session_id: string; data: string }) => void) | null = null;
    callBackendMock.mockResolvedValueOnce({ session_id: "session-1" });
    listenBackendMock.mockImplementationOnce(async (_event, handler) => {
      outputHandler = handler as (payload: { session_id: string; data: string }) => void;
      return vi.fn<() => void>();
    });

    renderTerminalTab(terminalProps({ theme: "light" }));

    await waitFor(() => {
      expect(callBackendMock).toHaveBeenCalledWith("open_terminal", {
        request: { connection_id: "prod-web-01", cols: expect.any(Number), rows: expect.any(Number) },
      });
    });
    callBackendMock.mockClear();
    vi.useFakeTimers();

    const terminal = vi.mocked(Terminal).mock.instances[0] as unknown as MockTerminal;
    terminal.rows = 46;
    terminal.buffer = {
      active: {
        type: "alternate",
        cursorX: 0,
        cursorY: 0,
        length: 46,
        getLine: (index) => ({
          translateToString: () => (index < 2 ? `assistant output ${index}` : ""),
        }),
      },
    };

    const emitOutput = outputHandler as unknown as (payload: { session_id: string; data: string }) => void;
    emitOutput({ session_id: "session-1", data: "\u001b[?1049hassistant output" });

    vi.advanceTimersByTime(64);

    expect(callBackendMock).not.toHaveBeenCalledWith("write_terminal", expect.anything());
    vi.useRealTimers();
  });

  it("refits and resizes the backend session when the terminal container changes size", async () => {
    vi.stubGlobal("ResizeObserver", MockResizeObserver);
    callBackendMock.mockResolvedValueOnce({ session_id: "session-1" });
    listenBackendMock.mockResolvedValueOnce(vi.fn());

    renderTerminalTab({ connectionId: "prod-web-01", fontFamily: "Maple Mono", fontSize: 16, theme: "dark", isActive: true });

    await waitFor(() => {
      expect(callBackendMock).toHaveBeenCalledWith("open_terminal", {
        request: { connection_id: "prod-web-01", cols: expect.any(Number), rows: expect.any(Number) },
      });
    });

    const terminal = vi.mocked(Terminal).mock.instances[0] as unknown as MockTerminal;
    const fitAddon = vi.mocked(FitAddon).mock.instances[0] as unknown as MockFitAddon;
    terminal.cols = 120;
    terminal.rows = 36;
    const fitCountBeforeResize = fitAddon.fit.mock.calls.length;

    MockResizeObserver.instances[0].emit();

    await waitFor(() => {
      expect(fitAddon.fit.mock.calls.length).toBeGreaterThan(fitCountBeforeResize);
      expect(callBackendMock).toHaveBeenCalledWith("resize_terminal", {
        request: { session_id: "session-1", cols: 120, rows: 36 },
      });
    });
  });

  it("does not resend backend resize when the fitted terminal size is unchanged", async () => {
    vi.stubGlobal("ResizeObserver", MockResizeObserver);
    callBackendMock.mockResolvedValueOnce({ session_id: "session-1" });
    listenBackendMock.mockResolvedValueOnce(vi.fn());

    renderTerminalTab({ connectionId: "prod-web-01", fontFamily: "Maple Mono", fontSize: 16, theme: "dark", isActive: true });

    await waitFor(() => {
      expect(callBackendMock).toHaveBeenCalledWith("open_terminal", {
        request: { connection_id: "prod-web-01", cols: expect.any(Number), rows: expect.any(Number) },
      });
    });
    callBackendMock.mockClear();

    const terminal = vi.mocked(Terminal).mock.instances[0] as unknown as MockTerminal;
    terminal.cols = 120;
    terminal.rows = 36;

    MockResizeObserver.instances[0].emit();
    await waitFor(() => {
      expect(callBackendMock).toHaveBeenCalledWith("resize_terminal", {
        request: { session_id: "session-1", cols: 120, rows: 36 },
      });
    });
    callBackendMock.mockClear();

    MockResizeObserver.instances[0].emit();
    await Promise.resolve();

    expect(callBackendMock).not.toHaveBeenCalledWith("resize_terminal", expect.anything());
  });

  it("refits and resizes a visible backend session when the workspace pane layout changes", async () => {
    callBackendMock.mockResolvedValueOnce({ session_id: "session-1" });
    listenBackendMock.mockResolvedValueOnce(vi.fn());

    const { rerender } = renderTerminalTab({
      connectionId: "prod-web-01",
      fontFamily: "Maple Mono",
      fontSize: 16,
      theme: "dark",
      isActive: false,
      isVisible: true,
      layoutVersion: 1,
    });

    await waitFor(() => {
      expect(callBackendMock).toHaveBeenCalledWith("open_terminal", {
        request: { connection_id: "prod-web-01", cols: expect.any(Number), rows: expect.any(Number) },
      });
    });
    callBackendMock.mockClear();

    const terminal = vi.mocked(Terminal).mock.instances[0] as unknown as MockTerminal;
    const fitAddon = vi.mocked(FitAddon).mock.instances[0] as unknown as MockFitAddon;
    terminal.cols = 132;
    terminal.rows = 40;
    const fitCountBeforeLayoutChange = fitAddon.fit.mock.calls.length;

    rerender(
      <I18nProvider language="zh-CN">
        <TerminalTab {...terminalProps({ isActive: false, isVisible: true, layoutVersion: 2 })} />
      </I18nProvider>,
    );

    await waitFor(() => {
      expect(fitAddon.fit.mock.calls.length).toBeGreaterThan(fitCountBeforeLayoutChange);
      expect(terminal.scrollToBottom).toHaveBeenCalled();
      expect(callBackendMock).toHaveBeenCalledWith("resize_terminal", {
        request: { session_id: "session-1", cols: 132, rows: 40 },
      });
    });
    expect(callBackendMock).not.toHaveBeenCalledWith("open_terminal", expect.anything());
  });

  it("does not resize an inactive hidden terminal when the workspace pane layout changes", async () => {
    callBackendMock.mockResolvedValueOnce({ session_id: "session-1" });
    listenBackendMock.mockResolvedValueOnce(vi.fn());

    const { rerender } = renderTerminalTab({
      connectionId: "prod-web-01",
      fontFamily: "Maple Mono",
      fontSize: 16,
      theme: "dark",
      isActive: false,
      isVisible: false,
      layoutVersion: 1,
    });

    await waitFor(() => {
      expect(callBackendMock).toHaveBeenCalledWith("open_terminal", {
        request: { connection_id: "prod-web-01", cols: expect.any(Number), rows: expect.any(Number) },
      });
    });
    callBackendMock.mockClear();

    const fitAddon = vi.mocked(FitAddon).mock.instances[0] as unknown as MockFitAddon;
    fitAddon.fit.mockClear();

    rerender(
      <I18nProvider language="zh-CN">
        <TerminalTab {...terminalProps({ isActive: false, isVisible: false, layoutVersion: 2 })} />
      </I18nProvider>,
    );

    expect(fitAddon.fit).not.toHaveBeenCalled();
    expect(callBackendMock).not.toHaveBeenCalledWith("resize_terminal", expect.anything());
    expect(callBackendMock).not.toHaveBeenCalledWith("open_terminal", expect.anything());
  });

  it("applies the app theme to xterm", () => {
    callBackendMock.mockResolvedValueOnce({ session_id: "session-1" });
    listenBackendMock.mockResolvedValueOnce(vi.fn());

    renderTerminalTab({ connectionId: "prod-web-01", fontFamily: "Maple Mono", fontSize: 16, theme: "light", isActive: true });

    expect(vi.mocked(Terminal)).toHaveBeenCalledWith(
      expect.objectContaining({
        theme: expect.objectContaining({
          background: "#fafafa",
          foreground: "#383a42",
        }),
      }),
    );
  });

  it("keeps light terminal ANSI white colors visible on the light background", () => {
    callBackendMock.mockResolvedValueOnce({ session_id: "session-1" });
    listenBackendMock.mockResolvedValueOnce(vi.fn());

    renderTerminalTab({ connectionId: "prod-web-01", fontFamily: "Maple Mono", fontSize: 16, theme: "light", isActive: true });

    expect(vi.mocked(Terminal)).toHaveBeenCalledWith(
      expect.objectContaining({
        theme: expect.objectContaining({
          background: "#fafafa",
          white: "#383a42",
          brightWhite: "#383a42",
        }),
      }),
    );
  });

  it("keeps ANSI black visible on the dark terminal background", () => {
    callBackendMock.mockResolvedValueOnce({ session_id: "session-1" });
    listenBackendMock.mockResolvedValueOnce(vi.fn());

    renderTerminalTab({ connectionId: "prod-web-01", fontFamily: "Maple Mono", fontSize: 16, theme: "dark", isActive: true });

    expect(vi.mocked(Terminal)).toHaveBeenCalledWith(
      expect.objectContaining({
        theme: expect.objectContaining({
          background: "#282c34",
          black: "#5c6370",
        }),
      }),
    );
  });

  it("keeps low-contrast 256-color entries readable against terminal backgrounds", () => {
    callBackendMock.mockResolvedValueOnce({ session_id: "session-1" });
    listenBackendMock.mockResolvedValueOnce(vi.fn());

    renderTerminalTab({ connectionId: "prod-web-01", fontFamily: "Maple Mono", fontSize: 16, theme: "light", isActive: true });

    expect(vi.mocked(Terminal)).toHaveBeenCalledWith(
      expect.objectContaining({
        theme: expect.objectContaining({
          extendedAnsi: expect.arrayContaining([
            "#383a42",
          ]),
        }),
      }),
    );
    const terminalOptions = vi.mocked(Terminal).mock.calls[0][0] as { theme: { extendedAnsi: string[] } };
    expect(terminalOptions.theme.extendedAnsi[215]).toBe("#383a42");
    expect(terminalOptions.theme.extendedAnsi[239]).toBe("#383a42");
  });

  it("enables terminal minimum contrast protection for full-screen TUI color schemes", () => {
    callBackendMock.mockResolvedValueOnce({ session_id: "session-1" });
    listenBackendMock.mockResolvedValueOnce(vi.fn());

    renderTerminalTab({ connectionId: "prod-web-01", fontFamily: "Maple Mono", fontSize: 16, theme: "light", isActive: true });

    expect(vi.mocked(Terminal)).toHaveBeenCalledWith(
      expect.objectContaining({
        minimumContrastRatio: 4.5,
      }),
    );
  });

  it("keeps raw terminal control sequences compatible with full-screen programs", () => {
    callBackendMock.mockResolvedValueOnce({ session_id: "session-1" });
    listenBackendMock.mockResolvedValueOnce(vi.fn());

    renderTerminalTab({ connectionId: "prod-web-01", fontFamily: "Maple Mono", fontSize: 16, theme: "dark", isActive: true });

    expect(vi.mocked(Terminal)).toHaveBeenCalledWith(
      expect.objectContaining({
        convertEol: false,
      }),
    );
  });

  it("keeps 1000 lines of terminal scrollback while inactive tabs keep receiving output", () => {
    callBackendMock.mockResolvedValueOnce({ session_id: "session-1" });
    listenBackendMock.mockResolvedValueOnce(vi.fn());

    renderTerminalTab({ connectionId: "prod-web-01", fontFamily: "Maple Mono", fontSize: 16, theme: "dark", isActive: true });

    expect(vi.mocked(Terminal)).toHaveBeenCalledWith(
      expect.objectContaining({
        scrollback: 1000,
      }),
    );
  });

  it("updates xterm theme without reconnecting the terminal session", async () => {
    const unlisten = vi.fn();
    callBackendMock.mockResolvedValueOnce({ session_id: "session-1" });
    listenBackendMock.mockResolvedValue(unlisten);

    const { rerender } = renderTerminalTab({
      connectionId: "prod-web-01",
      fontFamily: "Maple Mono",
      fontSize: 16,
      theme: "dark",
      isActive: true,
    });

    await waitFor(() => {
      expect(callBackendMock).toHaveBeenCalledWith("open_terminal", {
        request: { connection_id: "prod-web-01", cols: expect.any(Number), rows: expect.any(Number) },
      });
    });
    callBackendMock.mockClear();

    rerender(
      <I18nProvider language="zh-CN">
        <TerminalTab {...terminalProps({ theme: "light", isActive: true })} />
      </I18nProvider>,
    );

    const terminal = vi.mocked(Terminal).mock.instances[0] as unknown as MockTerminal;
    const fitAddon = vi.mocked(FitAddon).mock.instances[0] as unknown as MockFitAddon;
    expect(vi.mocked(Terminal)).toHaveBeenCalledTimes(1);
    expect(terminal.options.theme).toMatchObject({
      background: "#fafafa",
      foreground: "#383a42",
    });
    expect(fitAddon.fit).toHaveBeenCalled();
    expect(terminal.refresh).not.toHaveBeenCalled();
    expect(callBackendMock).not.toHaveBeenCalledWith("close_terminal", { sessionId: "session-1" });
    expect(callBackendMock).not.toHaveBeenCalledWith("open_terminal", expect.anything());
    expect(callBackendMock).not.toHaveBeenCalledWith("resize_terminal", expect.anything());
    expect(unlisten).not.toHaveBeenCalled();
  });

  it("updates an inactive terminal theme without fitting or resizing the backend session", async () => {
    callBackendMock.mockResolvedValueOnce({ session_id: "session-1" });
    listenBackendMock.mockResolvedValue(vi.fn());

    const { rerender } = renderTerminalTab({
      connectionId: "prod-web-01",
      fontFamily: "Maple Mono",
      fontSize: 16,
      theme: "dark",
      isActive: false,
    });

    await waitFor(() => {
      expect(callBackendMock).toHaveBeenCalledWith("open_terminal", {
        request: { connection_id: "prod-web-01", cols: expect.any(Number), rows: expect.any(Number) },
      });
    });

    const terminal = vi.mocked(Terminal).mock.instances[0] as unknown as MockTerminal;
    const fitAddon = vi.mocked(FitAddon).mock.instances[0] as unknown as MockFitAddon;
    callBackendMock.mockClear();
    fitAddon.fit.mockClear();

    rerender(
      <I18nProvider language="zh-CN">
        <TerminalTab {...terminalProps({ theme: "light", isActive: false })} />
      </I18nProvider>,
    );

    expect(terminal.options.theme).toMatchObject({
      background: "#fafafa",
      foreground: "#383a42",
    });
    expect(fitAddon.fit).not.toHaveBeenCalled();
    expect(terminal.refresh).not.toHaveBeenCalled();
    expect(callBackendMock).not.toHaveBeenCalledWith("resize_terminal", expect.anything());
  });

  it("shows terminal actions from the terminal context menu", () => {
    callBackendMock.mockResolvedValueOnce({ session_id: "session-1" });
    listenBackendMock.mockResolvedValueOnce(vi.fn());

    renderTerminalTab({ connectionId: "prod-web-01", fontFamily: "Maple Mono", fontSize: 16, theme: "dark", isActive: true });

    fireEvent.contextMenu(screen.getByLabelText("SSH 终端"), { clientX: 12, clientY: 24 });

    expect(screen.getByRole("menuitem", { name: "复制" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "粘贴" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "清屏" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "开启日志高亮" })).toBeInTheDocument();
  });

  it("toggles log highlighting from the terminal context menu", async () => {
    let outputHandler: ((payload: { session_id: string; data: string }) => void) | null = null;
    callBackendMock.mockResolvedValueOnce({ session_id: "session-1" });
    listenBackendMock.mockImplementationOnce(async (_event, handler) => {
      outputHandler = handler as (payload: { session_id: string; data: string }) => void;
      return vi.fn<() => void>();
    });

    renderTerminalTab();

    await waitFor(() => {
      expect(callBackendMock).toHaveBeenCalledWith("open_terminal", {
        request: { connection_id: "prod-web-01", cols: expect.any(Number), rows: expect.any(Number) },
      });
    });
    const terminal = vi.mocked(Terminal).mock.instances[0] as unknown as MockTerminal;
    terminal.buffer = {
      active: {
        type: "normal",
        cursorX: 0,
        cursorY: 0,
        length: 24,
        getLine: () => ({ translateToString: () => "" }),
      },
    };
    fireEvent.contextMenu(screen.getByLabelText("SSH 终端"), { clientX: 12, clientY: 24 });
    fireEvent.click(screen.getByRole("menuitem", { name: "开启日志高亮" }));

    const emitOutput = outputHandler as unknown as (payload: { session_id: string; data: string }) => void;
    emitOutput({ session_id: "session-1", data: "ERROR manual\n" });

    expect(terminal.write).toHaveBeenCalledWith("\x1b[38;2;224;108;117mERROR\x1b[39m manual\n");
  });

  it("copies the current terminal selection from the context menu", async () => {
    const browserWriteText = vi.fn();
    vi.stubGlobal("navigator", { clipboard: { writeText: browserWriteText } });
    callBackendMock.mockResolvedValueOnce({ session_id: "session-1" });
    listenBackendMock.mockResolvedValueOnce(vi.fn());

    renderTerminalTab({ connectionId: "prod-web-01", fontFamily: "Maple Mono", fontSize: 16, theme: "dark", isActive: true });

    const terminal = vi.mocked(Terminal).mock.instances[0] as unknown as MockTerminal;
    terminal.getSelection.mockReturnValue("selected text");
    terminal.focus.mockClear();
    fireEvent.contextMenu(screen.getByLabelText("SSH 终端"), { clientX: 12, clientY: 24 });
    fireEvent.click(screen.getByRole("menuitem", { name: "复制" }));

    expect(writeClipboardTextMock).toHaveBeenCalledWith("selected text");
    expect(browserWriteText).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(terminal.focus).toHaveBeenCalledTimes(1);
    });
  });

  it("pastes clipboard text into the active backend session from the context menu", async () => {
    const browserReadText = vi.fn().mockResolvedValue("browser text");
    vi.stubGlobal("navigator", { clipboard: { readText: browserReadText } });
    readClipboardTextMock.mockResolvedValue("pwd\r");
    callBackendMock.mockResolvedValueOnce({ session_id: "session-1" });
    listenBackendMock.mockResolvedValueOnce(vi.fn());

    renderTerminalTab({ connectionId: "prod-web-01", fontFamily: "Maple Mono", fontSize: 16, theme: "dark", isActive: true });

    await waitFor(() => {
      expect(callBackendMock).toHaveBeenCalledWith("open_terminal", {
        request: { connection_id: "prod-web-01", cols: expect.any(Number), rows: expect.any(Number) },
      });
    });
    callBackendMock.mockClear();

    const terminal = vi.mocked(Terminal).mock.instances[0] as unknown as MockTerminal;
    terminal.focus.mockClear();
    fireEvent.contextMenu(screen.getByLabelText("SSH 终端"), { clientX: 12, clientY: 24 });
    fireEvent.click(screen.getByRole("menuitem", { name: "粘贴" }));

    await waitFor(() => {
      expect(readClipboardTextMock).toHaveBeenCalledTimes(1);
      expect(callBackendMock).toHaveBeenCalledWith("write_terminal", {
        request: { session_id: "session-1", data: "pwd\r" },
      });
    });
    expect(browserReadText).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(terminal.focus).toHaveBeenCalledTimes(1);
    });
  });

  it("clears committed ime text when it is still the whole xterm textarea value", async () => {
    const { textarea, onData } = await renderTerminalWithXtermTextarea("帮我");
    onData?.("帮我");

    await waitFor(() => {
      expect(callBackendMock).toHaveBeenCalledWith("write_terminal", {
        request: { session_id: "session-1", data: "帮我" },
      });
    });
    vi.useFakeTimers();
    await vi.runOnlyPendingTimersAsync();

    expect(textarea.value).toBe("");
  });

  it("does not rewrite mixed ime input while xterm is composing", async () => {
    const { textarea, onData } = await renderTerminalWithXtermTextarea("帮我");
    vi.useFakeTimers();
    onData?.("帮我");
    textarea.value = "帮我 a";

    await vi.runOnlyPendingTimersAsync();

    expect(textarea.value).toBe("帮我 a");
  });

  it("does not rewrite duplicated ascii ime text while xterm is composing", async () => {
    const { textarea, onData } = await renderTerminalWithXtermTextarea("dev");
    vi.useFakeTimers();
    onData?.("dev");
    textarea.value = "devev";

    await vi.runOnlyPendingTimersAsync();

    expect(textarea.value).toBe("devev");
  });

  it("clears the terminal display from the context menu", async () => {
    callBackendMock.mockResolvedValueOnce({ session_id: "session-1" });
    listenBackendMock.mockResolvedValueOnce(vi.fn());

    renderTerminalTab({ connectionId: "prod-web-01", fontFamily: "Maple Mono", fontSize: 16, theme: "dark", isActive: true });

    const terminal = vi.mocked(Terminal).mock.instances[0] as unknown as MockTerminal;
    terminal.focus.mockClear();
    fireEvent.contextMenu(screen.getByLabelText("SSH 终端"), { clientX: 12, clientY: 24 });
    fireEvent.click(screen.getByRole("menuitem", { name: "清屏" }));

    expect(terminal.clear).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(terminal.focus).toHaveBeenCalledTimes(1);
    });
  });
});
