import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { ContextMenu, type ContextMenuState } from "../../app/ContextMenu";
import type { ContextMenuItem } from "../../app/ContextMenu";
import { writeClipboardText } from "../../lib/clipboard";
import {
  pickDownloadDirectory,
  pickDownloadPath,
  pickUploadDirectory,
  pickUploadFile,
} from "../../lib/fileDialog";
import { callBackend } from "../../lib/tauri";
import { listenSftpTransferProgress } from "../../lib/tauriEvents";
import type { SftpFileSizeUnit } from "../settings/settingsTypes";
import type { SftpEntry } from "./sftpTypes";
import { TransferQueue, type TransferTask } from "./TransferQueue";

interface SftpWorkspaceProps {
  connectionId: string | null;
  sizeUnit?: SftpFileSizeUnit;
}

type SortKey = "name" | "size" | "modified_at";
type SortDirection = "asc" | "desc";
type SftpDialogState =
  | {
      kind: "create-directory";
      title: "新建文件夹";
      initialValue: "";
      entry?: undefined;
    }
  | {
      kind: "create-file";
      title: "新建文件";
      initialValue: "";
      entry?: undefined;
    }
  | { kind: "rename"; title: "重命名"; initialValue: string; entry: SftpEntry };
type PendingUpload = {
  kind: "file" | "directory";
  localPath: string;
  name: string;
  remotePath: string;
};
type SftpTextFile = {
  path: string;
  name: string;
  content: string;
  originalContent: string;
  size: number;
  modifiedAt: string | null;
  status: string | null;
};
type SftpReadTextFileResponse = {
  path: string;
  content: string;
  size: number;
  modified_at?: string | null;
};
type SftpWriteTextFileResponse = {
  path: string;
  size: number;
  modified_at?: string | null;
};
type EditorDialogLayout = {
  left: number;
  top: number;
  width: number;
  height: number;
};
type EditorDialogInteraction =
  | {
      kind: "move";
      startX: number;
      startY: number;
      startLeft: number;
      startTop: number;
      startWidth: number;
      startHeight: number;
    }
  | {
      kind: "resize";
      startX: number;
      startY: number;
      startLeft: number;
      startTop: number;
      startWidth: number;
      startHeight: number;
    };

const TEXT_FILE_MAX_BYTES = 5 * 1024 * 1024;
const EDITOR_DIALOG_MIN_WIDTH = 560;
const EDITOR_DIALOG_MIN_HEIGHT = 360;
const EDITOR_DIALOG_VIEWPORT_MARGIN = 24;
const TEXT_FILE_EXTENSIONS = new Set([
  ".conf",
  ".css",
  ".env",
  ".go",
  ".html",
  ".ini",
  ".java",
  ".js",
  ".json",
  ".log",
  ".md",
  ".properties",
  ".py",
  ".rs",
  ".sh",
  ".sql",
  ".toml",
  ".ts",
  ".tsx",
  ".txt",
  ".xml",
  ".yaml",
  ".yml",
]);
const TEXT_FILE_NAMES = new Set([
  ".bash_profile",
  ".bash_login",
  ".bash_logout",
  ".bashrc",
  ".cshrc",
  ".gitconfig",
  ".gitignore",
  ".inputrc",
  ".kshrc",
  ".profile",
  ".ssh_config",
  ".tcshrc",
  ".vimrc",
  ".zlogin",
  ".zlogout",
  ".zprofile",
  ".zshenv",
  ".zshrc",
  "bash.bashrc",
  "crontab",
  "exports",
  "fstab",
  "group",
  "hosts",
  "hostname",
  "issue",
  "motd",
  "passwd",
  "profile",
  "resolv.conf",
  "shadow",
  "shells",
  "sudoers",
  "sysctl.conf",
]);

function normalizeRemotePath(value: string) {
  const path = value.trim().replace(/\\/g, "/");
  if (!path) return "/";
  if (path === "~" || path === "~/") return ".";
  if (path.startsWith("~/")) return `.${path.slice(1).replace(/\/+$/, "")}`;
  const absolutePath = path.startsWith("/") ? path : `/${path}`;
  return absolutePath.replace(/\/+$/, "") || "/";
}

function joinRemotePath(parent: string, name: string) {
  const normalizedName = name.trim().replace(/\\/g, "/").replace(/^\/+/, "");
  if (!normalizedName) return normalizeRemotePath(parent);
  return parent === "/"
    ? `/${normalizedName}`
    : `${parent.replace(/\/+$/, "")}/${normalizedName}`;
}

function siblingRemotePath(path: string, nextName: string) {
  const parent = path.includes("/")
    ? path.slice(0, path.lastIndexOf("/")) || "/"
    : "/";
  return joinRemotePath(parent, nextName);
}

