import "@testing-library/jest-dom/vitest";
import { vi } from "vitest";

vi.mock("@xterm/xterm", () => ({
  Terminal: class {
    loadAddon = vi.fn();
    open = vi.fn();
    writeln = vi.fn();
    dispose = vi.fn();
  },
}));

vi.mock("@xterm/addon-fit", () => ({
  FitAddon: class {
    fit = vi.fn();
  },
}));

vi.mock("@xterm/xterm/css/xterm.css", () => ({}));
