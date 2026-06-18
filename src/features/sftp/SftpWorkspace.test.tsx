import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SftpWorkspace } from "./SftpWorkspace";
import { callBackend } from "../../lib/tauri";
import { writeClipboardText } from "../../lib/clipboard";
import { pickDownloadDirectory, pickDownloadPath, pickUploadDirectory, pickUploadFile } from "../../lib/fileDialog";
import { listenSftpTransferProgress } from "../../lib/tauriEvents";

vi.mock("../../lib/tauri", () => ({
  callBackend: vi.fn(),
}));

vi.mock("../../lib/clipboard", () => ({
  writeClipboardText: vi.fn(),
}));

vi.mock("../../lib/fileDialog", () => ({
  pickUploadFile: vi.fn(),
  pickUploadDirectory: vi.fn(),
  pickDownloadPath: vi.fn(),
  pickDownloadDirectory: vi.fn(),
}));

vi.mock("../../lib/tauriEvents", () => ({
  listenSftpTransferProgress: vi.fn(),
}));

const callBackendMock = vi.mocked(callBackend);
const writeClipboardTextMock = vi.mocked(writeClipboardText);
const pickUploadFileMock = vi.mocked(pickUploadFile);
const pickUploadDirectoryMock = vi.mocked(pickUploadDirectory);
const pickDownloadPathMock = vi.mocked(pickDownloadPath);
const pickDownloadDirectoryMock = vi.mocked(pickDownloadDirectory);
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

  function menuItemLabels() {
    return screen.getAllByRole("menuitem").map((item) => item.textContent);
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
        modified_at: "2026-06-18T10:20:30",
        permissions: "755",
      },
    ]);

    render(<SftpWorkspace connectionId="prod-web-01" />);

    await waitForInitialLoad();
    expect(await screen.findByText("logs")).toBeInTheDocument();
    expect(screen.getByText("修改时间")).toBeInTheDocument();
    expect(screen.getByText("2026-06-18 10:20:30")).toBeInTheDocument();
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

  it("opens a text file in an editor dialog by double clicking it", async () => {
    mockOpenSession([
      {
        name: "app.log",
        path: "/app.log",
        kind: "file",
        size: 128,
        modified_at: "1710000000",
      },
    ]);
    callBackendMock.mockResolvedValueOnce({
      path: "/app.log",
      content: "hello\nworld",
      size: 11,
      modified_at: "1710000000",
    });

    render(<SftpWorkspace connectionId="prod-web-01" />);

    await waitForInitialLoad();
    await userEvent.dblClick(await screen.findByText("app.log"));

    await waitFor(() => {
      expect(callBackendMock).toHaveBeenCalledWith("read_sftp_text_file", {
        request: { session_id: "sftp-session-1", path: "/app.log", max_bytes: 5 * 1024 * 1024 },
      });
    });
    const dialog = screen.getByRole("dialog", { name: "编辑 app.log" });
    expect(dialog).toBeInTheDocument();
    expect(screen.getByLabelText("文件内容")).toHaveValue("hello\nworld");
    expect(dialog).toHaveTextContent("/app.log");
    expect(dialog).toHaveTextContent("11");
    expect(dialog).toHaveTextContent("2024-03-10 00:00:00");
  });

  it("moves the text editor dialog by dragging the header and resizes it from the corner", async () => {
    mockOpenSession([
      {
        name: "app.log",
        path: "/app.log",
        kind: "file",
        size: 128,
      },
    ]);
    callBackendMock.mockResolvedValueOnce({
      path: "/app.log",
      content: "hello",
      size: 5,
      modified_at: "1710000000",
    });

    render(<SftpWorkspace connectionId="prod-web-01" />);

    await waitForInitialLoad();
    await userEvent.dblClick(await screen.findByText("app.log"));
    vi.stubGlobal("innerWidth", 1200);
    vi.stubGlobal("innerHeight", 900);

    const dialog = screen.getByRole("dialog", { name: "编辑 app.log" });
    vi.spyOn(dialog, "getBoundingClientRect").mockReturnValue({
      x: 100,
      y: 80,
      width: 640,
      height: 520,
      top: 80,
      right: 740,
      bottom: 600,
      left: 100,
      toJSON: () => ({}),
    });

    fireEvent.pointerDown(screen.getByLabelText("拖动编辑器"), {
      pointerId: 1,
      clientX: 140,
      clientY: 110,
    });
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 180, clientY: 150 });
    fireEvent.pointerUp(window, { pointerId: 1 });

    expect(dialog).toHaveStyle({ left: "140px", top: "120px" });

    fireEvent.pointerDown(screen.getByLabelText("调整编辑器大小"), {
      pointerId: 2,
      clientX: 740,
      clientY: 600,
    });
    fireEvent.pointerMove(window, { pointerId: 2, clientX: 820, clientY: 660 });
    fireEvent.pointerUp(window, { pointerId: 2 });

    expect(dialog).toHaveStyle({ width: "720px", height: "580px" });
  });

  it("keeps the text editor open when clicking outside it", async () => {
    mockOpenSession([
      {
        name: "app.log",
        path: "/app.log",
        kind: "file",
        size: 128,
      },
    ]);
    callBackendMock.mockResolvedValueOnce({
      path: "/app.log",
      content: "hello",
      size: 5,
      modified_at: "1710000000",
    });

    render(<SftpWorkspace connectionId="prod-web-01" />);

    await waitForInitialLoad();
    await userEvent.dblClick(await screen.findByText("app.log"));

    fireEvent.pointerDown(
      screen.getByRole("dialog", { name: "编辑 app.log" }).parentElement!,
    );

    expect(screen.getByRole("dialog", { name: "编辑 app.log" })).toBeInTheDocument();
  });

  it("keeps the text editor size and position after closing and reopening it", async () => {
    mockOpenSession([
      {
        name: "app.log",
        path: "/app.log",
        kind: "file",
        size: 128,
      },
    ]);
    callBackendMock.mockResolvedValueOnce({
      path: "/app.log",
      content: "hello",
      size: 5,
      modified_at: "1710000000",
    });
    callBackendMock.mockResolvedValueOnce({
      path: "/app.log",
      content: "hello again",
      size: 11,
      modified_at: "1710000010",
    });

    render(<SftpWorkspace connectionId="prod-web-01" />);

    await waitForInitialLoad();
    await userEvent.dblClick(await screen.findByText("app.log"));
    vi.stubGlobal("innerWidth", 1200);
    vi.stubGlobal("innerHeight", 900);

    const dialog = screen.getByRole("dialog", { name: "编辑 app.log" });
    vi.spyOn(dialog, "getBoundingClientRect").mockReturnValue({
      x: 100,
      y: 80,
      width: 640,
      height: 520,
      top: 80,
      right: 740,
      bottom: 600,
      left: 100,
      toJSON: () => ({}),
    });

    fireEvent.pointerDown(screen.getByLabelText("拖动编辑器"), {
      pointerId: 1,
      clientX: 140,
      clientY: 110,
    });
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 180, clientY: 150 });
    fireEvent.pointerUp(window, { pointerId: 1 });
    fireEvent.pointerDown(screen.getByLabelText("调整编辑器大小"), {
      pointerId: 2,
      clientX: 740,
      clientY: 600,
    });
    fireEvent.pointerMove(window, { pointerId: 2, clientX: 820, clientY: 660 });
    fireEvent.pointerUp(window, { pointerId: 2 });

    await userEvent.click(screen.getByRole("button", { name: "关闭" }));
    await userEvent.dblClick(await screen.findByText("app.log"));

    const reopenedDialog = await screen.findByRole("dialog", { name: "编辑 app.log" });
    expect(reopenedDialog).toHaveStyle({
      left: "140px",
      top: "120px",
      width: "720px",
      height: "580px",
    });
  });

  it("opens a text file from the entry context menu", async () => {
    mockOpenSession([
      {
        name: "app.log",
        path: "/app.log",
        kind: "file",
        size: 128,
      },
    ]);
    callBackendMock.mockResolvedValueOnce({
      path: "/app.log",
      content: "hello",
      size: 5,
      modified_at: "1710000000",
    });

    render(<SftpWorkspace connectionId="prod-web-01" />);

    await waitForInitialLoad();
    await userEvent.pointer({ keys: "[MouseRight]", target: await screen.findByText("app.log") });
    await userEvent.click(screen.getByRole("menuitem", { name: "编辑" }));

    await waitFor(() => {
      expect(callBackendMock).toHaveBeenCalledWith("read_sftp_text_file", {
        request: { session_id: "sftp-session-1", path: "/app.log", max_bytes: 5 * 1024 * 1024 },
      });
    });
    expect(screen.getByRole("dialog", { name: "编辑 app.log" })).toBeInTheDocument();
  });

  it("opens common extensionless linux config files as text", async () => {
    mockOpenSession([
      {
        name: "profile",
        path: "/etc/profile",
        kind: "file",
        size: 128,
      },
      {
        name: ".bashrc",
        path: "/home/dev/.bashrc",
        kind: "file",
        size: 128,
      },
    ]);
    callBackendMock.mockResolvedValueOnce({
      path: "/etc/profile",
      content: "export PATH=$PATH:/opt/bin",
      size: 25,
      modified_at: "1710000000",
    });

    render(<SftpWorkspace connectionId="prod-web-01" />);

    await waitForInitialLoad();
    await userEvent.dblClick(await screen.findByText("profile"));

    await waitFor(() => {
      expect(callBackendMock).toHaveBeenCalledWith("read_sftp_text_file", {
        request: { session_id: "sftp-session-1", path: "/etc/profile", max_bytes: 5 * 1024 * 1024 },
      });
    });
    expect(screen.getByRole("dialog", { name: "编辑 profile" })).toBeInTheDocument();
    expect(screen.getByLabelText("文件内容")).toHaveValue("export PATH=$PATH:/opt/bin");
  });

  it("saves text file changes from the editor dialog", async () => {
    mockOpenSession([
      {
        name: "app.log",
        path: "/app.log",
        kind: "file",
        size: 128,
        modified_at: "1710000000",
      },
    ]);
    callBackendMock.mockResolvedValueOnce({
      path: "/app.log",
      content: "hello",
      size: 5,
      modified_at: "1710000000",
    });
    callBackendMock.mockResolvedValueOnce({
      path: "/app.log",
      size: 11,
      modified_at: "1710000010",
    });
    callBackendMock.mockResolvedValueOnce([
      {
        name: "app.log",
        path: "/app.log",
        kind: "file",
        size: 11,
        modified_at: "1710000010",
      },
    ]);

    render(<SftpWorkspace connectionId="prod-web-01" />);

    await waitForInitialLoad();
    await userEvent.dblClick(await screen.findByText("app.log"));
    const editor = await screen.findByLabelText("文件内容");
    await userEvent.clear(editor);
    await userEvent.type(editor, "hello world");
    await userEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => {
      expect(callBackendMock).toHaveBeenCalledWith("write_sftp_text_file", {
        request: {
          session_id: "sftp-session-1",
          path: "/app.log",
          content: "hello world",
          expected_modified_at: "1710000000",
          overwrite: false,
        },
      });
    });
    expect(screen.getByText("已保存")).toBeInTheDocument();
  });

  it("saves text file changes with Ctrl+S", async () => {
    mockOpenSession([
      {
        name: "app.log",
        path: "/app.log",
        kind: "file",
        size: 128,
      },
    ]);
    callBackendMock.mockResolvedValueOnce({
      path: "/app.log",
      content: "hello",
      size: 5,
      modified_at: "1710000000",
    });
    callBackendMock.mockResolvedValueOnce({
      path: "/app.log",
      size: 11,
      modified_at: "1710000010",
    });
    callBackendMock.mockResolvedValueOnce([]);

    render(<SftpWorkspace connectionId="prod-web-01" />);

    await waitForInitialLoad();
    await userEvent.dblClick(await screen.findByText("app.log"));
    const editor = await screen.findByLabelText("文件内容");
    await userEvent.clear(editor);
    await userEvent.type(editor, "hello world");
    await userEvent.keyboard("{Control>}s{/Control}");

    await waitFor(() => {
      expect(callBackendMock).toHaveBeenCalledWith("write_sftp_text_file", {
        request: {
          session_id: "sftp-session-1",
          path: "/app.log",
          content: "hello world",
          expected_modified_at: "1710000000",
          overwrite: false,
        },
      });
    });
  });

  it("asks to overwrite when saving a text file changed remotely", async () => {
    mockOpenSession([
      {
        name: "app.log",
        path: "/app.log",
        kind: "file",
        size: 128,
      },
    ]);
    callBackendMock.mockResolvedValueOnce({
      path: "/app.log",
      content: "hello",
      size: 5,
      modified_at: "1710000000",
    });
    callBackendMock.mockRejectedValueOnce(new Error("remote file changed: /app.log"));
    callBackendMock.mockResolvedValueOnce({
      path: "/app.log",
      size: 11,
      modified_at: "1710000010",
    });
    callBackendMock.mockResolvedValueOnce([]);

    render(<SftpWorkspace connectionId="prod-web-01" />);

    await waitForInitialLoad();
    await userEvent.dblClick(await screen.findByText("app.log"));
    const editor = await screen.findByLabelText("文件内容");
    await userEvent.clear(editor);
    await userEvent.type(editor, "hello world");
    await userEvent.click(screen.getByRole("button", { name: "保存" }));

    expect(await screen.findByRole("dialog", { name: "确认覆盖保存" })).toBeInTheDocument();
    expect(screen.getByText("远程文件 app.log 已被修改，是否覆盖保存？")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "覆盖保存" }));

    await waitFor(() => {
      expect(callBackendMock).toHaveBeenCalledWith("write_sftp_text_file", {
        request: {
          session_id: "sftp-session-1",
          path: "/app.log",
          content: "hello world",
          expected_modified_at: "1710000000",
          overwrite: true,
        },
      });
    });
  });

  it("asks before closing a dirty text editor", async () => {
    mockOpenSession([
      {
        name: "app.log",
        path: "/app.log",
        kind: "file",
        size: 128,
      },
    ]);
    callBackendMock.mockResolvedValueOnce({
      path: "/app.log",
      content: "hello",
      size: 5,
      modified_at: "1710000000",
    });

    render(<SftpWorkspace connectionId="prod-web-01" />);

    await waitForInitialLoad();
    await userEvent.dblClick(await screen.findByText("app.log"));
    const editor = await screen.findByLabelText("文件内容");
    await userEvent.type(editor, " world");
    await userEvent.click(screen.getByRole("button", { name: "关闭" }));

    expect(screen.getByRole("dialog", { name: "确认关闭" })).toBeInTheDocument();
    expect(screen.getByText("文件 app.log 有未保存修改，确认关闭？")).toBeInTheDocument();
  });

  it("shows an error when double clicking an unsupported file type", async () => {
    mockOpenSession([
      {
        name: "archive.zip",
        path: "/archive.zip",
        kind: "file",
        size: 128,
      },
    ]);

    render(<SftpWorkspace connectionId="prod-web-01" />);

    await waitForInitialLoad();
    await userEvent.dblClick(await screen.findByText("archive.zip"));

    expect(await screen.findByRole("alert")).toHaveTextContent("暂不支持内置打开该文件类型");
    expect(callBackendMock).not.toHaveBeenCalledWith("read_sftp_text_file", expect.anything());
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
      "名称类型大小修改时间权限",
      "alpha.logfile1024",
      "beta.logfile2048",
    ]);

    await userEvent.click(screen.getByRole("button", { name: "按大小排序" }));
    expect(screen.getAllByRole("row").map((row) => row.textContent)).toEqual([
      "名称类型大小修改时间权限",
      "beta.logfile2048",
      "alpha.logfile1024",
    ]);
  });

  it("sorts directory entries by modified time", async () => {
    mockOpenSession([
      {
        name: "old.log",
        path: "/old.log",
        kind: "file",
        size: 128,
        modified_at: "2026-06-17T09:00:00",
      },
      {
        name: "new.log",
        path: "/new.log",
        kind: "file",
        size: 128,
        modified_at: "2026-06-18T10:20:30",
      },
    ]);

    render(<SftpWorkspace connectionId="prod-web-01" />);

    await waitForInitialLoad();
    await screen.findByText("old.log");

    await userEvent.click(screen.getByRole("button", { name: "按修改时间排序" }));
    expect(screen.getAllByRole("row").map((row) => row.textContent)).toEqual([
      "名称类型大小修改时间权限",
      "new.logfile1282026-06-18 10:20:30",
      "old.logfile1282026-06-17 09:00:00",
    ]);

    await userEvent.click(screen.getByRole("button", { name: "按修改时间排序" }));
    expect(screen.getAllByRole("row").map((row) => row.textContent)).toEqual([
      "名称类型大小修改时间权限",
      "old.logfile1282026-06-17 09:00:00",
      "new.logfile1282026-06-18 10:20:30",
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

    expect(menuItemLabels()).toEqual(["刷新", "新建文件", "新建文件夹", "上传文件", "上传文件夹"]);
    expect(screen.getByRole("menuitem", { name: "上传文件" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "上传文件夹" })).toBeInTheDocument();
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

  it("uploads a selected local directory into the current directory", async () => {
    mockOpenSession();
    pickUploadDirectoryMock.mockResolvedValue("C:\\Users\\ttat\\Desktop\\logs");
    callBackendMock.mockResolvedValueOnce(undefined);
    callBackendMock.mockResolvedValueOnce([
      {
        name: "logs",
        path: "/logs",
        kind: "directory",
        size: 4096,
      },
    ]);

    render(<SftpWorkspace connectionId="prod-web-01" />);

    await waitForInitialLoad();
    await userEvent.pointer({ keys: "[MouseRight]", target: screen.getByLabelText("SFTP 文件列表") });
    await userEvent.click(screen.getByRole("menuitem", { name: "上传文件夹" }));

    await waitFor(() => {
      expect(callBackendMock).toHaveBeenCalledWith("upload_sftp_directory", {
        request: {
          session_id: "sftp-session-1",
          transfer_id: "transfer-1",
          local_path: "C:\\Users\\ttat\\Desktop\\logs",
          remote_path: "/logs",
          overwrite: false,
        },
      });
    });
    expect(screen.getByText("logs 上传完成")).toBeInTheDocument();
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

  it("shows current directory actions in an entry context menu", async () => {
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
    await userEvent.pointer({ keys: "[MouseRight]", target: await screen.findByText("file-a.log") });

    expect(menuItemLabels()).toEqual([
      "刷新",
      "下载",
      "编辑",
      "压缩",
      "重命名",
      "复制路径",
      "删除",
      "新建文件",
      "新建文件夹",
      "上传文件",
      "上传文件夹",
    ]);
    expect(screen.getByRole("menuitem", { name: "下载" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "压缩" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "解压缩" })).not.toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "重命名" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "复制路径" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "删除" })).toBeInTheDocument();
    expect(screen.getByText("在当前目录下：")).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "上传文件" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "上传文件夹" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "刷新" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "新建文件夹" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "新建文件" })).toBeInTheDocument();
    expect(screen.queryByLabelText("SFTP 空白操作区")).not.toBeInTheDocument();
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
    expect(screen.getByRole("menuitem", { name: "压缩" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "重命名" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "复制路径" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "删除" })).toBeInTheDocument();
  });

  it("compresses an entry and refreshes the current directory", async () => {
    mockOpenSession([
      {
        name: "logs",
        path: "/logs",
        kind: "directory",
        size: 4096,
      },
    ]);
    callBackendMock.mockResolvedValueOnce(undefined);
    callBackendMock.mockResolvedValueOnce([
      {
        name: "logs.tar.gz",
        path: "/logs.tar.gz",
        kind: "file",
        size: 256,
      },
    ]);

    render(<SftpWorkspace connectionId="prod-web-01" />);

    await waitForInitialLoad();
    await userEvent.pointer({ keys: "[MouseRight]", target: await screen.findByText("logs") });
    await userEvent.click(screen.getByRole("menuitem", { name: "压缩" }));

    await waitFor(() => {
      expect(callBackendMock).toHaveBeenCalledWith("compress_sftp_path", {
        request: { session_id: "sftp-session-1", path: "/logs" },
      });
    });
    expect(await screen.findByText("logs.tar.gz")).toBeInTheDocument();
  });

  it("extracts a tar archive and refreshes the current directory", async () => {
    mockOpenSession([
      {
        name: "logs.tar.gz",
        path: "/logs.tar.gz",
        kind: "file",
        size: 256,
      },
    ]);
    callBackendMock.mockResolvedValueOnce(undefined);
    callBackendMock.mockResolvedValueOnce([
      {
        name: "logs",
        path: "/logs",
        kind: "directory",
        size: 4096,
      },
    ]);

    render(<SftpWorkspace connectionId="prod-web-01" />);

    await waitForInitialLoad();
    await userEvent.pointer({ keys: "[MouseRight]", target: await screen.findByText("logs.tar.gz") });

    expect(screen.getByRole("menuitem", { name: "解压缩" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("menuitem", { name: "解压缩" }));

    await waitFor(() => {
      expect(callBackendMock).toHaveBeenCalledWith("extract_sftp_archive", {
        request: { session_id: "sftp-session-1", path: "/logs.tar.gz" },
      });
    });
    expect(await screen.findByText("logs")).toBeInTheDocument();
  });

  it("downloads a remote directory into the selected local directory", async () => {
    mockOpenSession([
      {
        name: "logs",
        path: "/logs",
        kind: "directory",
        size: 4096,
      },
    ]);
    pickDownloadDirectoryMock.mockResolvedValue("C:\\Users\\ttat\\Downloads");
    callBackendMock.mockResolvedValueOnce(undefined);

    render(<SftpWorkspace connectionId="prod-web-01" />);

    await waitForInitialLoad();
    await userEvent.pointer({ keys: "[MouseRight]", target: await screen.findByText("logs") });
    await userEvent.click(screen.getByRole("menuitem", { name: "下载" }));

    await waitFor(() => {
      expect(callBackendMock).toHaveBeenCalledWith("download_sftp_directory", {
        request: {
          session_id: "sftp-session-1",
          transfer_id: "transfer-1",
          remote_path: "/logs",
          local_path: "C:\\Users\\ttat\\Downloads\\logs",
          overwrite: false,
        },
      });
    });
    expect(screen.getByText("logs 下载完成")).toBeInTheDocument();
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
    expect(screen.getByText("确认删除 server.log？该操作不可逆！")).toBeInTheDocument();
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
    expect(screen.getByText("确认删除 test 文件夹及其中全部内容？该操作不可逆！")).toBeInTheDocument();

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