function formatFileSize(size: number, unit: SftpFileSizeUnit) {
  if (unit === "bytes") return String(size);
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${formatSizeNumber(size / 1024)} KB`;
  return `${formatSizeNumber(size / 1024 / 1024)} MB`;
}

function formatSizeNumber(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function formatModifiedTime(value?: string) {
  if (!value) return "";
  const timestamp = parseModifiedTime(value);
  if (timestamp === null) return value;
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${padDatePart(date.getMonth() + 1)}-${padDatePart(date.getDate())} ${padDatePart(date.getHours())}:${padDatePart(date.getMinutes())}:${padDatePart(date.getSeconds())}`;
}

function parseModifiedTime(value?: string) {
  if (!value) return null;
  if (/^\d+$/.test(value)) return Number(value) * 1000;
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? null : timestamp;
}

function padDatePart(value: number) {
  return String(value).padStart(2, "0");
}

function compareEntries(left: SftpEntry, right: SftpEntry, key: SortKey) {
  if (key === "name") return left.name.localeCompare(right.name);
  if (key === "modified_at") {
    const leftTime = parseModifiedTime(left.modified_at) ?? 0;
    const rightTime = parseModifiedTime(right.modified_at) ?? 0;
    return leftTime - rightTime || left.name.localeCompare(right.name);
  }
  return left.size - right.size || left.name.localeCompare(right.name);
}

function getEntryNameClassName(entry: SftpEntry) {
  const kind = entry.kind === "symlink" ? "link" : entry.kind;
  return `sftp-entry-name sftp-entry-name--${kind}`;
}

function getDeleteConfirmationText(entry: SftpEntry) {
  return `确认删除 ${entry.name}${entry.kind === "directory" ? " 文件夹及其中全部内容" : ""}？该操作不可逆！`;
}

function isArchiveEntry(entry: SftpEntry) {
  return entry.kind === "file" && (entry.name.endsWith(".tar.gz") || entry.name.endsWith(".tgz"));
}

function isTextEntry(entry: SftpEntry) {
  if (entry.kind !== "file") return false;
  if (entry.name.startsWith(".env")) return true;
  if (TEXT_FILE_NAMES.has(entry.name.toLowerCase())) return true;
  const extensionStart = entry.name.lastIndexOf(".");
  if (extensionStart < 0) return false;
  return TEXT_FILE_EXTENSIONS.has(entry.name.slice(extensionStart).toLowerCase());
}

function localFileName(path: string) {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? "未命名文件";
}

function joinLocalPath(parent: string, name: string) {
  return `${parent.replace(/[\\/]+$/, "")}\\${name}`;
}

function clampDialogLayout(layout: EditorDialogLayout) {
  const viewportWidth = window.innerWidth || 1024;
  const viewportHeight = window.innerHeight || 768;
  const maxWidth = Math.max(
    EDITOR_DIALOG_MIN_WIDTH,
    viewportWidth - EDITOR_DIALOG_VIEWPORT_MARGIN * 2,
  );
  const maxHeight = Math.max(
    EDITOR_DIALOG_MIN_HEIGHT,
    viewportHeight - EDITOR_DIALOG_VIEWPORT_MARGIN * 2,
  );
  const width = Math.min(Math.max(layout.width, EDITOR_DIALOG_MIN_WIDTH), maxWidth);
  const height = Math.min(Math.max(layout.height, EDITOR_DIALOG_MIN_HEIGHT), maxHeight);
  const left = Math.min(
    Math.max(layout.left, EDITOR_DIALOG_VIEWPORT_MARGIN),
    Math.max(EDITOR_DIALOG_VIEWPORT_MARGIN, viewportWidth - width - EDITOR_DIALOG_VIEWPORT_MARGIN),
  );
  const top = Math.min(
    Math.max(layout.top, EDITOR_DIALOG_VIEWPORT_MARGIN),
    Math.max(EDITOR_DIALOG_VIEWPORT_MARGIN, viewportHeight - height - EDITOR_DIALOG_VIEWPORT_MARGIN),
  );

  return { left, top, width, height };
}

