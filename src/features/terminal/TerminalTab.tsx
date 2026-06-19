import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { ContextMenu, type ContextMenuState } from "../../app/ContextMenu";
import { readClipboardText, writeClipboardText } from "../../lib/clipboard";
import { callBackend, listenBackend } from "../../lib/tauri";
import { useI18n } from "../../i18n/useI18n";

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

function hexToRgb(hex: string) {
  const normalized = hex.replace("#", "");
  return {
    r: Number.parseInt(normalized.slice(0, 2), 16),
    g: Number.parseInt(normalized.slice(2, 4), 16),
    b: Number.parseInt(normalized.slice(4, 6), 16),
  };
}

function relativeLuminance(hex: string) {
  const { r, g, b } = hexToRgb(hex);
  const channels = [r, g, b].map((channel) => {
    const value = channel / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrastRatio(first: string, second: string) {
  const firstLuminance = relativeLuminance(first);
  const secondLuminance = relativeLuminance(second);
  const lighter = Math.max(firstLuminance, secondLuminance);
  const darker = Math.min(firstLuminance, secondLuminance);
  return (lighter + 0.05) / (darker + 0.05);
}

function toHex(value: number) {
  return value.toString(16).padStart(2, "0");
}

function xtermColorCubeValue(index: number) {
  return [0x00, 0x5f, 0x87, 0xaf, 0xd7, 0xff][index];
}

function createReadableExtendedAnsi(background: string, foreground: string) {
  const colors: string[] = [];
  for (let index = 0; index < 216; index += 1) {
    const red = xtermColorCubeValue(Math.floor(index / 36) % 6);
    const green = xtermColorCubeValue(Math.floor(index / 6) % 6);
    const blue = xtermColorCubeValue(index % 6);
    colors.push(`#${toHex(red)}${toHex(green)}${toHex(blue)}`);
  }
  for (let index = 0; index < 24; index += 1) {
    const channel = 8 + index * 10;
    colors.push(`#${toHex(channel)}${toHex(channel)}${toHex(channel)}`);
  }
  return colors.map((color) => (contrastRatio(color, background) < 2.2 ? foreground : color));
}

const terminalThemes = {
  dark: {
    background: "#282c34",
    foreground: "#abb2bf",
    cursor: "#abb2bf",
    cursorAccent: "#282c34",
    selectionBackground: "#3e4451",
    black: "#5c6370",
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
    extendedAnsi: createReadableExtendedAnsi("#282c34", "#abb2bf"),
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
    white: "#383a42",
    brightBlack: "#a0a1a7",
    brightRed: "#e45649",
    brightGreen: "#50a14f",
    brightYellow: "#c18401",
    brightBlue: "#4078f2",
    brightMagenta: "#a626a4",
    brightCyan: "#0184bc",
    brightWhite: "#383a42",
    extendedAnsi: createReadableExtendedAnsi("#fafafa", "#383a42"),
  },
} as const;

function containsAlternateScreenSequence(data: string) {
  return data.includes("\x1b[?1049h") || data.includes("\x1b[?1047h") || data.includes("\x1b[?47h");
}

export function TerminalTab({ connectionId, fontFamily, fontSize, theme, isActive }: TerminalTabProps) {
  const { t } = useI18n();
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
        { label: t("terminal.copy"), onSelect: copySelection },
        { label: t("terminal.paste"), onSelect: () => void pasteClipboard() },
        { label: t("terminal.clear"), onSelect: clearTerminal },
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
    let redrawProbeTimer: number | null = null;
    let recentOutputTail = "";
    let hasRequestedAlternateScreenRedraw = false;
    let pendingOutput: TerminalOutputEvent[] = [];

    const terminal = new Terminal({
      cursorBlink: true,
      fontFamily: `${fontFamily}, Consolas, monospace`,
      fontSize,
      theme: terminalThemes[theme],
      convertEol: false,
      minimumContrastRatio: 4.5,
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

    function nonEmptyVisibleLineCount() {
      const buffer = terminal.buffer.active;
      const lineCount = Math.min(buffer.length, terminal.rows || 24);
      let count = 0;
      for (let index = 0; index < lineCount; index += 1) {
        const text = buffer.getLine(index)?.translateToString(true).trim() ?? "";
        if (text.length > 0) {
          count += 1;
        }
      }
      return count;
    }

    function scheduleAlternateScreenRedrawProbe() {
      if (redrawProbeTimer !== null) {
        window.clearTimeout(redrawProbeTimer);
      }
      redrawProbeTimer = window.setTimeout(() => {
        redrawProbeTimer = null;
        const sessionId = sessionIdRef.current;
        if (disposed || !sessionId || hasRequestedAlternateScreenRedraw) return;
        if (terminal.buffer.active.type !== "alternate") return;
        if (nonEmptyVisibleLineCount() > 3) return;
        hasRequestedAlternateScreenRedraw = true;
        void callBackend<void>("write_terminal", {
          request: { session_id: sessionId, data: "\f" },
        });
      }, 48);
    }

    function writeTerminalOutput(data: string) {
      const outputWindow = `${recentOutputTail}${data}`;
      recentOutputTail = outputWindow.slice(-32);
      terminal.write(data);
      if (containsAlternateScreenSequence(outputWindow)) {
        hasRequestedAlternateScreenRedraw = false;
        scheduleAlternateScreenRedrawProbe();
      }
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

    function handleTerminalOutput(event: TerminalOutputEvent) {
      const sessionId = sessionIdRef.current;
      if (!sessionId) {
        pendingOutput.push(event);
        return;
      }
      if (event.session_id === sessionId) {
        writeTerminalOutput(event.data);
      }
    }

    void (async () => {
      try {
        const unlisten = await listenBackend<TerminalOutputEvent>("terminal://output", handleTerminalOutput);
        if (disposed) {
          unlisten();
          return;
        }
        unlistenOutput = unlisten;

        const response = await callBackend<TerminalSessionResponse>("open_terminal", {
          request: {
            connection_id: connectionId,
            cols: terminal.cols || 80,
            rows: terminal.rows || 24,
          },
        });
        sessionIdRef.current = response.session_id;
        if (disposed) {
          void callBackend<void>("close_terminal", { sessionId: response.session_id });
          return;
        }
        terminal.writeln("Connected.");
        for (const event of pendingOutput) {
          if (event.session_id === response.session_id) {
            writeTerminalOutput(event.data);
          }
        }
        pendingOutput = [];
        scheduleFit();
      } catch (caught: unknown) {
        terminal.writeln(`[devhub] ${caught instanceof Error ? caught.message : String(caught)}`);
      }
    })();

    return () => {
      disposed = true;
      if (resizeFrame !== null) {
        window.cancelAnimationFrame(resizeFrame);
      }
      if (redrawProbeTimer !== null) {
        window.clearTimeout(redrawProbeTimer);
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
      <div className="terminal-tab" aria-label={t("terminal.label")} ref={containerRef} onContextMenu={handleContextMenu} />
      <ContextMenu menu={contextMenu} onClose={() => setContextMenu(null)} />
    </>
  );
}
