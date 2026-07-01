import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { WebglAddon } from "@xterm/addon-webgl";
import "@xterm/xterm/css/xterm.css";
import { ContextMenu, type ContextMenuState } from "../../app/ContextMenu";
import { readClipboardText, writeClipboardText } from "../../lib/clipboard";
import { callBackend, callBackendRaw, createBackendChannel, listenBackend } from "../../lib/tauri";
import { useI18n } from "../../i18n/useI18n";
import type { TerminalSettings } from "../settings/settingsTypes";
import {
  createTerminalInputTracker,
  extractCommandFromPromptLine,
  findCommandSuggestions,
  recordCommandHistory,
  type TerminalInputTracker,
} from "./commandHistory";
import { createLogHighlighter, createTerminalCommandTracker, isTailCommandVisibleLine, processLogOutput } from "./logHighlight";

export type TerminalConnectionStatus = "connecting" | "connected" | "failed" | "closed";

interface TerminalTabProps {
  connectionId: string;
  fontFamily: string;
  fontSize: number;
  theme: "dark" | "light";
  isActive: boolean;
  isVisible?: boolean;
  layoutVersion?: number | string;
  terminalSettings: TerminalSettings;
  onStatusChange?: (status: TerminalConnectionStatus) => void;
}

interface TerminalSessionResponse {
  session_id: string;
}

interface TerminalOutputEvent {
  session_id: string;
  data: string;
  status?: TerminalConnectionStatus;
}

interface TerminalSuggestionPosition {
  left: number;
  top: number;
}

