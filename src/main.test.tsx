import { afterEach, beforeEach, expect, it, vi } from "vitest";

const showMock = vi.fn();

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    show: showMock,
  }),
}));

vi.mock("react-dom/client", () => ({
  default: {
    createRoot: vi.fn(() => ({
      render: vi.fn(),
    })),
  },
}));

vi.mock("./App", () => ({
  default: () => null,
}));

beforeEach(() => {
  vi.resetModules();
  showMock.mockReset();
  document.body.innerHTML = '<div id="root"></div>';
});

afterEach(() => {
  document.body.innerHTML = "";
});

it("shows the hidden Tauri window after the frontend entry renders", async () => {
  await import("./main");

  expect(showMock).toHaveBeenCalledTimes(1);
});
