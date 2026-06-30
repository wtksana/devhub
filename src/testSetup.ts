import "@testing-library/jest-dom/vitest";
import { vi } from "vitest";

Object.defineProperty(window, "requestAnimationFrame", {
  configurable: true,
  writable: true,
  value: vi.fn((callback: FrameRequestCallback) => window.setTimeout(() => callback(performance.now()), 0)),
});

Object.defineProperty(window, "cancelAnimationFrame", {
  configurable: true,
  writable: true,
  value: vi.fn((handle: number) => window.clearTimeout(handle)),
});

vi.mock("@xterm/xterm", () => ({
  Terminal: vi.fn(function (this: {
    cols: number;
    rows: number;
    loadAddon: ReturnType<typeof vi.fn>;
    open: ReturnType<typeof vi.fn>;
    write: ReturnType<typeof vi.fn>;
    writeln: ReturnType<typeof vi.fn>;
    onData: ReturnType<typeof vi.fn>;
    onWriteParsed: ReturnType<typeof vi.fn>;
    dispose: ReturnType<typeof vi.fn>;
    focus: ReturnType<typeof vi.fn>;
    refresh: ReturnType<typeof vi.fn>;
    scrollToBottom: ReturnType<typeof vi.fn>;
    getSelection: ReturnType<typeof vi.fn>;
    clear: ReturnType<typeof vi.fn>;
    options: Record<string, unknown>;
    unicode: { activeVersion: string };
    modes: { mouseTrackingMode: "none" };
  }) {
    this.cols = 80;
    this.rows = 24;
    this.options = {};
    this.unicode = { activeVersion: "6" };
    this.modes = { mouseTrackingMode: "none" };
    this.loadAddon = vi.fn();
    this.open = vi.fn();
    this.write = vi.fn();
    this.writeln = vi.fn();
    this.onData = vi.fn(() => ({ dispose: vi.fn() }));
    this.onWriteParsed = vi.fn(() => ({ dispose: vi.fn() }));
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

vi.mock("@xterm/addon-unicode11", () => ({
  Unicode11Addon: vi.fn(function () {}),
}));

vi.mock("@xterm/addon-webgl", () => ({
  WebglAddon: vi.fn(function (this: {
    clearTextureAtlas: ReturnType<typeof vi.fn>;
    dispose: ReturnType<typeof vi.fn>;
    onContextLoss: ReturnType<typeof vi.fn>;
  }) {
    this.clearTextureAtlas = vi.fn();
    this.dispose = vi.fn();
    this.onContextLoss = vi.fn(() => ({ dispose: vi.fn() }));
  }),
}));

vi.mock("@xterm/xterm/css/xterm.css", () => ({}));
