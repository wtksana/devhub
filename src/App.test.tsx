import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import App from "./App";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

test("renders scaffold heading", () => {
  render(<App />);

  expect(screen.getByRole("heading", { name: /welcome to tauri \+ react/i })).toBeInTheDocument();
});
