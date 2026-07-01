import { describe, expect, it } from "vitest";
import {
  createTerminalInputTracker,
  extractCommandFromPromptLine,
  findCommandSuggestions,
  listStoredCommandHistories,
  readCommandHistory,
  recordCommandHistory,
  removeCommandHistoryEntry,
} from "./commandHistory";

class MemoryStorage implements Storage {
  private values = new Map<string, string>();

  get length() {
    return this.values.size;
  }

  clear(): void {
    this.values.clear();
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  key(index: number): string | null {
    return Array.from(this.values.keys())[index] ?? null;
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

describe("commandHistory", () => {
  it("stores commands per connection with newest deduped first", () => {
    const storage = new MemoryStorage();

    recordCommandHistory(storage, "prod", "ls -la");
    recordCommandHistory(storage, "test", "pwd");
    recordCommandHistory(storage, "prod", "tail -f app.log");
    recordCommandHistory(storage, "prod", "ls -la");

    expect(readCommandHistory(storage, "prod")).toEqual(["ls -la", "tail -f app.log"]);
    expect(readCommandHistory(storage, "test")).toEqual(["pwd"]);
  });

  it("keeps history bounded by max entries", () => {
    const storage = new MemoryStorage();

    recordCommandHistory(storage, "prod", "one", 2);
    recordCommandHistory(storage, "prod", "two", 2);
    recordCommandHistory(storage, "prod", "three", 2);

    expect(readCommandHistory(storage, "prod")).toEqual(["three", "two"]);
  });

  it("does not store empty or password-like commands", () => {
    const storage = new MemoryStorage();

    recordCommandHistory(storage, "prod", "   ");
    recordCommandHistory(storage, "prod", "passwd");
    recordCommandHistory(storage, "prod", "mysql --password=secret");
    recordCommandHistory(storage, "prod", "sshpass -p secret ssh root@example.com");
    recordCommandHistory(storage, "prod", "echo ok");

    expect(readCommandHistory(storage, "prod")).toEqual(["echo ok"]);
  });

  it("suggests commands by prefix case-insensitively", () => {
    const storage = new MemoryStorage();
    recordCommandHistory(storage, "prod", "docker ps");
    recordCommandHistory(storage, "prod", "docker logs api");
    recordCommandHistory(storage, "prod", "systemctl status nginx");

    expect(findCommandSuggestions(storage, "prod", "DO", 5)).toEqual(["docker logs api", "docker ps"]);
    expect(findCommandSuggestions(storage, "prod", "", 5)).toEqual([]);
  });

  it("lists and removes stored command history entries", () => {
    const storage = new MemoryStorage();
    recordCommandHistory(storage, "prod", "nginx -t");
    recordCommandHistory(storage, "prod", "systemctl status nginx");
    recordCommandHistory(storage, "test", "pwd");

    expect(listStoredCommandHistories(storage)).toEqual([
      { connectionId: "prod", commands: ["systemctl status nginx", "nginx -t"] },
      { connectionId: "test", commands: ["pwd"] },
    ]);

    removeCommandHistoryEntry(storage, "prod", "nginx -t");
    removeCommandHistoryEntry(storage, "test", "pwd");

    expect(listStoredCommandHistories(storage)).toEqual([
      { connectionId: "prod", commands: ["systemctl status nginx"] },
    ]);
  });

  it("finds matching commands after removing one entry", () => {
    const storage = new MemoryStorage();
    recordCommandHistory(storage, "prod", "nginx -t");
    recordCommandHistory(storage, "prod", "nginx -s reload");

    removeCommandHistoryEntry(storage, "prod", "nginx -s reload");

    expect(findCommandSuggestions(storage, "prod", "ng", 5)).toEqual(["nginx -t"]);
  });

  it("tracks the current terminal input and submitted command", () => {
    const tracker = createTerminalInputTracker();

    expect(tracker.push("tail -f app.log")).toEqual({ currentInput: "tail -f app.log" });
    expect(tracker.push("\b\b")).toEqual({ currentInput: "tail -f app.l" });
    expect(tracker.push("og\r")).toEqual({ currentInput: "", submittedCommand: "tail -f app.log" });
    expect(tracker.push("next\x03")).toEqual({ currentInput: "" });
  });

  it("ignores terminal escape sequences while tracking input", () => {
    const tracker = createTerminalInputTracker();

    expect(tracker.push("docker")).toEqual({ currentInput: "docker" });
    expect(tracker.push("\x1b[D\x1b[C")).toEqual({ currentInput: "docker" });
    expect(tracker.push(" ps\r")).toEqual({ currentInput: "", submittedCommand: "docker ps" });
  });

  it("does not let a standalone escape consume following input", () => {
    const tracker = createTerminalInputTracker();

    expect(tracker.push("do")).toEqual({ currentInput: "do" });
    expect(tracker.push("\x1b")).toEqual({ currentInput: "do" });
    expect(tracker.push("cker\r")).toEqual({ currentInput: "", submittedCommand: "docker" });
  });

  it("extracts commands recalled by the remote shell from visible prompt lines", () => {
    expect(extractCommandFromPromptLine("[root@iZbp1eft6pfqx29qy0vuv8Z ~]# nginx -t")).toBe("nginx -t");
    expect(extractCommandFromPromptLine("root@dev:~/app$ docker compose ps")).toBe("docker compose ps");
    expect(extractCommandFromPromptLine("mysql> show tables;")).toBe("show tables;");
    expect(extractCommandFromPromptLine("Welcome to server")).toBe("");
  });
});
