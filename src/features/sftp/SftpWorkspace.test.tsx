import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SftpWorkspace } from "./SftpWorkspace";
import { callBackend } from "../../lib/tauri";

vi.mock("../../lib/tauri", () => ({
  callBackend: vi.fn(),
}));

const callBackendMock = vi.mocked(callBackend);

describe("SftpWorkspace", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("prompts for a connection when none is selected", () => {
    render(<SftpWorkspace connectionId={null} />);
    expect(screen.getByText("未选择连接")).toBeInTheDocument();
  });

  it("shows toolbar for selected connection", () => {
    render(<SftpWorkspace connectionId="prod-web-01" />);
    expect(screen.getByRole("button", { name: "刷新" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "新建目录" })).toBeInTheDocument();
  });

  it("loads directory entries from backend", async () => {
    callBackendMock.mockResolvedValueOnce([
      {
        name: "logs",
        path: "/var/log",
        kind: "directory",
        size: 4096,
        permissions: "755",
      },
    ]);

    render(<SftpWorkspace connectionId="prod-web-01" />);
    await userEvent.click(screen.getByRole("button", { name: "刷新" }));

    await waitFor(() => {
      expect(callBackendMock).toHaveBeenCalledWith("list_directory", {
        request: { connection_id: "prod-web-01", path: "/" },
      });
    });
    expect(await screen.findByText("logs")).toBeInTheDocument();
  });
});