interface XtermWithRenderDimensions extends Terminal {
  _core?: {
    _renderService?: {
      dimensions?: {
        css?: {
          cell?: {
            width?: number;
            height?: number;
          };
        };
      };
    };
  };
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

function containsLeaveAlternateScreenSequence(data: string) {
  return data.includes("\x1b[?1049l") || data.includes("\x1b[?1047l") || data.includes("\x1b[?47l");
}

function currentVisibleLine(terminal: Terminal) {
  const buffer = terminal.buffer?.active;
  if (!buffer) return "";
  const lineIndex = buffer.baseY + buffer.cursorY;
  return buffer.getLine(lineIndex)?.translateToString(true) ?? "";
}

function terminalCellSize(terminal: Terminal, fontSize: number) {
  const dimensions = (terminal as XtermWithRenderDimensions)._core?._renderService?.dimensions?.css?.cell;
  return {
    width: dimensions?.width && dimensions.width > 0 ? dimensions.width : Math.max(7, fontSize * 0.62),
    height: dimensions?.height && dimensions.height > 0 ? dimensions.height : Math.max(14, fontSize * 1.3),
  };
}

function terminalSuggestionPosition(
  terminal: Terminal,
  fontSize: number,
  container: HTMLElement | null,
  input: string,
): TerminalSuggestionPosition {
  const cell = terminalCellSize(terminal, fontSize);
  const buffer = terminal.buffer?.active;
  const visibleCommand = extractCommandFromPromptLine(currentVisibleLine(terminal));
  const pendingInputLength = Math.max(0, input.length - visibleCommand.length);
  const cursorX = (buffer?.cursorX ?? 0) + pendingInputLength;
  const cursorY = buffer?.cursorY ?? 0;
  const rawLeft = cursorX * cell.width;
  const rawTop = (cursorY + 1) * cell.height + 2;
  const containerWidth = container?.clientWidth || 0;
  const containerHeight = container?.clientHeight || 0;
  const maxLeft = containerWidth > 0 ? Math.max(8, containerWidth - 196) : rawLeft;
  const shouldOpenUp = containerHeight > 0 && rawTop + 190 > containerHeight;
  return {
    left: Math.max(8, Math.min(rawLeft, maxLeft)),
    top: shouldOpenUp ? Math.max(8, cursorY * cell.height - 194) : Math.max(8, rawTop),
  };
}

function isTerminalSessionErrorOutput(data: string) {
  return data.includes("[devhub] ssh error:") || data.includes("[devhub] io error:");
}

const TERMINAL_SCROLLBACK = 1000;
const TERMINAL_DIAGNOSTICS_STORAGE_KEY = "devhub.terminalDiagnostics";
const COMMAND_SUGGESTION_LIMIT = 8;
const TERMINAL_SESSION_ID_HEADER = "x-devhub-terminal-session-id";
const terminalInputEncoder = new TextEncoder();

function isTerminalDiagnosticsEnabled() {
  if (typeof window === "undefined") return false;
  const query = new URLSearchParams(window.location.search);
  return query.get("terminalDiagnostics") === "1" || window.localStorage.getItem(TERMINAL_DIAGNOSTICS_STORAGE_KEY) === "1";
}

export function TerminalTab({
  connectionId,
  fontFamily,
  fontSize,
  theme,
  isActive,
  isVisible = isActive,
  layoutVersion = 0,
  terminalSettings,
  onStatusChange,
}: TerminalTabProps) {
  const { t } = useI18n();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const lastSessionIdRef = useRef<string | null>(null);
  const isActiveRef = useRef(isActive);
  const terminalSettingsRef = useRef(terminalSettings);
  const onStatusChangeRef = useRef(onStatusChange);
  const connectionStatusRef = useRef<TerminalConnectionStatus>("connecting");
  const retryHintShownRef = useRef(false);
  const logHighlighterRef = useRef(createLogHighlighter(terminalSettings.log_highlight));
  const isManualLogHighlightModeRef = useRef(false);
  const setLogHighlightModeRef = useRef<((enabled: boolean) => void) | null>(null);
  const sendTerminalInputRef = useRef<((data: string) => void) | null>(null);
  const inputTrackerRef = useRef<TerminalInputTracker | null>(null);
  const lastBackendSizeRef = useRef<{ cols: number; rows: number } | null>(null);
  const webglAddonRef = useRef<WebglAddon | null>(null);
  const rendererRef = useRef<"dom" | "webgl">("dom");
  const commandSuggestionsRef = useRef<string[]>([]);
  const activeCommandSuggestionIndexRef = useRef(0);
  const [isManualLogHighlightMode, setIsManualLogHighlightMode] = useState(false);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [commandSuggestions, setCommandSuggestions] = useState<string[]>([]);
  const [activeCommandSuggestionIndex, setActiveCommandSuggestionIndex] = useState(0);
  const [commandSuggestionPosition, setCommandSuggestionPosition] = useState<TerminalSuggestionPosition>({
    left: 8,
    top: 28,
  });

  useEffect(() => {
    isActiveRef.current = isActive;
  }, [isActive]);

  useEffect(() => {
    terminalSettingsRef.current = terminalSettings;
    logHighlighterRef.current = createLogHighlighter(terminalSettings.log_highlight);
  }, [terminalSettings]);

  useEffect(() => {
    onStatusChangeRef.current = onStatusChange;
  }, [onStatusChange]);

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
      sendTerminalInputRef.current?.(text);
    } finally {
      refocusTerminal();
    }
  }

  function clearTerminal() {
    terminalRef.current?.clear();
    refocusTerminal();
  }

  function toggleLogHighlightMode() {
    const nextMode = !isManualLogHighlightModeRef.current;
    isManualLogHighlightModeRef.current = nextMode;
    setIsManualLogHighlightMode(nextMode);
    setLogHighlightModeRef.current?.(nextMode);
    refocusTerminal();
  }

  function refocusTerminal() {
    window.requestAnimationFrame(() => {
      terminalRef.current?.focus();
    });
  }

  function resizeBackendSessionIfChanged(sessionId: string, terminal: Terminal) {
    const cols = terminal.cols || 80;
    const rows = terminal.rows || 24;
    if (lastBackendSizeRef.current?.cols === cols && lastBackendSizeRef.current.rows === rows) return;
    lastBackendSizeRef.current = { cols, rows };
    resizeBackendSession(sessionId, cols, rows);
  }

  function resizeBackendSession(sessionId: string, cols: number, rows: number) {
    void callBackend<void>("resize_terminal", {
      request: {
        session_id: sessionId,
        cols,
        rows,
      },
    });
  }

  function kickAlternateScreenRedraw(sessionId: string, terminal: Terminal) {
    if (terminal.buffer?.active.type !== "alternate") return;
    const cols = terminal.cols || 80;
    const rows = terminal.rows || 24;
    resizeBackendSession(sessionId, cols, rows + 1);
    resizeBackendSession(sessionId, cols, rows);
    lastBackendSizeRef.current = { cols, rows };
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
        { type: "separator" },
        {
          label: isManualLogHighlightMode ? t("terminal.disable_log_highlight") : t("terminal.enable_log_highlight"),
          onSelect: toggleLogHighlightMode,
        },
      ],
    });
  }

  function logTerminalDiagnostics(reason: string, terminal = terminalRef.current) {
    if (!isTerminalDiagnosticsEnabled() || !terminal) return;
    const buffer = terminal.buffer?.active;
    console.info("[devhub] terminal diagnostics", {
      reason,
      connectionId,
      renderer: rendererRef.current,
      webglEnabled: rendererRef.current === "webgl",
      webglContextLost: reason === "webgl-context-lost",
      unicodeActiveVersion: terminal.unicode.activeVersion,
      unicodeVersions: terminal.unicode.versions,
      mouseTrackingMode: terminal.modes.mouseTrackingMode,
      bufferType: buffer?.type,
      cols: terminal.cols,
      rows: terminal.rows,
      cursorX: buffer?.cursorX,
      cursorY: buffer?.cursorY,
      lineCount: buffer?.length,
      canvasCount: containerRef.current?.querySelectorAll("canvas").length ?? 0,
    });
  }

  function handleAlternateScreenWheel() {
    const terminal = terminalRef.current;
    if (terminal?.buffer.active.type !== "alternate") return;
    logTerminalDiagnostics("alternate-wheel", terminal);
    terminal.focus();
  }

  function updateContainerTheme(themeName: "dark" | "light") {
    const terminalTheme = terminalThemes[themeName];
    if (!containerRef.current) return;
    containerRef.current.style.background = terminalTheme.background;
    containerRef.current.style.setProperty("--terminal-background", terminalTheme.background);
  }

  function clearCommittedInputIfStillPending(committedValue: string) {
    const input = containerRef.current?.querySelector("textarea");
    if (input?.value === committedValue) {
      input.value = "";
    }
  }

  function setVisibleCommandSuggestions(nextSuggestions: string[]) {
    commandSuggestionsRef.current = nextSuggestions;
    activeCommandSuggestionIndexRef.current = 0;
    setActiveCommandSuggestionIndex(0);
    setCommandSuggestions(nextSuggestions);
  }

  function moveActiveCommandSuggestion(direction: 1 | -1) {
    const suggestionCount = commandSuggestionsRef.current.length;
    if (suggestionCount === 0) return;
    const nextIndex = (activeCommandSuggestionIndexRef.current + direction + suggestionCount) % suggestionCount;
    activeCommandSuggestionIndexRef.current = nextIndex;
    setActiveCommandSuggestionIndex(nextIndex);
  }

  function isCommandCompletionAllowed() {
    const terminal = terminalRef.current;
    if (!terminal || !sessionIdRef.current) return false;
    if (terminal.buffer?.active && terminal.buffer.active.type !== "normal") return false;
    return true;
  }

  function updateCommandSuggestions(input: string) {
    if (!isCommandCompletionAllowed()) {
      setVisibleCommandSuggestions([]);
      return;
    }
    const terminal = terminalRef.current;
    if (terminal) {
      setCommandSuggestionPosition(terminalSuggestionPosition(terminal, fontSize, containerRef.current, input));
    }
    const suggestions = findCommandSuggestions(window.localStorage, connectionId, input, COMMAND_SUGGESTION_LIMIT);
    if (isTerminalDiagnosticsEnabled() && input.trimStart()) {
      console.info("[devhub] terminal command suggestions", {
        connectionId,
        inputLength: input.length,
        suggestionCount: suggestions.length,
        bufferType: terminalRef.current?.buffer?.active.type,
      });
    }
    setVisibleCommandSuggestions(suggestions);
  }

  function commandFromCurrentVisibleLine() {
    const terminal = terminalRef.current;
    if (!terminal || terminal.buffer?.active.type !== "normal") return "";
    return extractCommandFromPromptLine(currentVisibleLine(terminal));
  }

  function acceptCommandSuggestion(command: string) {
    const terminal = terminalRef.current;
    if (!terminal || !isCommandCompletionAllowed()) return;
    const inputTracker = inputTrackerRef.current;
    const currentInput = inputTracker?.getCurrentInput() ?? "";
    if (!command.toLowerCase().startsWith(currentInput.trimStart().toLowerCase())) return;
    const leadingWhitespace = currentInput.match(/^\s*/)?.[0] ?? "";
    const completedInput = `${leadingWhitespace}${command}`;
    const suffix = completedInput.slice(currentInput.length);
    setVisibleCommandSuggestions([]);
    if (!suffix) return;
    sendTerminalInputRef.current?.(suffix);
    setVisibleCommandSuggestions([]);
    refocusTerminal();
  }

  function activeCommandSuggestion() {
    return commandSuggestionsRef.current[activeCommandSuggestionIndexRef.current] ?? commandSuggestionsRef.current[0];
  }

  useEffect(() => {
    const terminalTheme = terminalThemes[theme];
    if (terminalRef.current) {
      terminalRef.current.options.theme = terminalTheme;
      if (isActiveRef.current) {
        fitAddonRef.current?.fit();
      }
    }
    updateContainerTheme(theme);
  }, [theme]);

  useEffect(() => {
    if (!containerRef.current) return;

    let disposed = false;
    let disposeInput: { dispose: () => void } | null = null;
    let disposeWebglContextLoss: { dispose: () => void } | null = null;
    let unlistenOutput: (() => void) | null = null;
    let resizeObserver: ResizeObserver | null = null;
    let resizeFrame: number | null = null;
    let recentOutputTail = "";
    let isLogHighlightMode = false;
    let pendingLogLine = "";
    const outputTextDecoder = new TextDecoder();
    const commandTracker = createTerminalCommandTracker();
    const inputTracker = createTerminalInputTracker();
    inputTrackerRef.current = inputTracker;
    let pendingOutput: TerminalOutputEvent[] = [];

    function setConnectionStatus(status: TerminalConnectionStatus) {
      connectionStatusRef.current = status;
      onStatusChangeRef.current?.(status);
    }

    function showRetryHint(message = "[devhub] 连接失败或超时，按 Enter 重连。") {
      if (retryHintShownRef.current) return;
      retryHintShownRef.current = true;
      terminal.writeln(message);
    }

    function closeBackendSession(sessionId: string) {
      void callBackend<void>("close_terminal", { sessionId });
    }

    const terminal = new Terminal({
      allowProposedApi: true,
      cursorBlink: true,
      fontFamily: `${fontFamily}, Consolas, monospace`,
      fontSize,
      theme: terminalThemes[theme],
      convertEol: false,
      minimumContrastRatio: 4.5,
      scrollback: TERMINAL_SCROLLBACK,
    });
    terminalRef.current = terminal;
    updateContainerTheme(theme);
    const fitAddon = new FitAddon();
    fitAddonRef.current = fitAddon;
    terminal.loadAddon(new Unicode11Addon());
    terminal.unicode.activeVersion = "11";
    terminal.loadAddon(fitAddon);
    terminal.open(containerRef.current);
    try {
      const webglAddon = new WebglAddon(true);
      terminal.loadAddon(webglAddon);
      webglAddonRef.current = webglAddon;
      rendererRef.current = "webgl";
      disposeWebglContextLoss = webglAddon.onContextLoss(() => {
        rendererRef.current = "dom";
        logTerminalDiagnostics("webgl-context-lost", terminal);
      });
    } catch {
      // Keep the default DOM renderer when WebGL is unavailable.
      rendererRef.current = "dom";
    }
    logTerminalDiagnostics("initialized", terminal);
    fitAddon.fit();
    terminal.focus();
    setConnectionStatus("connecting");
    const container = containerRef.current;
    container.addEventListener("wheel", handleAlternateScreenWheel, { capture: true });

    function fitAndResizeBackend() {
      if (!isActiveRef.current) return;
      fitAddon.fit();
      const sessionId = sessionIdRef.current;
      if (!sessionId) return;
      resizeBackendSessionIfChanged(sessionId, terminal);
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

    function scheduleScrollToBottom() {
      window.requestAnimationFrame(() => terminal.scrollToBottom());
    }

    function writeTerminalOutput(data: string | Uint8Array) {
      const outputText = typeof data === "string" ? data : outputTextDecoder.decode(data, { stream: true });
      if (!isActiveRef.current) {
        pendingLogLine = "";
        terminal.write(data);
        return;
      }
      const outputWindow = `${recentOutputTail}${outputText}`;
      recentOutputTail = outputWindow.slice(-32);
      if (isActiveRef.current && isLogHighlightMode && terminal.buffer.active.type === "normal") {
        const result = processLogOutput(outputText, logHighlighterRef.current, pendingLogLine);
        pendingLogLine = result.pendingLine;
        if (result.data) {
          terminal.write(result.data);
        }
      } else {
        pendingLogLine = "";
        terminal.write(data);
      }
      if (containsAlternateScreenSequence(outputWindow)) {
        scheduleScrollToBottom();
      }
      if (containsLeaveAlternateScreenSequence(outputWindow)) {
        scheduleScrollToBottom();
      }
    }

    setLogHighlightModeRef.current = (enabled: boolean) => {
      isLogHighlightMode = enabled;
      pendingLogLine = "";
    };

    function detectTailCommand(data: string) {
      const commandResult = commandTracker.push(data);
      if (!terminalSettingsRef.current.log_highlight.auto_detect_tail) return;
      if (commandResult.isTailCommand || ((data.includes("\r") || data.includes("\n")) && isTailCommandVisibleLine(currentVisibleLine(terminal)))) {
        isLogHighlightMode = true;
        pendingLogLine = "";
      }
    }

    function sendTerminalInput(data: string) {
      const canReconnect = connectionStatusRef.current === "failed" || connectionStatusRef.current === "closed";
      if (canReconnect && (data === "\r" || data === "\n")) {
        void openBackendSession();
        return;
      }
      const sessionId = sessionIdRef.current;
      if (!sessionId) return;
      if (data === "\x1b" && commandSuggestionsRef.current.length > 0) {
        setVisibleCommandSuggestions([]);
        return;
      }
      if (data === "\x1b[B" && commandSuggestionsRef.current.length > 0) {
        moveActiveCommandSuggestion(1);
        return;
      }
      if (data === "\x1b[A" && commandSuggestionsRef.current.length > 0) {
        moveActiveCommandSuggestion(-1);
        return;
      }
      if (data === "\t" && commandSuggestionsRef.current.length > 0 && isCommandCompletionAllowed()) {
        const command = activeCommandSuggestion();
        if (command) {
          acceptCommandSuggestion(command);
        }
        return;
      }
      detectTailCommand(data);
      if (isCommandCompletionAllowed()) {
        const inputResult = inputTracker.push(data);
        if (inputResult.submittedCommand !== undefined) {
          recordCommandHistory(window.localStorage, connectionId, commandFromCurrentVisibleLine() || inputResult.submittedCommand);
          setVisibleCommandSuggestions([]);
        } else {
          updateCommandSuggestions(inputResult.currentInput);
        }
      } else {
        inputTracker.clear();
        setVisibleCommandSuggestions([]);
      }
      if (data.includes("\x03")) {
        isLogHighlightMode = false;
        pendingLogLine = "";
        commandTracker.clear();
        inputTracker.clear();
        setVisibleCommandSuggestions([]);
        if (isManualLogHighlightModeRef.current) {
          isManualLogHighlightModeRef.current = false;
          setIsManualLogHighlightMode(false);
        }
      }
      void callBackendRaw<void>("write_terminal", terminalInputEncoder.encode(data), {
        [TERMINAL_SESSION_ID_HEADER]: sessionId,
      });
      window.setTimeout(() => clearCommittedInputIfStillPending(data), 0);
    }
    sendTerminalInputRef.current = sendTerminalInput;

    if (typeof ResizeObserver !== "undefined") {
      resizeObserver = new ResizeObserver(scheduleFit);
      resizeObserver.observe(containerRef.current);
    }

    disposeInput = terminal.onData((data) => {
      sendTerminalInput(data);
    });

    function handleTerminalOutput(event: TerminalOutputEvent) {
      const sessionId = sessionIdRef.current ?? lastSessionIdRef.current;
      if (!sessionId) {
        pendingOutput.push(event);
        return;
      }
      if (event.session_id === sessionId) {
        if (event.status) {
          setConnectionStatus(event.status);
          if (event.status === "closed") {
            showRetryHint("[devhub] 连接已断开，按 Enter 重连。");
          }
          if (event.status === "failed" || event.status === "closed") {
            closeBackendSession(sessionId);
            sessionIdRef.current = null;
          }
        }
        const isSessionError = isTerminalSessionErrorOutput(event.data);
        if (isSessionError) {
          setConnectionStatus("failed");
          closeBackendSession(sessionId);
          sessionIdRef.current = null;
        }
        if (event.data) {
          writeTerminalOutput(event.data);
        }
        if (event.status === "failed" || isSessionError) {
          showRetryHint();
        }
      }
    }

    async function openBackendSession() {
      setConnectionStatus("connecting");
      sessionIdRef.current = null;
      lastSessionIdRef.current = null;
      pendingOutput = [];
      retryHintShownRef.current = false;
      terminal.writeln(`Connecting to ${connectionId}...`);
      const onOutput = createBackendChannel<ArrayBuffer>();
      onOutput.onmessage = (data) => {
        if (disposed) return;
        writeTerminalOutput(new Uint8Array(data));
      };
      try {
        const response = await callBackend<TerminalSessionResponse>("open_terminal", {
          request: {
            connection_id: connectionId,
            cols: terminal.cols || 80,
            rows: terminal.rows || 24,
          },
          onOutput,
        });
        lastBackendSizeRef.current = { cols: terminal.cols || 80, rows: terminal.rows || 24 };
        sessionIdRef.current = response.session_id;
        lastSessionIdRef.current = response.session_id;
        if (disposed) {
          void callBackend<void>("close_terminal", { sessionId: response.session_id });
          return;
        }
        for (const event of pendingOutput) {
          if (event.session_id === response.session_id) {
            handleTerminalOutput(event);
          }
        }
        pendingOutput = [];
        scheduleFit();
      } catch (caught: unknown) {
        sessionIdRef.current = null;
        setConnectionStatus("failed");
        terminal.writeln(`[devhub] ${caught instanceof Error ? caught.message : String(caught)}`);
        showRetryHint();
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
        await openBackendSession();
      } catch (caught: unknown) {
        setConnectionStatus("failed");
        terminal.writeln(`[devhub] ${caught instanceof Error ? caught.message : String(caught)}`);
        showRetryHint();
      }
    })();

    return () => {
      disposed = true;
      if (resizeFrame !== null) {
        window.cancelAnimationFrame(resizeFrame);
      }
      resizeObserver?.disconnect();
      container.removeEventListener("wheel", handleAlternateScreenWheel, { capture: true });
      disposeInput?.dispose();
      disposeWebglContextLoss?.dispose();
      unlistenOutput?.();
      const sessionId = sessionIdRef.current;
      sessionIdRef.current = null;
      lastSessionIdRef.current = null;
      lastBackendSizeRef.current = null;
      setConnectionStatus("closed");
      if (sessionId) {
        closeBackendSession(sessionId);
      }
      terminal.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
      webglAddonRef.current = null;
      rendererRef.current = "dom";
      setLogHighlightModeRef.current = null;
      sendTerminalInputRef.current = null;
      inputTrackerRef.current = null;
    };
  }, [connectionId, fontFamily, fontSize]);

  useEffect(() => {
    if (!isActive || !terminalRef.current) return;
    terminalRef.current.focus();
    fitAddonRef.current?.fit();
    const sessionId = sessionIdRef.current;
    if (!sessionId) return;
    resizeBackendSessionIfChanged(sessionId, terminalRef.current);
    kickAlternateScreenRedraw(sessionId, terminalRef.current);
  }, [isActive]);

  useEffect(() => {
    if (!isVisible || !terminalRef.current) return;
    const frame = window.requestAnimationFrame(() => {
      const terminal = terminalRef.current;
      if (!terminal) return;
      fitAddonRef.current?.fit();
      terminal.scrollToBottom();
      const sessionId = sessionIdRef.current;
      if (!sessionId) return;
      resizeBackendSessionIfChanged(sessionId, terminal);
      kickAlternateScreenRedraw(sessionId, terminal);
    });
    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [isVisible, layoutVersion]);

  return (
    <>
      <div className="terminal-tab-shell">
        <div
          className="terminal-tab"
          aria-label={t("terminal.label")}
          ref={containerRef}
          onContextMenu={handleContextMenu}
        />
        {commandSuggestions.length > 0 ? (
          <div
            className="terminal-command-suggestions"
            role="listbox"
            aria-label="命令历史候选"
            style={{
              left: commandSuggestionPosition.left,
              top: commandSuggestionPosition.top,
            }}
          >
            {commandSuggestions.map((command, index) => (
              <button
                className="terminal-command-suggestions__item"
                key={command}
                type="button"
                role="option"
                aria-selected={index === activeCommandSuggestionIndex}
                data-active={index === activeCommandSuggestionIndex}
                onMouseDown={(event) => {
                  event.preventDefault();
                  acceptCommandSuggestion(command);
                }}
              >
                {command}
              </button>
            ))}
          </div>
        ) : null}
      </div>
      <ContextMenu menu={contextMenu} onClose={() => setContextMenu(null)} />
    </>
  );
}