export function SftpWorkspace({
  connectionId,
  sizeUnit = "bytes",
}: SftpWorkspaceProps) {
  const [path, setPath] = useState("/");
  const [addressPath, setAddressPath] = useState("/");
  const [entries, setEntries] = useState<SftpEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [backStack, setBackStack] = useState<string[]>([]);
  const [forwardStack, setForwardStack] = useState<string[]>([]);
  const [sort, setSort] = useState<{
    key: SortKey;
    direction: SortDirection;
  } | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [dialog, setDialog] = useState<SftpDialogState | null>(null);
  const [dialogName, setDialogName] = useState("");
  const [deleteCandidate, setDeleteCandidate] = useState<SftpEntry | null>(
    null,
  );
  const [pendingUpload, setPendingUpload] = useState<PendingUpload | null>(
    null,
  );
  const [textFile, setTextFile] = useState<SftpTextFile | null>(null);
  const [confirmTextClose, setConfirmTextClose] = useState(false);
  const [confirmTextOverwrite, setConfirmTextOverwrite] = useState(false);
  const [editorDialogLayout, setEditorDialogLayout] =
    useState<EditorDialogLayout | null>(null);
  const [transferTasks, setTransferTasks] = useState<TransferTask[]>([]);
  const initialLoadSessionRef = useRef<string | null>(null);
  const transferSeqRef = useRef(0);
  const editorDialogRef = useRef<HTMLElement | null>(null);
  const editorDialogInteractionRef = useRef<EditorDialogInteraction | null>(
    null,
  );

  const sortedEntries = useMemo(() => {
    if (!sort) return entries;
    return [...entries].sort((left, right) => {
      const result = compareEntries(left, right, sort.key);
      return sort.direction === "asc" ? result : -result;
    });
  }, [entries, sort]);

  useEffect(() => {
    if (!connectionId) {
      setSessionId(null);
      setEntries([]);
      setError(null);
      return;
    }

    let disposed = false;
    let openedSessionId: string | null = null;

    setSessionId(null);
    setPath("/");
    setAddressPath("/");
    setEntries([]);
    setError(null);
    setIsLoading(false);
    setBackStack([]);
    setForwardStack([]);
    initialLoadSessionRef.current = null;
    setDialog(null);
    setDeleteCandidate(null);
    setPendingUpload(null);
    setTextFile(null);
    setConfirmTextClose(false);
    setConfirmTextOverwrite(false);
    setEditorDialogLayout(null);
    setTransferTasks([]);
    transferSeqRef.current = 0;

    void callBackend<{ session_id: string }>("open_sftp_session", {
      request: { connection_id: connectionId },
    })
      .then((response) => {
        openedSessionId = response.session_id;
        if (disposed) {
          void callBackend("close_sftp_session", {
            request: { session_id: openedSessionId },
          });
          return;
        }
        setSessionId(openedSessionId);
      })
      .catch((caught) => {
        if (!disposed) {
          setError(caught instanceof Error ? caught.message : String(caught));
        }
      });

    return () => {
      disposed = true;
      if (openedSessionId) {
        void callBackend("close_sftp_session", {
          request: { session_id: openedSessionId },
        });
      }
    };
  }, [connectionId]);

  useEffect(() => {
    const unlisten = listenSftpTransferProgress((payload) => {
      updateTransferTask(payload.transfer_id, { progress: payload.progress });
    });
    return () => {
      void unlisten.then((dispose) => dispose());
    };
  }, []);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (!textFile || !(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "s") {
        return;
      }
      event.preventDefault();
      void saveTextFile(false);
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [textFile, sessionId]);

  useEffect(() => {
    function handlePointerMove(event: PointerEvent) {
      const interaction = editorDialogInteractionRef.current;
      if (!interaction) return;

      const deltaX = event.clientX - interaction.startX;
      const deltaY = event.clientY - interaction.startY;
      const nextLayout =
        interaction.kind === "move"
          ? {
              left: interaction.startLeft + deltaX,
              top: interaction.startTop + deltaY,
              width: interaction.startWidth,
              height: interaction.startHeight,
            }
          : {
              left: interaction.startLeft,
              top: interaction.startTop,
              width: interaction.startWidth + deltaX,
              height: interaction.startHeight + deltaY,
            };

      setEditorDialogLayout(clampDialogLayout(nextLayout));
    }

    function handlePointerUp() {
      editorDialogInteractionRef.current = null;
    }

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, []);

  const loadPath = useCallback(
    async (nextPath: string) => {
      if (!sessionId) return;
      const normalizedPath = normalizeRemotePath(nextPath);
      setIsLoading(true);
      try {
        const nextEntries = await callBackend<SftpEntry[]>(
          "list_sftp_directory",
          {
            request: { session_id: sessionId, path: normalizedPath },
          },
        );
        setEntries(nextEntries);
        setError(null);
        return normalizedPath;
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : String(caught));
        return null;
      } finally {
        setIsLoading(false);
      }
    },
    [sessionId],
  );

  useEffect(() => {
    if (!sessionId || initialLoadSessionRef.current === sessionId) return;
    initialLoadSessionRef.current = sessionId;
    void loadPath(path);
  }, [loadPath, path, sessionId]);

  const navigateTo = useCallback(
    async (nextPath: string) => {
      const loadedPath = await loadPath(nextPath);
      if (!loadedPath) return;
      if (loadedPath !== path) {
        setBackStack((stack) => [...stack, path]);
        setForwardStack([]);
      }
      setPath(loadedPath);
      setAddressPath(loadedPath);
    },
    [loadPath, path],
  );

  const refresh = useCallback(async () => {
    const loadedPath = await loadPath(path);
    if (!loadedPath) return;
    setPath(loadedPath);
    setAddressPath(loadedPath);
  }, [loadPath, path]);

  const goBack = useCallback(async () => {
    const previousPath = backStack[backStack.length - 1];
    if (!previousPath) return;
    const loadedPath = await loadPath(previousPath);
    if (!loadedPath) return;
    setBackStack((stack) => stack.slice(0, -1));
    setForwardStack((stack) => [path, ...stack]);
    setPath(loadedPath);
    setAddressPath(loadedPath);
  }, [backStack, loadPath, path]);

  const goForward = useCallback(async () => {
    const nextPath = forwardStack[0];
    if (!nextPath) return;
    const loadedPath = await loadPath(nextPath);
    if (!loadedPath) return;
    setBackStack((stack) => [...stack, path]);
    setForwardStack((stack) => stack.slice(1));
    setPath(loadedPath);
    setAddressPath(loadedPath);
  }, [forwardStack, loadPath, path]);

  function toggleSort(key: SortKey) {
    setSort((current) => ({
      key,
      direction:
        current?.key === key
          ? current.direction === "asc"
            ? "desc"
            : "asc"
          : key === "size" || key === "modified_at"
            ? "desc"
            : "asc",
    }));
  }

  function openDialog(nextDialog: SftpDialogState) {
    setDialog(nextDialog);
    setDialogName(nextDialog.initialValue);
  }

  function closeDialog() {
    setDialog(null);
    setDialogName("");
  }

  async function createDirectory(name: string) {
    if (!sessionId) return;
    try {
      await callBackend("create_sftp_directory", {
        request: { session_id: sessionId, path: joinRemotePath(path, name) },
      });
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }

  async function createFile(name: string) {
    if (!sessionId) return;
    try {
      await callBackend("create_sftp_file", {
        request: { session_id: sessionId, path: joinRemotePath(path, name) },
      });
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }

  async function renameEntry(entry: SftpEntry, nextName: string) {
    if (!sessionId) return;
    try {
      await callBackend("rename_sftp_path", {
        request: {
          session_id: sessionId,
          from: entry.path,
          to: siblingRemotePath(entry.path, nextName),
        },
      });
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }

  async function submitDialog(event: React.FormEvent) {
    event.preventDefault();
    if (!dialog) return;
    const nextName = dialogName.trim();
    if (!nextName) return;
    if (dialog.kind === "create-directory") {
      await createDirectory(nextName);
    } else if (dialog.kind === "create-file") {
      await createFile(nextName);
    } else if (nextName !== dialog.entry.name) {
      await renameEntry(dialog.entry, nextName);
    }
    closeDialog();
  }

  async function deleteEntry(entry: SftpEntry) {
    if (!sessionId) return;
    try {
      await callBackend("delete_sftp_path", {
        request: { session_id: sessionId, path: entry.path },
      });
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }

  async function confirmDeleteEntry() {
    if (!deleteCandidate) return;
    await deleteEntry(deleteCandidate);
    setDeleteCandidate(null);
  }

  function updateTransferTask(id: string, patch: Partial<TransferTask>) {
    setTransferTasks((tasks) =>
      tasks.map((task) => (task.id === id ? { ...task, ...patch } : task)),
    );
  }

  function nextTransferId() {
    transferSeqRef.current += 1;
    return `transfer-${transferSeqRef.current}`;
  }

  async function uploadFile() {
    if (!sessionId) return;
    const localPath = await pickUploadFile();
    if (!localPath) return;
    const name = localFileName(localPath);
    const remotePath = joinRemotePath(path, name);
    if (entries.some((entry) => entry.name === name)) {
      setPendingUpload({ kind: "file", localPath, name, remotePath });
      return;
    }
    await uploadSelectedFile(
      { kind: "file", localPath, name, remotePath },
      false,
    );
  }

  async function uploadDirectory() {
    if (!sessionId) return;
    const localPath = await pickUploadDirectory();
    if (!localPath) return;
    const name = localFileName(localPath);
    const remotePath = joinRemotePath(path, name);
    if (entries.some((entry) => entry.name === name)) {
      setPendingUpload({ kind: "directory", localPath, name, remotePath });
      return;
    }
    await uploadSelectedFile(
      { kind: "directory", localPath, name, remotePath },
      false,
    );
  }

  async function uploadSelectedFile(upload: PendingUpload, overwrite: boolean) {
    if (!sessionId) return;
    const taskId = nextTransferId();
    setTransferTasks((tasks) => [
      { id: taskId, name: upload.name, direction: "upload", status: "running" },
      ...tasks,
    ]);
    try {
      await callBackend(
        upload.kind === "directory"
          ? "upload_sftp_directory"
          : "upload_sftp_file",
        {
          request: {
            session_id: sessionId,
            transfer_id: taskId,
            local_path: upload.localPath,
            remote_path: upload.remotePath,
            overwrite,
          },
        },
      );
      updateTransferTask(taskId, { status: "completed", progress: 100 });
      await refresh();
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      updateTransferTask(taskId, { status: "failed", error: message });
      setError(message);
    }
  }

  async function confirmUploadOverwrite() {
    if (!pendingUpload) return;
    const upload = pendingUpload;
    setPendingUpload(null);
    await uploadSelectedFile(upload, true);
  }

  async function compressEntry(entry: SftpEntry) {
    if (!sessionId) return;
    try {
      await callBackend("compress_sftp_path", {
        request: { session_id: sessionId, path: entry.path },
      });
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }

  async function extractArchive(entry: SftpEntry) {
    if (!sessionId) return;
    try {
      await callBackend("extract_sftp_archive", {
        request: { session_id: sessionId, path: entry.path },
      });
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }

  async function openTextFile(entry: SftpEntry) {
    if (!sessionId) return;
    if (!isTextEntry(entry)) {
      setError("暂不支持内置打开该文件类型");
      return;
    }
    try {
      const response = await callBackend<SftpReadTextFileResponse>(
        "read_sftp_text_file",
        {
          request: {
            session_id: sessionId,
            path: entry.path,
            max_bytes: TEXT_FILE_MAX_BYTES,
          },
        },
      );
      setTextFile({
        path: response.path,
        name: entry.name,
        content: response.content,
        originalContent: response.content,
        size: response.size,
        modifiedAt: response.modified_at ?? null,
        status: null,
      });
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }

  async function saveTextFile(overwrite: boolean) {
    if (!sessionId || !textFile) return;
    try {
      const response = await callBackend<SftpWriteTextFileResponse>(
        "write_sftp_text_file",
        {
          request: {
            session_id: sessionId,
            path: textFile.path,
            content: textFile.content,
            expected_modified_at: textFile.modifiedAt,
            overwrite,
          },
        },
      );
      setConfirmTextOverwrite(false);
      setTextFile({
        ...textFile,
        originalContent: textFile.content,
        size: response.size,
        modifiedAt: response.modified_at ?? null,
        status: "已保存",
      });
      await refresh();
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      if (message.startsWith("remote file changed:")) {
        setConfirmTextOverwrite(true);
        return;
      }
      setError(message);
    }
  }

  function requestCloseTextFile() {
    if (!textFile) return;
    if (textFile.content !== textFile.originalContent) {
      setConfirmTextClose(true);
      return;
    }
    setTextFile(null);
  }

  function closeTextFileWithoutSaving() {
    setTextFile(null);
    setConfirmTextClose(false);
    setConfirmTextOverwrite(false);
  }

  function getCurrentEditorDialogLayout() {
    if (editorDialogLayout) return editorDialogLayout;
    const rect = editorDialogRef.current?.getBoundingClientRect();
    return {
      left: rect?.left ?? EDITOR_DIALOG_VIEWPORT_MARGIN,
      top: rect?.top ?? EDITOR_DIALOG_VIEWPORT_MARGIN,
      width: rect?.width ?? 880,
      height: rect?.height ?? 560,
    };
  }

  function startEditorDialogMove(event: ReactPointerEvent<HTMLElement>) {
    if (event.button !== 0) return;
    const layout = getCurrentEditorDialogLayout();
    editorDialogInteractionRef.current = {
      kind: "move",
      startX: event.clientX,
      startY: event.clientY,
      startLeft: layout.left,
      startTop: layout.top,
      startWidth: layout.width,
      startHeight: layout.height,
    };
  }

  function startEditorDialogResize(event: ReactPointerEvent<HTMLSpanElement>) {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const layout = getCurrentEditorDialogLayout();
    editorDialogInteractionRef.current = {
      kind: "resize",
      startX: event.clientX,
      startY: event.clientY,
      startLeft: layout.left,
      startTop: layout.top,
      startWidth: layout.width,
      startHeight: layout.height,
    };
    setEditorDialogLayout(clampDialogLayout(layout));
  }

  async function downloadFile(entry: SftpEntry) {
    if (!sessionId) return;
    const localPath = await pickDownloadPath(entry.name);
    if (!localPath) return;
    const taskId = nextTransferId();
    setTransferTasks((tasks) => [
      {
        id: taskId,
        name: entry.name,
        direction: "download",
        status: "running",
      },
      ...tasks,
    ]);
    try {
      await callBackend("download_sftp_file", {
        request: {
          session_id: sessionId,
          transfer_id: taskId,
          remote_path: entry.path,
          local_path: localPath,
        },
      });
      updateTransferTask(taskId, { status: "completed", progress: 100 });
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      updateTransferTask(taskId, { status: "failed", error: message });
      setError(message);
    }
  }

  async function downloadDirectory(entry: SftpEntry) {
    if (!sessionId) return;
    const selectedDirectory = await pickDownloadDirectory();
    if (!selectedDirectory) return;
    const localPath = joinLocalPath(selectedDirectory, entry.name);
    const taskId = nextTransferId();
    setTransferTasks((tasks) => [
      {
        id: taskId,
        name: entry.name,
        direction: "download",
        status: "running",
      },
      ...tasks,
    ]);
    try {
      await callBackend("download_sftp_directory", {
        request: {
          session_id: sessionId,
          transfer_id: taskId,
          remote_path: entry.path,
          local_path: localPath,
          overwrite: false,
        },
      });
      updateTransferTask(taskId, { status: "completed", progress: 100 });
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      updateTransferTask(taskId, { status: "failed", error: message });
      setError(message);
    }
  }

  function currentDirectoryMenuItems(): ContextMenuItem[] {
    return [
      { label: "刷新", onSelect: () => void refresh() },
      ...currentDirectoryCreateMenuItems(),
    ];
  }

  function currentDirectoryCreateMenuItems(): ContextMenuItem[] {
    return [
      {
        label: "新建文件",
        onSelect: () =>
          openDialog({
            kind: "create-file",
            title: "新建文件",
            initialValue: "",
          }),
      },
      {
        label: "新建文件夹",
        onSelect: () =>
          openDialog({
            kind: "create-directory",
            title: "新建文件夹",
            initialValue: "",
          }),
      },
      { label: "上传文件", onSelect: () => void uploadFile() },
      { label: "上传文件夹", onSelect: () => void uploadDirectory() },
    ];
  }

  function openBlankContextMenu(event: React.MouseEvent) {
    event.preventDefault();
    setContextMenu({
      x: event.clientX,
      y: event.clientY,
      items: currentDirectoryMenuItems(),
    });
  }

  function openEntryContextMenu(event: React.MouseEvent, entry: SftpEntry) {
    event.preventDefault();
    event.stopPropagation();
    const items: ContextMenuItem[] = [
      { label: "刷新", onSelect: () => void refresh() },
      {
        label: "下载",
        onSelect: () =>
          void (entry.kind === "directory"
            ? downloadDirectory(entry)
            : downloadFile(entry)),
      },
      ...(isTextEntry(entry)
        ? [{ label: "编辑", onSelect: () => void openTextFile(entry) }]
        : []),
      { label: "压缩", onSelect: () => void compressEntry(entry) },
      ...(isArchiveEntry(entry)
        ? [{ label: "解压缩", onSelect: () => void extractArchive(entry) }]
        : []),
      {
        label: "重命名",
        onSelect: () =>
          openDialog({
            kind: "rename",
            title: "重命名",
            initialValue: entry.name,
            entry,
          }),
      },
      {
        label: "复制路径",
        onSelect: () => void writeClipboardText(entry.path),
      },
      { label: "删除", onSelect: () => setDeleteCandidate(entry) },
      { type: "separator" },
      { type: "label", label: "在当前目录下：" },
      ...currentDirectoryCreateMenuItems(),
    ];
    setContextMenu({
      x: event.clientX,
      y: event.clientY,
      items,
    });
  }

  if (!connectionId) {
    return (
      <section className="workspace-empty">
        <h2>未选择连接</h2>
        <p>请先在左侧连接列表中打开 SFTP。</p>
      </section>
    );
  }

  return (
    <section className="sftp-workspace">
      <header>
        <h2>SFTP</h2>
        <button
          type="button"
          onClick={() => void goBack()}
          disabled={!backStack.length}
        >
          后退
        </button>
        <button
          type="button"
          onClick={() => void goForward()}
          disabled={!forwardStack.length}
        >
          前进
        </button>
        <input
          value={addressPath}
          onChange={(event) => setAddressPath(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              void navigateTo(addressPath);
            }
          }}
          aria-label="远程路径"
        />
        <button type="button" onClick={() => void refresh()}>
          刷新
        </button>
        <button
          type="button"
          onClick={() =>
            openDialog({
              kind: "create-directory",
              title: "新建文件夹",
              initialValue: "",
            })
          }
        >
          新建目录
        </button>
      </header>
      {error ? <p role="alert">{error}</p> : null}
      {isLoading ? <p role="status">加载中...</p> : null}
      <div
        className="sftp-table-scroll"
        aria-label="SFTP 文件列表"
        onContextMenu={openBlankContextMenu}
      >
        <table>
          <thead>
            <tr>
              <th>
                <button
                  type="button"
                  aria-label="按名称排序"
                  onClick={() => toggleSort("name")}
                >
                  名称
                </button>
              </th>
              <th>类型</th>
              <th>
                <button
                  type="button"
                  aria-label="按大小排序"
                  onClick={() => toggleSort("size")}
                >
                  大小
                </button>
              </th>
              <th>
                <button
                  type="button"
                  aria-label="按修改时间排序"
                  onClick={() => toggleSort("modified_at")}
                >
                  修改时间
                </button>
              </th>
              <th>权限</th>
            </tr>
          </thead>
          <tbody>
            {sortedEntries.map((entry) => (
              <tr
                key={entry.path}
                onDoubleClick={() => {
                  if (entry.kind === "directory") {
                    void navigateTo(entry.path);
                  } else {
                    void openTextFile(entry);
                  }
                }}
                onContextMenu={(event) => openEntryContextMenu(event, entry)}
              >
                <td>
                  <span className={getEntryNameClassName(entry)}>
                    {entry.name}
                  </span>
                </td>
                <td>{entry.kind}</td>
                <td>{formatFileSize(entry.size, sizeUnit)}</td>
                <td>{formatModifiedTime(entry.modified_at)}</td>
                <td>{entry.permissions ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <TransferQueue tasks={transferTasks} />
      <ContextMenu menu={contextMenu} onClose={() => setContextMenu(null)} />
      {dialog ? (
        <div
          className="connection-dialog__backdrop"
          role="presentation"
          onPointerDown={closeDialog}
        >
          <form
            className="connection-dialog sftp-dialog"
            role="dialog"
            aria-label={dialog.title}
            onSubmit={(event) => void submitDialog(event)}
            onPointerDown={(event) => event.stopPropagation()}
          >
            <div className="connection-form">
              <header className="connection-dialog__header">
                <h2>{dialog.title}</h2>
                <button type="button" onClick={closeDialog} aria-label="关闭">
                  ×
                </button>
              </header>
              <label>
                <span>名称</span>
                <input
                  autoFocus
                  value={dialogName}
                  onChange={(event) => setDialogName(event.target.value)}
                  aria-label="名称"
                />
              </label>
              <div className="sftp-dialog__actions">
                <button type="button" onClick={closeDialog}>
                  取消
                </button>
                <button type="submit">确认</button>
              </div>
            </div>
          </form>
        </div>
      ) : null}
      {deleteCandidate ? (
        <div
          className="connection-dialog__backdrop"
          role="presentation"
          onPointerDown={() => setDeleteCandidate(null)}
        >
          <section
            className="connection-dialog sftp-dialog"
            role="dialog"
            aria-label="确认删除"
            onPointerDown={(event) => event.stopPropagation()}
          >
            <div className="connection-form">
              <header className="connection-dialog__header">
                <h2>确认删除</h2>
                <button
                  type="button"
                  onClick={() => setDeleteCandidate(null)}
                  aria-label="关闭"
                >
                  ×
                </button>
              </header>
              <p>{getDeleteConfirmationText(deleteCandidate)}</p>
              <div className="sftp-dialog__actions">
                <button type="button" onClick={() => setDeleteCandidate(null)}>
                  取消
                </button>
                <button
                  type="button"
                  className="sftp-dialog__danger-button"
                  onClick={() => void confirmDeleteEntry()}
                >
                  确认
                </button>
              </div>
            </div>
          </section>
        </div>
      ) : null}
      {pendingUpload ? (
        <div
          className="connection-dialog__backdrop"
          role="presentation"
          onPointerDown={() => setPendingUpload(null)}
        >
          <section
            className="connection-dialog sftp-dialog"
            role="dialog"
            aria-label="确认覆盖"
            onPointerDown={(event) => event.stopPropagation()}
          >
            <div className="connection-form">
              <header className="connection-dialog__header">
                <h2>确认覆盖</h2>
                <button
                  type="button"
                  onClick={() => setPendingUpload(null)}
                  aria-label="关闭"
                >
                  ×
                </button>
              </header>
              <p>{pendingUpload.name} 已存在，是否覆盖？</p>
              <div className="sftp-dialog__actions">
                <button type="button" onClick={() => setPendingUpload(null)}>
                  取消
                </button>
                <button
                  type="button"
                  className="sftp-dialog__danger-button"
                  onClick={() => void confirmUploadOverwrite()}
                >
                  覆盖
                </button>
              </div>
            </div>
          </section>
        </div>
      ) : null}
      {textFile ? (
        <div
          className="connection-dialog__backdrop"
          role="presentation"
        >
          <section
            className="connection-dialog sftp-dialog sftp-editor-dialog"
            role="dialog"
            aria-label={`编辑 ${textFile.name}`}
            ref={editorDialogRef}
            style={
              editorDialogLayout
                ? {
                    left: `${editorDialogLayout.left}px`,
                    top: `${editorDialogLayout.top}px`,
                    width: `${editorDialogLayout.width}px`,
                    height: `${editorDialogLayout.height}px`,
                  }
                : undefined
            }
            onPointerDown={(event) => event.stopPropagation()}
          >
            <div className="connection-form">
              <header
                className="connection-dialog__header sftp-editor-dialog__drag-handle"
                aria-label="拖动编辑器"
                onPointerDown={startEditorDialogMove}
              >
                <h2>编辑 {textFile.name}</h2>
                <button
                  type="button"
                  onClick={requestCloseTextFile}
                  aria-label="关闭编辑器"
                >
                  ×
                </button>
              </header>
              <label className="sftp-editor-dialog__content">
                <span className="sftp-editor-dialog__content-header">
                  <span>文件内容</span>
                  <span className="sftp-editor-dialog__meta">
                    <span>{textFile.path}</span>
                    <span>{formatFileSize(textFile.size, sizeUnit)}</span>
                    <span>{formatModifiedTime(textFile.modifiedAt ?? undefined)}</span>
                  </span>
                </span>
                <textarea
                  value={textFile.content}
                  onChange={(event) =>
                    setTextFile({
                      ...textFile,
                      content: event.target.value,
                      status: null,
                    })
                  }
                  aria-label="文件内容"
                />
              </label>
              <div className="sftp-dialog__actions">
                {textFile.status ? <span>{textFile.status}</span> : null}
                <button type="button" onClick={requestCloseTextFile}>
                  关闭
                </button>
                <button type="button" onClick={() => void saveTextFile(false)}>
                  保存
                </button>
              </div>
            </div>
            <span
              className="sftp-editor-dialog__resize-handle sftp-editor-dialog__resize-handle--corner"
              aria-label="调整编辑器大小"
              role="separator"
              onPointerDown={startEditorDialogResize}
            />
          </section>
        </div>
      ) : null}
      {confirmTextClose && textFile ? (
        <div
          className="connection-dialog__backdrop"
          role="presentation"
          onPointerDown={() => setConfirmTextClose(false)}
        >
          <section
            className="connection-dialog sftp-dialog"
            role="dialog"
            aria-label="确认关闭"
            onPointerDown={(event) => event.stopPropagation()}
          >
            <div className="connection-form">
              <header className="connection-dialog__header">
                <h2>确认关闭</h2>
                <button
                  type="button"
                  onClick={() => setConfirmTextClose(false)}
                  aria-label="关闭"
                >
                  ×
                </button>
              </header>
              <p>文件 {textFile.name} 有未保存修改，确认关闭？</p>
              <div className="sftp-dialog__actions">
                <button type="button" onClick={() => setConfirmTextClose(false)}>
                  取消
                </button>
                <button
                  type="button"
                  className="sftp-dialog__danger-button"
                  onClick={closeTextFileWithoutSaving}
                >
                  确认
                </button>
              </div>
            </div>
          </section>
        </div>
      ) : null}
      {confirmTextOverwrite && textFile ? (
        <div
          className="connection-dialog__backdrop"
          role="presentation"
          onPointerDown={() => setConfirmTextOverwrite(false)}
        >
          <section
            className="connection-dialog sftp-dialog"
            role="dialog"
            aria-label="确认覆盖保存"
            onPointerDown={(event) => event.stopPropagation()}
          >
            <div className="connection-form">
              <header className="connection-dialog__header">
                <h2>确认覆盖保存</h2>
                <button
                  type="button"
                  onClick={() => setConfirmTextOverwrite(false)}
                  aria-label="关闭"
                >
                  ×
                </button>
              </header>
              <p>远程文件 {textFile.name} 已被修改，是否覆盖保存？</p>
              <div className="sftp-dialog__actions">
                <button type="button" onClick={() => setConfirmTextOverwrite(false)}>
                  取消
                </button>
                <button
                  type="button"
                  className="sftp-dialog__danger-button"
                  onClick={() => void saveTextFile(true)}
                >
                  覆盖保存
                </button>
              </div>
            </div>
          </section>
        </div>
      ) : null}
    </section>
  );
}
