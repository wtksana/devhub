import { describe, expect, it } from "vitest";
import {
  containsAnsiColor,
  createTerminalCommandTracker,
  createLogHighlighter,
  isTailCommand,
  isTailCommandVisibleLine,
  processLogOutput,
  stripAnsi,
} from "./logHighlight";
import type { TerminalLogHighlightSettings } from "../settings/settingsTypes";

const settings: TerminalLogHighlightSettings = {
  auto_detect_tail: true,
  case_sensitive: false,
  rules: [
    { pattern: "\\bERROR\\b", color: "#e06c75" },
    { pattern: "\\bWARN\\b", color: "#e5c07b" },
  ],
};

describe("terminal log highlight", () => {
  it("detects common tail commands", () => {
    expect(isTailCommand("tail -f /var/log/app.log\r")).toBe(true);
    expect(isTailCommand("sudo tail -n 200 -F app.log\r")).toBe(true);
    expect(isTailCommand("tailf app.log\r")).toBe(true);
    expect(isTailCommand("vim app.log\r")).toBe(false);
  });

  it("detects tail commands typed as separate terminal input chunks", () => {
    const tracker = createTerminalCommandTracker();
    const chunks = "tail -f /var/log/app.log\r".split("");

    const results = chunks.map((chunk) => tracker.push(chunk));

    expect(results.slice(0, -1).every((result) => !result.isTailCommand)).toBe(true);
    expect(results[results.length - 1]).toEqual({ command: "tail -f /var/log/app.log", isTailCommand: true });
  });

  it("detects tail commands inside visible shell prompt lines", () => {
    expect(isTailCommandVisibleLine("root@prod:~# tail -f /var/log/app.log")).toBe(true);
    expect(isTailCommandVisibleLine("$ sudo tail -n 200 -F app.log")).toBe(true);
    expect(isTailCommandVisibleLine("root@prod:~# vim app.log")).toBe(false);
  });

  it("highlights plain completed lines with configured colors", () => {
    const highlighter = createLogHighlighter(settings);

    const output = processLogOutput("2026 ERROR failed\nnext", highlighter);

    expect(output.data).toBe("2026 \x1b[38;2;224;108;117mERROR\x1b[39m failed\n");
    expect(output.pendingLine).toBe("next");
  });

  it("respects case sensitive matching", () => {
    const highlighter = createLogHighlighter({ ...settings, case_sensitive: true });

    const output = processLogOutput("error lower\nERROR upper\n", highlighter);

    expect(stripAnsi(output.data)).toBe("error lower\nERROR upper\n");
    expect(output.data).not.toContain("\x1b[38;2;224;108;117merror");
    expect(output.data).toContain("\x1b[38;2;224;108;117mERROR");
  });

  it("keeps server-colored lines unchanged", () => {
    const coloredLine = "\x1b[31mERROR\x1b[39m server colored\n";
    const highlighter = createLogHighlighter(settings);

    const output = processLogOutput(coloredLine, highlighter);

    expect(output.data).toBe(coloredLine);
    expect(containsAnsiColor(coloredLine)).toBe(true);
  });

  it("skips very long lines", () => {
    const highlighter = createLogHighlighter(settings);
    const line = `${"x".repeat(16 * 1024 + 1)} ERROR\n`;

    const output = processLogOutput(line, highlighter);

    expect(output.data).toBe(line);
  });

  it("merges overlapping highlights into a single ANSI span", () => {
    const highlighter = createLogHighlighter({
      ...settings,
      rules: [
        { pattern: "ERROR", color: "#e06c75" },
        { pattern: "ERR", color: "#e5c07b" },
      ],
    });

    const output = processLogOutput("ERROR failed\n", highlighter);

    expect(output.data).toBe("\x1b[38;2;224;108;117mERROR\x1b[39m failed\n");
  });

  it("limits highlight segments per line to keep terminal rendering responsive", () => {
    const highlighter = createLogHighlighter({
      ...settings,
      rules: [{ pattern: "x", color: "#e06c75" }],
    });

    const output = processLogOutput(`${"x ".repeat(80)}\n`, highlighter);

    expect(output.data.match(/\x1b\[38;2;224;108;117m/g)?.length).toBeLessThanOrEqual(24);
  });
});
