import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { ContextMenu, type ContextMenuState } from "../../app/ContextMenu";
import { readClipboardText, writeClipboardText } from "../../lib/clipboard";
import { callBackend, listenBackend } from "../../lib/tauri";

interface TerminalTabProps {
  connectionId: string;
  fontFamily: string;
  fontSize: number;
  theme: "dark" | "light";
  isActive: boolean;
}

interface TerminalSessionResponse {
  session_id: string;
}

interface TerminalOutputEvent {
  session_id: string;
  data: string;
}

const terminalThemes = {
  dark: {
    background: "#282c34",
    foreground: "#abb2bf",
    cursor: "#abb2bf",
    cursorAccent: "#282c34",
    selectionBackground: "#3e4451",
    black: "#282c34",
    red: "#e06c75",
    green: "#98c379",
    yellow: "#e5c07b",
    blue: "#61afef",
    magenta: "#c678dd",
    cyan: "#56b6c2",
    white: "#abb2bf",
    brightBlack: "#5c6370",
    brightRed: "#e06c75",
    brightGreen: "#98c379",
    brightYellow: "#e5c07b",
    brightBlue: "#61afef",
    brightMagenta: "#c678dd",
    brightCyan: "#56b6c2",
    brightWhite: "#ffffff",
  },
  light: {
    background: "#fafafa",
    foreground: "#383a42",
    cursor: "#383a42",
    cursorAccent: "#fafafa",
    selectionBackground: "#d7dce8",
    black: "#383a42",
    red: "#e45649",
    green: "#50a14f",
    yellow: "#c18401",
    blue: "#4078f2",
    magenta: "#a626a4",
    cyan: "#0184bc",
    white: "#fafafa",
    brightBlack: "#a0a1a7",
    brightRed: "#e45649",
    brightGreen: "#50a14f",
    brightYellow: "#c18401",
    brightBlue: "#4078f2",
    brightMagenta: "#a626a4",
    brightCyan: "#0184bc",
    brightWhite: "#ffffff",
  },
} as const;

