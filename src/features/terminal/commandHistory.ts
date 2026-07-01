const STORAGE_KEY_PREFIX = "devhub.terminal.commandHistory.";
const MAX_COMMAND_LENGTH = 2048;
const DEFAULT_MAX_ENTRIES = 1000;

export interface TerminalInputTrackerResult {
  currentInput: string;
  submittedCommand?: string;
}

export interface TerminalInputTracker {
  push: (data: string) => TerminalInputTrackerResult;
  clear: () => void;
  getCurrentInput: () => string;
}

function storageKey(connectionId: string) {
  return `${STORAGE_KEY_PREFIX}${encodeURIComponent(connectionId)}`;
}

function connectionIdFromStorageKey(key: string) {
  if (!key.startsWith(STORAGE_KEY_PREFIX)) return "";
  try {
    return decodeURIComponent(key.slice(STORAGE_KEY_PREFIX.length));
  } catch {
    return "";
  }
}

function normalizeCommand(command: string) {
  return command.trim();
}

function isSensitiveCommand(command: string) {
  const normalized = command.toLowerCase();
  return (
    normalized === "passwd" ||
    normalized.startsWith("passwd ") ||
    /\bsshpass\s+-p\b/.test(normalized) ||
    /\b--password(?:=|\s+)/.test(normalized) ||
    /\bpassword=/.test(normalized) ||
    /\b-p\S+/.test(normalized) && /\bmysql\b/.test(normalized)
  );
}

export function readCommandHistory(storage: Storage, connectionId: string) {
  try {
    const raw = storage.getItem(storageKey(connectionId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === "string").slice(0, DEFAULT_MAX_ENTRIES);
  } catch {
    return [];
  }
}

export interface StoredCommandHistory {
  connectionId: string;
  commands: string[];
}

export function listStoredCommandHistories(storage: Storage): StoredCommandHistory[] {
  const histories: StoredCommandHistory[] = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (!key?.startsWith(STORAGE_KEY_PREFIX)) continue;
    const connectionId = connectionIdFromStorageKey(key);
    if (!connectionId) continue;
    histories.push({ connectionId, commands: readCommandHistory(storage, connectionId) });
  }
  return histories
    .filter((history) => history.commands.length > 0)
    .sort((left, right) => left.connectionId.localeCompare(right.connectionId));
}

export function removeCommandHistoryEntry(storage: Storage, connectionId: string, command: string) {
  const nextCommands = readCommandHistory(storage, connectionId).filter((item) => item !== command);
  try {
    if (nextCommands.length === 0) {
      storage.removeItem(storageKey(connectionId));
      return;
    }
    storage.setItem(storageKey(connectionId), JSON.stringify(nextCommands));
  } catch {
    // localStorage 失败不应影响设置页其他操作。
  }
}

export function recordCommandHistory(
  storage: Storage,
  connectionId: string,
  command: string,
  maxEntries = DEFAULT_MAX_ENTRIES,
) {
  const normalized = normalizeCommand(command);
  if (!normalized || normalized.length > MAX_COMMAND_LENGTH || isSensitiveCommand(normalized)) return;
  const previous = readCommandHistory(storage, connectionId);
  const next = [normalized, ...previous.filter((item) => item !== normalized)].slice(0, maxEntries);
  try {
    storage.setItem(storageKey(connectionId), JSON.stringify(next));
  } catch {
    // localStorage 可能被禁用或超出容量，命令补全失败不应影响终端输入。
  }
}

export function findCommandSuggestions(storage: Storage, connectionId: string, input: string, limit = 8) {
  const normalizedInput = input.trimStart().toLowerCase();
  if (!normalizedInput) return [];
  return readCommandHistory(storage, connectionId)
    .filter((command) => command.toLowerCase().startsWith(normalizedInput))
    .slice(0, limit);
}

export function extractCommandFromPromptLine(line: string) {
  const visibleLine = line.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "").trimEnd();
  const promptMatch = visibleLine.match(/(?:^|\s)(?:\[[^\]\r\n]+]|[^\s@$#>]+@[^\s:]+(?::[^\r\n]*)?|[A-Za-z0-9_.-]+)\s*[$#>]\s+(.+)$/);
  return normalizeCommand(promptMatch?.[1] ?? "");
}

export function createTerminalInputTracker(): TerminalInputTracker {
  let buffer = "";
  let escapeSequence = "";
  return {
    push(data: string) {
      for (let index = 0; index < data.length; index += 1) {
        const char = data[index];
        if (escapeSequence) {
          escapeSequence += char;
          if (isCompleteEscapeSequence(escapeSequence)) {
            escapeSequence = "";
          }
          continue;
        }
        if (char === "\x1b") {
          if (index === data.length - 1) {
            escapeSequence = "";
            continue;
          }
          escapeSequence = char;
          continue;
        }
        if (char === "\x03") {
          buffer = "";
          escapeSequence = "";
          return { currentInput: "" };
        }
        if (char === "\b" || char === "\x7f") {
          buffer = buffer.slice(0, -1);
          continue;
        }
        if (char === "\r" || char === "\n") {
          const submittedCommand = normalizeCommand(buffer);
          buffer = "";
          return { currentInput: "", submittedCommand };
        }
        if (char >= " ") {
          buffer += char;
          if (buffer.length > MAX_COMMAND_LENGTH) {
            buffer = buffer.slice(-MAX_COMMAND_LENGTH);
          }
        }
      }
      return { currentInput: buffer };
    },
    clear() {
      buffer = "";
      escapeSequence = "";
    },
    getCurrentInput() {
      return buffer;
    },
  };
}

function isCompleteEscapeSequence(sequence: string) {
  if (sequence.length <= 1) return false;
  if (sequence[1] === "[") {
    if (sequence.length <= 2) return false;
    return /[\x40-\x7e]$/.test(sequence);
  }
  if (sequence[1] === "]") {
    return sequence.endsWith("\x07") || sequence.endsWith("\x1b\\");
  }
  return true;
}
