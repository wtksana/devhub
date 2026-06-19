import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { TerminalTab } from "./TerminalTab";
import { callBackend, listenBackend } from "../../lib/tauri";
import { readClipboardText, writeClipboardText } from "../../lib/clipboard";
import { I18nProvider } from "../../i18n/I18nProvider";

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
  onData: ReturnType<typeof vi.fn>;
  dispose: ReturnType<typeof vi.fn>;
  focus: ReturnType<typeof vi.fn>;
  refresh: ReturnType<typeof vi.fn>;
  getSelection: ReturnType<typeof vi.fn>;
  clear: ReturnType<typeof vi.fn>;
}

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
    MockResizeObserver.instances = [];
    vi.unstubAllGlobals();
  });

  function renderTerminalTab(props: React.ComponentProps<typeof TerminalTab>) {
    return render(
      <I18nProvider language="zh-CN">
        <TerminalTab {...props} />
      </I18nProvider>,
    );
  }

  it("opens backend session, streams matching output, sends input, and closes session", async () => {
    let outputHandler: ((payload: { session_id: string; data: string }) => void) | null = null;
    const unlisten = vi.fn();
    callBackendMock.mockResolvedValue({ session_id: "session-1" });
    listenBackendMock.mockImplementationOnce(async (_event, handler) => {
      outputHandler = handler as (payload: { session_id: string; data: string }) => void;
      return unlisten;
    });

    const { unmount } = renderTerminalTab({
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

    renderTerminalTab({ connectionId: "prod-web-01", fontFamily: "Maple Mono", fontSize: 16, theme: "dark", isActive: true });

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
        <TerminalTab connectionId="prod-web-01" fontFamily="Maple Mono" fontSize={16} theme="light" isActive={true} />
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
    expect(terminal.refresh).toHaveBeenCalledWith(0, 23);
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
        <TerminalTab connectionId="prod-web-01" fontFamily="Maple Mono" fontSize={16} theme="light" isActive={false} />
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
