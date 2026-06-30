import type { TerminalLogHighlightSettings } from "../settings/settingsTypes";

const ANSI_COLOR_PATTERN = /\x1b\[(?:\d{1,3};)*\d{1,3}m/;
const TERMINAL_CONTROL_PATTERN = /\x1b(?:\[[0-9;?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1b\\)|[@-Z\\-_])/;
const MAX_HIGHLIGHT_LINE_LENGTH = 16 * 1024;
const MAX_RULES = 50;
const MAX_HIGHLIGHT_SEGMENTS_PER_LINE = 24;

interface CompiledRule {
  regex: RegExp;
  ansiColor: string;
}

export interface LogHighlighter {
  rules: CompiledRule[];
}

export interface ProcessLogOutputResult {
  data: string;
  pendingLine: string;
}

export interface TerminalCommandTrackerResult {
  command: string;
  isTailCommand: boolean;
}

export interface TerminalCommandTracker {
  push: (data: string) => TerminalCommandTrackerResult;
  clear: () => void;
}

export function containsAnsiColor(value: string) {
  return ANSI_COLOR_PATTERN.test(value);
}

export function stripAnsi(value: string) {
  return value.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "");
}

export function isTailCommand(data: string) {
  const command = stripAnsi(data).trim();
  return /^(?:sudo\s+)?(?:tailf\b|tail\b.*(?:\s-[^\r\n]*[fF]\b|-[fF]\b))/.test(command);
}

export function isTailCommandVisibleLine(data: string) {
  const line = stripAnsi(data).trim();
  if (isTailCommand(line)) return true;
  const commandMatch = line.match(/(?:^|[\s#$>%])((?:sudo\s+)?(?:tailf\b.*|tail\b.*(?:\s-[^\r\n]*[fF]\b|-[fF]\b).*))$/);
  return Boolean(commandMatch && isTailCommand(commandMatch[1]));
}

export function createTerminalCommandTracker(): TerminalCommandTracker {
  let buffer = "";
  return {
    push(data: string) {
      for (const char of data) {
        if (char === "\x03") {
          buffer = "";
          return { command: "", isTailCommand: false };
        }
        if (char === "\b" || char === "\x7f") {
          buffer = buffer.slice(0, -1);
          continue;
        }
        if (char === "\r" || char === "\n") {
          const command = buffer.trim();
          buffer = "";
          return { command, isTailCommand: isTailCommand(command) };
        }
        if (char >= " ") {
          buffer += char;
          if (buffer.length > 4096) {
            buffer = buffer.slice(-4096);
          }
        }
      }
      return { command: buffer.trim(), isTailCommand: false };
    },
    clear() {
      buffer = "";
    },
  };
}

export function createLogHighlighter(settings: TerminalLogHighlightSettings): LogHighlighter {
  const flags = settings.case_sensitive ? "g" : "gi";
  const rules = settings.rules.slice(0, MAX_RULES).flatMap((rule) => {
    try {
      return [{ regex: new RegExp(rule.pattern, flags), ansiColor: hexToAnsiColor(rule.color) }];
    } catch {
      return [];
    }
  });
  return { rules };
}

export function processLogOutput(data: string, highlighter: LogHighlighter, pendingLine = ""): ProcessLogOutputResult {
  const combined = `${pendingLine}${data}`;
  const lastNewlineIndex = combined.lastIndexOf("\n");
  if (lastNewlineIndex === -1) {
    return { data: "", pendingLine: combined };
  }

  const completeText = combined.slice(0, lastNewlineIndex + 1);
  const nextPendingLine = combined.slice(lastNewlineIndex + 1);
  const highlighted = completeText
    .split(/(\n)/)
    .reduce((result, part, index, parts) => {
      if (part !== "\n") {
        return result + highlightLine(part + (parts[index + 1] === "\n" ? "\n" : ""), highlighter);
      }
      return result;
    }, "");

  return { data: highlighted, pendingLine: nextPendingLine };
}

function highlightLine(line: string, highlighter: LogHighlighter) {
  if (line.length > MAX_HIGHLIGHT_LINE_LENGTH || TERMINAL_CONTROL_PATTERN.test(line)) {
    return line;
  }

  const segments = collectHighlightSegments(line, highlighter);
  if (segments.length === 0) {
    return line;
  }

  let result = "";
  let cursor = 0;
  for (const segment of segments) {
    result += line.slice(cursor, segment.start);
    result += `${segment.ansiColor}${line.slice(segment.start, segment.end)}\x1b[39m`;
    cursor = segment.end;
  }
  result += line.slice(cursor);
  return result;
}

interface HighlightSegment {
  start: number;
  end: number;
  ansiColor: string;
}

function collectHighlightSegments(line: string, highlighter: LogHighlighter): HighlightSegment[] {
  const candidates: HighlightSegment[] = [];
  for (const rule of highlighter.rules) {
    rule.regex.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = rule.regex.exec(line)) !== null) {
      const value = match[0];
      if (!value) {
        rule.regex.lastIndex += 1;
        continue;
      }
      candidates.push({
        start: match.index,
        end: match.index + value.length,
        ansiColor: rule.ansiColor,
      });
      if (candidates.length >= MAX_HIGHLIGHT_SEGMENTS_PER_LINE * highlighter.rules.length) {
        break;
      }
    }
  }

  candidates.sort((first, second) => first.start - second.start || second.end - first.end);
  const segments: HighlightSegment[] = [];
  for (const candidate of candidates) {
    const previous = segments[segments.length - 1];
    if (previous && candidate.start < previous.end) {
      continue;
    }
    segments.push(candidate);
    if (segments.length >= MAX_HIGHLIGHT_SEGMENTS_PER_LINE) {
      break;
    }
  }
  return segments;
}

function hexToAnsiColor(color: string) {
  const normalized = color.replace("#", "");
  const red = Number.parseInt(normalized.slice(0, 2), 16);
  const green = Number.parseInt(normalized.slice(2, 4), 16);
  const blue = Number.parseInt(normalized.slice(4, 6), 16);
  return `\x1b[38;2;${red};${green};${blue}m`;
}
