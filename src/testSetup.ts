import "@testing-library/jest-dom/vitest";
import { vi } from "vitest";

vi.mock("@xterm/xterm", () => ({
  Terminal: vi.fn(function (this: {
    cols: number;
    rows: number;
    loadAddon: ReturnType<typeof vi.fn>;
    open: ReturnType<typeof vi.fn>;
    write: ReturnType<typeof vi.fn>;
    writeln: ReturnType<typeof vi.fn>;
    onData: ReturnType<typeof vi.fn>;
    dispose: ReturnType<typeof vi.fn>;
    focus: ReturnType<typeof vi.fn>;
    refresh: ReturnType<typeof vi.fn>;
    scrollToBottom: ReturnType<typeof vi.fn>;
    getSelection: ReturnType<typeof vi.fn>;
    clear: ReturnType<typeof vi.fn>;
    options: Record<string, unknown>;
  }) {
    this.cols = 80;
    this.rows = 24;
    this.options = {};
    this.loadAddon = vi.fn();
    this.open = vi.fn();
    this.write = vi.fn();
    this.writeln = vi.fn();
    this.onData = vi.fn(() => ({ dispose: vi.fn() }));
    this.dispose = vi.fn();
    this.focus = vi.fn();
    this.refresh = vi.fn();
    this.scrollToBottom = vi.fn();
    this.getSelection = vi.fn(() => "");
    this.clear = vi.fn();
  }),
}));

vi.mock("@xterm/addon-fit", () => ({
  FitAddon: vi.fn(function (this: { fit: ReturnType<typeof vi.fn> }) {
    this.fit = vi.fn();
  }),
}));

vi.mock("@xterm/xterm/css/xterm.css", () => ({}));
