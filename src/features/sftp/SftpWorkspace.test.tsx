import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SftpWorkspace } from "./SftpWorkspace";
import { callBackend } from "../../lib/tauri";
import { writeClipboardText } from "../../lib/clipboard";
import { pickDownloadPath, pickUploadFile } from "../../lib/fileDialog";
import { listenSftpTransferProgress } from "../../lib/tauriEvents";

vi.mock("../../lib/tauri", () => ({
  callBackend: vi.fn(),
}));

vi.mock("../../lib/clipboard", () => ({
  writeClipboardText: vi.fn(),
}));

vi.mock("../../lib/fileDialog", () => ({
  pickUploadFile: vi.fn(),
  pickDownloadPath: vi.fn(),
}));

vi.mock("../../lib/tauriEvents", () => ({
  listenSftpTransferProgress: vi.fn(),
}));

const callBackendMock = vi.mocked(callBackend);
const writeClipboardTextMock = vi.mocked(writeClipboardText);
const pickUploadFileMock = vi.mocked(pickUploadFile);
const pickDownloadPathMock = vi.mocked(pickDownloadPath);
const listenSftpTransferProgressMock = vi.mocked(listenSftpTransferProgress);

describe("SftpWorkspace", () => {
  let progressHandler: ((payload: { transfer_id: string; progress: number }) => void) | null = null;

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    progressHandler = null;
  });

  beforeEach(() => {
    listenSftpTransferProgressMock.mockImplementation((handler) => {
      progressHandler = handler;
      return Promise.resolve(() => undefined);
    });
  });

  function mockOpenSession(entries: unknown[] = []) {
    callBackendMock.mockResolvedValueOnce({ session_id: "sftp-session-1" });
    callBackendMock.mockResolvedValueOnce(entries);
  }

  async function waitForInitialLoad() {
    await waitFor(() => {
      expect(callBackendMock).toHaveBeenCalledWith("open_sftp_session", {
        request: { connection_id: "prod-web-01" },
      });
    });
    await waitFor(() => {
      expect(callBackendMock).toHaveBeenCalledWith("list_sftp_directory", {
        request: { session_id: "sftp-session-1", path: "/" },
      });
    });
  }

  it("prompts for a connection when none is selected", () => {
    render(<SftpWorkspace connectionId={null} />);
    expect(screen.getByText("未选择连接")).toBeInTheDocument();
  });

  it("renders sftp dialogs with the clipped shared dialog container", async () => {
    mockOpenSession();

    render(<SftpWorkspace connectionId="prod-web-01" />);

    await waitForInitialLoad();
    await userEvent.pointer({ keys: "[MouseRight]", target: screen.getByLabelText("SFTP 文件列表") });
    await userEvent.click(screen.getByRole("menuitem", { name: "新建文件夹" }));

    const dialog = screen.getByRole("dialog", { name: "新建文件夹" });
    expect(dialog).toHaveClass("connection-dialog");
    expect(dialog.querySelector(".connection-dialog__header")).toBeInTheDocument();
  });

  it("shows toolbar for selected connection", () => {
    mockOpenSession();

    render(<SftpWorkspace connectionId="prod-web-01" />);

    expect(screen.getByRole("button", { name: "刷新" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "新建目录" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "后退" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "前进" })).toBeDisabled();
  });

  it("loads directory entries from backend", async () => {
    mockOpenSession([
      {
        name: "logs",
        path: "/var/log",
        kind: "directory",
        size: 4096,
        permissions: "755",
      },
    ]);

    render(<SftpWorkspace connectionId="prod-web-01" />);

    await waitForInitialLoad();
    expect(await screen.findByText("logs")).toBeInTheDocument();
  });

  it("opens a directory by double clicking it", async () => {
    mockOpenSession([
      {
        name: "logs",
        path: "/var/log",
        kind: "directory",
        size: 4096,
      },
    ]);
    callBackendMock.mockResolvedValueOnce([
      {
        name: "app.log",
        path: "/var/log/app.log",
        kind: "file",
        size: 128,
      },
    ]);

    render(<SftpWorkspace connectionId="prod-web-01" />);

    await waitForInitialLoad();
    await userEvent.dblClick(await screen.findByText("logs"));

    await waitFor(() => {
      expect(callBackendMock).toHaveBeenCalledWith("list_sftp_directory", {
        request: { session_id: "sftp-session-1", path: "/var/log" },
      });
    });
    expect(screen.getByLabelText("远程路径")).toHaveValue("/var/log");
    expect(await screen.findByText("app.log")).toBeInTheDocument();
  });

  it("jumps to the path entered in the address bar", async () => {
    mockOpenSession();
    callBackendMock.mockResolvedValueOnce([
      {
        name: "hosts",
        path: "/etc/hosts",
        kind: "file",
        size: 256,
      },
    ]);

    render(<SftpWorkspace connectionId="prod-web-01" />);

    await waitForInitialLoad();

    const addressBar = screen.getByLabelText("远程路径");
    await userEvent.clear(addressBar);
    await userEvent.type(addressBar, "/etc{Enter}");

    await waitFor(() => {
      expect(callBackendMock).toHaveBeenCalledWith("list_sftp_directory", {
        request: { session_id: "sftp-session-1", path: "/etc" },
      });
    });
    expect(await screen.findByText("hosts")).toBeInTheDocument();
  });

  it("treats tilde in the address bar as the sftp home directory", async () => {
    mockOpenSession();
    callBackendMock.mockResolvedValueOnce([
      {
        name: "profile",
        path: "./profile",
        kind: "file",
        size: 64,
      },
    ]);

    render(<SftpWorkspace connectionId="prod-web-01" />);

    await waitForInitialLoad();

    const addressBar = screen.getByLabelText("远程路径");
    await userEvent.clear(addressBar);
    await userEvent.type(addressBar, "~/{Enter}");

    await waitFor(() => {
      expect(callBackendMock).toHaveBeenCalledWith("list_sftp_directory", {
        request: { session_id: "sftp-session-1", path: "." },
      });
    });
    expect(await screen.findByText("profile")).toBeInTheDocument();
  });

  it("keeps back and forward history while navigating directories", async () => {
    mockOpenSession([
      {
        name: "logs",
        path: "/var/log",
        kind: "directory",
        size: 4096,
      },
    ]);
    callBackendMock.mockResolvedValueOnce([
      {
        name: "app.log",
        path: "/var/log/app.log",
        kind: "file",
        size: 128,
      },
    ]);
    callBackendMock.mockResolvedValueOnce([
      {
        name: "logs",
        path: "/var/log",
        kind: "directory",
        size: 4096,
      },
    ]);
    callBackendMock.mockResolvedValueOnce([
      {
        name: "app.log",
        path: "/var/log/app.log",
        kind: "file",
        size: 128,
      },
    ]);

    render(<SftpWorkspace connectionId="prod-web-01" />);

    await waitForInitialLoad();
    await userEvent.dblClick(await screen.findByText("logs"));
    await screen.findByText("app.log");

    await userEvent.click(screen.getByRole("button", { name: "后退" }));
    await waitFor(() => {
      expect(screen.getByLabelText("远程路径")).toHaveValue("/");
    });

    await userEvent.click(screen.getByRole("button", { name: "前进" }));
    await waitFor(() => {
      expect(screen.getByLabelText("远程路径")).toHaveValue("/var/log");
    });
  });

  it("shows loading state while refreshing a directory", async () => {
    mockOpenSession();
    let finishRefresh!: (entries: unknown[]) => void;
    callBackendMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishRefresh = resolve;
        }),
    );

    render(<SftpWorkspace connectionId="prod-web-01" />);

    await waitForInitialLoad();
    await userEvent.click(screen.getByRole("button", { name: "刷新" }));

    expect(screen.getByRole("status")).toHaveTextContent("加载中...");

    finishRefresh([]);
    await waitFor(() => {
      expect(screen.queryByRole("status")).not.toBeInTheDocument();
    });
  });

  it("sorts directory entries by name and size", async () => {
    mockOpenSession([
      {
        name: "beta.log",
        path: "/beta.log",
        kind: "file",
        size: 2048,
      },
      {
        name: "alpha.log",
        path: "/alpha.log",
        kind: "file",
        size: 1024,
      },
    ]);

    render(<SftpWorkspace connectionId="prod-web-01" />);

    await waitForInitialLoad();
    await screen.findByText("beta.log");

    await userEvent.click(screen.getByRole("button", { name: "按名称排序" }));
    expect(screen.getAllByRole("row").map((row) => row.textContent)).toEqual([
      "名称类型大小权限",
      "alpha.logfile1024",
      "beta.logfile2048",
    ]);

    await userEvent.click(screen.getByRole("button", { name: "按大小排序" }));
    expect(screen.getAllByRole("row").map((row) => row.textContent)).toEqual([
      "名称类型大小权限",
      "beta.logfile2048",
      "alpha.logfile1024",
    ]);
  });

  it("formats file sizes with the configured size unit", async () => {
    mockOpenSession([
      {
        name: "archive.zip",
        path: "/archive.zip",
        kind: "file",
        size: 1048576,
      },
    ]);

    render(<SftpWorkspace connectionId="prod-web-01" sizeUnit="auto" />);

    await waitForInitialLoad();

    expect(await screen.findByText("1 MB")).toBeInTheDocument();
  });

  it("shows blank area actions and creates a new directory from an app dialog", async () => {
    mockOpenSession();
    callBackendMock.mockResolvedValueOnce(undefined);
    callBackendMock.mockResolvedValueOnce([]);
    const promptSpy = vi.spyOn(window, "prompt").mockImplementation(() => "browser-prompt");

    render(<SftpWorkspace connectionId="prod-web-01" />);

    await waitForInitialLoad();
    await userEvent.pointer({ keys: "[MouseRight]", target: screen.getByLabelText("SFTP 文件列表") });

    expect(screen.getByRole("menuitem", { name: "上传文件" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "刷新" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "新建文件夹" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "新建文件" })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("menuitem", { name: "新建文件夹" }));
    expect(screen.getByRole("dialog", { name: "新建文件夹" })).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "新建文件夹" })).toHaveClass("sftp-dialog");
    expect(screen.getByRole("dialog", { name: "新建文件夹" }).querySelector("header")).toHaveClass(
      "connection-dialog__header",
    );
    await userEvent.type(screen.getByLabelText("名称"), "new-dir");
    await userEvent.click(screen.getByRole("button", { name: "确认" }));

    await waitFor(() => {
      expect(callBackendMock).toHaveBeenCalledWith("create_sftp_directory", {
        request: { session_id: "sftp-session-1", path: "/new-dir" },
      });
    });
    expect(promptSpy).not.toHaveBeenCalled();
  });

  it("uploads a selected local file into the current directory", async () => {
    mockOpenSession();
    pickUploadFileMock.mockResolvedValue("C:\\Users\\ttat\\Desktop\\app.log");
    callBackendMock.mockResolvedValueOnce(undefined);
    callBackendMock.mockResolvedValueOnce([
      {
        name: "app.log",
        path: "/app.log",
        kind: "file",
        size: 128,
      },
    ]);

    render(<SftpWorkspace connectionId="prod-web-01" />);

    await waitForInitialLoad();
    await userEvent.pointer({ keys: "[MouseRight]", target: screen.getByLabelText("SFTP 文件列表") });
    await userEvent.click(screen.getByRole("menuitem", { name: "上传文件" }));

    await waitFor(() => {
      expect(callBackendMock).toHaveBeenCalledWith("upload_sftp_file", {
        request: {
          session_id: "sftp-session-1",
          transfer_id: "transfer-1",
          local_path: "C:\\Users\\ttat\\Desktop\\app.log",
          remote_path: "/app.log",
          overwrite: false,
        },
      });
    });
    expect(await screen.findByText("app.log")).toBeInTheDocument();
    expect(screen.getByText("app.log 上传完成")).toBeInTheDocument();
  });

  it("asks before overwriting an existing remote file during upload", async () => {
    mockOpenSession([
      {
        name: "app.log",
        path: "/app.log",
        kind: "file",
        size: 128,
      },
    ]);
    pickUploadFileMock.mockResolvedValue("C:\\Users\\ttat\\Desktop\\app.log");
    callBackendMock.mockResolvedValueOnce(undefined);
    callBackendMock.mockResolvedValueOnce([
      {
        name: "app.log",
        path: "/app.log",
        kind: "file",
        size: 256,
      },
    ]);

    render(<SftpWorkspace connectionId="prod-web-01" />);

    await waitForInitialLoad();
    await userEvent.pointer({ keys: "[MouseRight]", target: screen.getByLabelText("SFTP 文件列表") });
    await userEvent.click(screen.getByRole("menuitem", { name: "上传文件" }));

    expect(screen.getByRole("dialog", { name: "确认覆盖" })).toBeInTheDocument();
    expect(screen.getByText("app.log 已存在，是否覆盖？")).toBeInTheDocument();
    expect(callBackendMock).not.toHaveBeenCalledWith("upload_sftp_file", expect.anything());

    await userEvent.click(screen.getByRole("button", { name: "覆盖" }));

    await waitFor(() => {
      expect(callBackendMock).toHaveBeenCalledWith("upload_sftp_file", {
        request: {
          session_id: "sftp-session-1",
          transfer_id: "transfer-1",
          local_path: "C:\\Users\\ttat\\Desktop\\app.log",
          remote_path: "/app.log",
          overwrite: true,
        },
      });
    });
  });

  it("downloads a remote file to the selected local path", async () => {
    mockOpenSession([
      {
        name: "app.log",
        path: "/app.log",
        kind: "file",
        size: 128,
      },
    ]);
    pickDownloadPathMock.mockResolvedValue("C:\\Users\\ttat\\Downloads\\app.log");
    callBackendMock.mockResolvedValueOnce(undefined);

    render(<SftpWorkspace connectionId="prod-web-01" />);

    await waitForInitialLoad();
    await userEvent.pointer({ keys: "[MouseRight]", target: await screen.findByText("app.log") });
    await userEvent.click(screen.getByRole("menuitem", { name: "下载" }));

    await waitFor(() => {
      expect(callBackendMock).toHaveBeenCalledWith("download_sftp_file", {
        request: {
          session_id: "sftp-session-1",
          transfer_id: "transfer-1",
          remote_path: "/app.log",
          local_path: "C:\\Users\\ttat\\Downloads\\app.log",
        },
      });
    });
    expect(screen.getByText("app.log 下载完成")).toBeInTheDocument();
  });

  it("shows compact transfer failure text", async () => {
    mockOpenSession([
      {
        name: "tzbh",
        path: "/tzbh",
        kind: "file",
        size: 128,
      },
    ]);
    pickDownloadPathMock.mockResolvedValue("C:\\Users\\ttat\\Downloads\\tzbh");
    callBackendMock.mockRejectedValueOnce(new Error("io error: failure"));

    render(<SftpWorkspace connectionId="prod-web-01" />);

    await waitForInitialLoad();
    await userEvent.pointer({ keys: "[MouseRight]", target: await screen.findByText("tzbh") });
    await userEvent.click(screen.getByRole("menuitem", { name: "下载" }));

    expect(await screen.findByText("tzbh 下载失败 io error: failure")).toBeInTheDocument();
  });

  it("renders transfer progress updates from backend events", async () => {
    mockOpenSession([
      {
        name: "spring.log.2026-05-29.6",
        path: "/spring.log.2026-05-29.6",
        kind: "file",
        size: 128,
      },
    ]);
    pickDownloadPathMock.mockResolvedValue("C:\\Users\\ttat\\Downloads\\spring.log.2026-05-29.6");
    let resolveDownload!: () => void;
    callBackendMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveDownload = () => resolve(undefined);
        }),
    );

    render(<SftpWorkspace connectionId="prod-web-01" />);

    await waitForInitialLoad();
    await userEvent.pointer({ keys: "[MouseRight]", target: await screen.findByText("spring.log.2026-05-29.6") });
    await userEvent.click(screen.getByRole("menuitem", { name: "下载" }));

    progressHandler?.({ transfer_id: "transfer-1", progress: 30 });

    expect(await screen.findByText("spring.log.2026-05-29.6 传输中...30%")).toBeInTheDocument();
    resolveDownload();
  });

  it("shows blank area actions from the reserved table action area", async () => {
    mockOpenSession([
      {
        name: "file-a.log",
        path: "/file-a.log",
        kind: "file",
        size: 128,
      },
    ]);

    render(<SftpWorkspace connectionId="prod-web-01" />);

    await waitForInitialLoad();
    await userEvent.pointer({ keys: "[MouseRight]", target: screen.getByLabelText("SFTP 空白操作区") });

    expect(screen.getByRole("menuitem", { name: "上传文件" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "刷新" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "新建文件夹" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "新建文件" })).toBeInTheDocument();
  });

  it("shows directory actions without an open menu item", async () => {
    mockOpenSession([
      {
        name: "logs",
        path: "/logs",
        kind: "directory",
        size: 4096,
      },
    ]);

    render(<SftpWorkspace connectionId="prod-web-01" />);

    await waitForInitialLoad();
    await userEvent.pointer({ keys: "[MouseRight]", target: await screen.findByText("logs") });

    expect(screen.getByText("logs")).toHaveClass("sftp-entry-name--directory");
    expect(screen.queryByRole("menuitem", { name: "打开" })).not.toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "下载" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "重命名" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "复制路径" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "删除" })).toBeInTheDocument();
  });

  it("marks symlink entries with the link color class", async () => {
    mockOpenSession([
      {
        name: "current",
        path: "/current",
        kind: "symlink",
        size: 0,
      },
    ]);

    render(<SftpWorkspace connectionId="prod-web-01" />);

    await waitForInitialLoad();

    expect(await screen.findByText("current")).toHaveClass("sftp-entry-name--link");
  });

  it("renames with an app dialog, copies path, and deletes a file from the context menu", async () => {
    mockOpenSession([
      {
        name: "app.log",
        path: "/app.log",
        kind: "file",
        size: 128,
      },
    ]);
    callBackendMock.mockResolvedValueOnce(undefined);
    callBackendMock.mockResolvedValueOnce([
      {
        name: "server.log",
        path: "/server.log",
        kind: "file",
        size: 128,
      },
    ]);
    callBackendMock.mockResolvedValueOnce(undefined);
    callBackendMock.mockResolvedValueOnce([]);
    const promptSpy = vi.spyOn(window, "prompt").mockImplementation(() => "browser-prompt");
    const confirmSpy = vi.spyOn(window, "confirm").mockImplementation(() => true);

    render(<SftpWorkspace connectionId="prod-web-01" />);

    await waitForInitialLoad();
    await userEvent.pointer({ keys: "[MouseRight]", target: await screen.findByText("app.log") });
    await userEvent.click(screen.getByRole("menuitem", { name: "重命名" }));
    expect(screen.getByRole("dialog", { name: "重命名" })).toBeInTheDocument();
    const nameInput = screen.getByLabelText("名称");
    await userEvent.clear(nameInput);
    await userEvent.type(nameInput, "server.log");
    await userEvent.click(screen.getByRole("button", { name: "确认" }));

    await waitFor(() => {
      expect(callBackendMock).toHaveBeenCalledWith("rename_sftp_path", {
        request: { session_id: "sftp-session-1", from: "/app.log", to: "/server.log" },
      });
    });
    expect(promptSpy).not.toHaveBeenCalled();

    await userEvent.pointer({ keys: "[MouseRight]", target: await screen.findByText("server.log") });
    await userEvent.click(screen.getByRole("menuitem", { name: "复制路径" }));
    expect(writeClipboardTextMock).toHaveBeenCalledWith("/server.log");

    await userEvent.pointer({ keys: "[MouseRight]", target: screen.getByText("server.log") });
    await userEvent.click(screen.getByRole("menuitem", { name: "删除" }));
    expect(screen.getByRole("dialog", { name: "确认删除" })).toBeInTheDocument();
    expect(screen.getByText("确认删除 server.log？")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "确认" }));

    await waitFor(() => {
      expect(callBackendMock).toHaveBeenCalledWith("delete_sftp_path", {
        request: { session_id: "sftp-session-1", path: "/server.log" },
      });
    });
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  it("shows folder suffix in the delete confirmation dialog", async () => {
    mockOpenSession([
      {
        name: "test",
        path: "/test",
        kind: "directory",
        size: 4096,
      },
    ]);
    callBackendMock.mockResolvedValueOnce(undefined);
    callBackendMock.mockResolvedValueOnce([]);
    const confirmSpy = vi.spyOn(window, "confirm").mockImplementation(() => true);

    render(<SftpWorkspace connectionId="prod-web-01" />);

    await waitForInitialLoad();
    await userEvent.pointer({ keys: "[MouseRight]", target: await screen.findByText("test") });
    await userEvent.click(screen.getByRole("menuitem", { name: "删除" }));

    expect(screen.getByRole("dialog", { name: "确认删除" })).toBeInTheDocument();
    expect(screen.getByText("确认删除 test 文件夹？")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "确认" }));

    await waitFor(() => {
      expect(callBackendMock).toHaveBeenCalledWith("delete_sftp_path", {
        request: { session_id: "sftp-session-1", path: "/test" },
      });
    });
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  it("closes the sftp session when unmounted", async () => {
    mockOpenSession();

    const { unmount } = render(<SftpWorkspace connectionId="prod-web-01" />);
    await waitFor(() => {
      expect(callBackendMock).toHaveBeenCalledWith("open_sftp_session", {
        request: { connection_id: "prod-web-01" },
      });
    });

    unmount();

    await waitFor(() => {
      expect(callBackendMock).toHaveBeenCalledWith("close_sftp_session", {
        request: { session_id: "sftp-session-1" },
      });
    });
  });

  it("keeps the transfer queue in a fixed scrollable area", () => {
    mockOpenSession();
    render(<SftpWorkspace connectionId="prod-web-01" />);

    expect(screen.getByLabelText("传输队列")).toHaveClass("transfer-queue");
  });
});