export function TerminalTab({ connectionId, fontFamily, fontSize, theme, isActive }: TerminalTabProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const isActiveRef = useRef(isActive);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);

  useEffect(() => {
    isActiveRef.current = isActive;
  }, [isActive]);

  function copySelection() {
    const selection = terminalRef.current?.getSelection();
    if (!selection) return;
    void writeClipboardText(selection);
    refocusTerminal();
  }

  async function pasteClipboard() {
    try {
      const sessionId = sessionIdRef.current;
      if (!sessionId) return;
      const text = await readClipboardText();
      if (!text) return;
      void callBackend<void>("write_terminal", {
        request: { session_id: sessionId, data: text },
      });
    } finally {
      refocusTerminal();
    }
  }

  function clearTerminal() {
    terminalRef.current?.clear();
    refocusTerminal();
  }

  function refocusTerminal() {
    window.requestAnimationFrame(() => {
      terminalRef.current?.focus();
    });
  }

  function handleContextMenu(event: React.MouseEvent<HTMLDivElement>) {
    event.preventDefault();
    event.stopPropagation();
    setContextMenu({
      x: event.clientX,
      y: event.clientY,
      items: [
        { label: "复制", onSelect: copySelection },
        { label: "粘贴", onSelect: () => void pasteClipboard() },
        { label: "清屏", onSelect: clearTerminal },
      ],
    });
  }

  function updateContainerTheme(themeName: "dark" | "light") {
    const terminalTheme = terminalThemes[themeName];
    if (!containerRef.current) return;
    containerRef.current.style.background = terminalTheme.background;
    containerRef.current.style.setProperty("--terminal-background", terminalTheme.background);
  }

  useEffect(() => {
    const terminalTheme = terminalThemes[theme];
    if (terminalRef.current) {
      terminalRef.current.options.theme = terminalTheme;
      if (isActiveRef.current) {
        fitAddonRef.current?.fit();
        terminalRef.current.refresh(0, Math.max(0, terminalRef.current.rows - 1));
      }
    }
    updateContainerTheme(theme);
  }, [theme]);

  useEffect(() => {
    if (!containerRef.current) return;

    let disposed = false;
    let disposeInput: { dispose: () => void } | null = null;
    let unlistenOutput: (() => void) | null = null;
    let resizeObserver: ResizeObserver | null = null;
    let resizeFrame: number | null = null;

    const terminal = new Terminal({
      cursorBlink: true,
      fontFamily: `${fontFamily}, Consolas, monospace`,
      fontSize,
      theme: terminalThemes[theme],
      convertEol: true,
    });
    terminalRef.current = terminal;
    updateContainerTheme(theme);
    const fitAddon = new FitAddon();
    fitAddonRef.current = fitAddon;
    terminal.loadAddon(fitAddon);
    terminal.open(containerRef.current);
    fitAddon.fit();
    terminal.focus();
    terminal.writeln(`Connecting to ${connectionId}...`);

    function fitAndResizeBackend() {
      if (!isActiveRef.current) return;
      fitAddon.fit();
      const sessionId = sessionIdRef.current;
      if (!sessionId) return;
      void callBackend<void>("resize_terminal", {
        request: {
          session_id: sessionId,
          cols: terminal.cols || 80,
          rows: terminal.rows || 24,
        },
      });
    }

    function scheduleFit() {
      if (resizeFrame !== null) {
        window.cancelAnimationFrame(resizeFrame);
      }
      resizeFrame = window.requestAnimationFrame(() => {
        resizeFrame = null;
        if (!disposed) {
          fitAndResizeBackend();
        }
      });
    }

    if (typeof ResizeObserver !== "undefined") {
      resizeObserver = new ResizeObserver(scheduleFit);
      resizeObserver.observe(containerRef.current);
    }

    disposeInput = terminal.onData((data) => {
      const sessionId = sessionIdRef.current;
      if (!sessionId) return;
      void callBackend<void>("write_terminal", {
        request: { session_id: sessionId, data },
      });
    });

    void listenBackend<TerminalOutputEvent>("terminal://output", (event) => {
      if (event.session_id === sessionIdRef.current) {
        terminal.write(event.data);
      }
    }).then((unlisten) => {
      if (disposed) {
        unlisten();
        return;
      }
      unlistenOutput = unlisten;
    });

    void callBackend<TerminalSessionResponse>("open_terminal", {
      request: {
        connection_id: connectionId,
        cols: terminal.cols || 80,
        rows: terminal.rows || 24,
      },
    })
      .then((response) => {
        sessionIdRef.current = response.session_id;
        if (disposed) {
          void callBackend<void>("close_terminal", { sessionId: response.session_id });
          return;
        }
        terminal.writeln("Connected.");
        fitAndResizeBackend();
      })
      .catch((caught: unknown) => {
        terminal.writeln(`[devhub] ${caught instanceof Error ? caught.message : String(caught)}`);
      });

    return () => {
      disposed = true;
      if (resizeFrame !== null) {
        window.cancelAnimationFrame(resizeFrame);
      }
      resizeObserver?.disconnect();
      disposeInput?.dispose();
      unlistenOutput?.();
      const sessionId = sessionIdRef.current;
      sessionIdRef.current = null;
      if (sessionId) {
        void callBackend<void>("close_terminal", { sessionId });
      }
      terminal.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
    };
  }, [connectionId, fontFamily, fontSize]);

  useEffect(() => {
    if (!isActive || !terminalRef.current) return;
    terminalRef.current.focus();
    fitAddonRef.current?.fit();
    terminalRef.current.refresh(0, Math.max(0, terminalRef.current.rows - 1));
    const sessionId = sessionIdRef.current;
    if (!sessionId) return;
    void callBackend<void>("resize_terminal", {
      request: {
        session_id: sessionId,
        cols: terminalRef.current.cols || 80,
        rows: terminalRef.current.rows || 24,
      },
    });
  }, [isActive]);

  return (
    <>
      <div className="terminal-tab" aria-label="SSH 终端" ref={containerRef} onContextMenu={handleContextMenu} />
      <ContextMenu menu={contextMenu} onClose={() => setContextMenu(null)} />
    </>
  );
}
