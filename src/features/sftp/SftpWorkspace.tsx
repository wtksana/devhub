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
import { listenLocalDragDrop } from "../../lib/tauriDragDrop";
import { listenSftpTransferProgress } from "../../lib/tauriEvents";
import type { SftpFileSizeUnit } from "../settings/settingsTypes";
import type { SftpEntry } from "./sftpTypes";
import { TransferQueue, type TransferTask } from "./TransferQueue";
import type { TranslationKey } from "../../i18n/I18nProvider";
import { useI18n } from "../../i18n/useI18n";

interface SftpWorkspaceProps {
  connectionId: string | null;
  sizeUnit?: SftpFileSizeUnit;
}

type SortKey = "name" | "size" | "modified_at";
type SortDirection = "asc" | "desc";
type SftpDialogState =
  | {
      kind: "create-directory";
      title: string;
      initialValue: "";
      entry?: undefined;
    }
  | {
      kind: "create-file";
      title: string;
      initialValue: "";
      entry?: undefined;
    }
  | { kind: "rename"; title: string; initialValue: string; entry: SftpEntry };
type PendingUpload = {
  kind: "file" | "directory";
  localPath: string;
  name: string;
  remotePath: string;
};
type PendingBatchArchive = {
  archiveName: string;
  entries: SftpEntry[];
};
type LocalPathKindResponse = {
  kind: "file" | "directory";
  name: string;
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

function getDeleteConfirmationText(entry: SftpEntry, t: (key: TranslationKey, params?: Record<string, string | number>) => string) {
  return t("sftp.delete_confirm_message", {
    name: entry.name,
    suffix: entry.kind === "directory" ? t("sftp.delete_directory_suffix") : "",
  });
}

function getBatchDeleteConfirmationText(entries: SftpEntry[], t: (key: TranslationKey, params?: Record<string, string | number>) => string) {
  return t("sftp.batch_delete_confirm_message", { count: entries.length });
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

function localFileName(path: string, t: (key: TranslationKey, params?: Record<string, string | number>) => string) {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? t("sftp.untitled_file");
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
  const { t } = useI18n();
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
  const [batchDeleteCandidates, setBatchDeleteCandidates] = useState<
    SftpEntry[]
  >([]);
  const [pendingUpload, setPendingUpload] = useState<PendingUpload | null>(
    null,
  );
  const [pendingBatchArchive, setPendingBatchArchive] =
    useState<PendingBatchArchive | null>(null);
  const [textFile, setTextFile] = useState<SftpTextFile | null>(null);
  const [confirmTextClose, setConfirmTextClose] = useState(false);
  const [confirmTextOverwrite, setConfirmTextOverwrite] = useState(false);
  const [editorDialogLayout, setEditorDialogLayout] =
    useState<EditorDialogLayout | null>(null);
  const [isDragOverFileList, setIsDragOverFileList] = useState(false);
  const [transferTasks, setTransferTasks] = useState<TransferTask[]>([]);
  const [selectedEntryPaths, setSelectedEntryPaths] = useState<Set<string>>(
    () => new Set(),
  );
  const initialLoadSessionRef = useRef<string | null>(null);
  const transferSeqRef = useRef(0);
  const runningTransferIdsRef = useRef<Set<string>>(new Set());
  const fileListRef = useRef<HTMLDivElement | null>(null);
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
  const selectedEntries = useMemo(
    () => entries.filter((entry) => selectedEntryPaths.has(entry.path)),
    [entries, selectedEntryPaths],
  );

  useEffect(() => {
    if (!connectionId) {
      setSessionId(null);
      setEntries([]);
      setError(null);
      setSelectedEntryPaths(new Set());
      return;
    }

    let disposed = false;
    let openedSessionId: string | null = null;

    setSessionId(null);
    setPath("/");
    setAddressPath("/");
    setEntries([]);
    setError(null);
    setSelectedEntryPaths(new Set());
    setIsLoading(false);
    setBackStack([]);
    setForwardStack([]);
    initialLoadSessionRef.current = null;
    setDialog(null);
    setDeleteCandidate(null);
    setBatchDeleteCandidates([]);
    setPendingUpload(null);
    setPendingBatchArchive(null);
    setTextFile(null);
    setConfirmTextClose(false);
    setConfirmTextOverwrite(false);
    setEditorDialogLayout(null);
    setIsDragOverFileList(false);
    setTransferTasks([]);
    runningTransferIdsRef.current.clear();
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
      cancelRunningTransfers();
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
    const unlisten = listenLocalDragDrop((event) => {
      if (event.type === "leave") {
        setIsDragOverFileList(false);
        return;
      }

      if (event.type === "enter" || event.type === "over") {
        setIsDragOverFileList(isPositionInsideFileList(event.position.x, event.position.y));
        return;
      }

      if (event.type !== "drop") return;
      const isInside = isPositionInsideFileList(event.position.x, event.position.y);
      setIsDragOverFileList(false);
      if (!isInside || !event.paths.length) return;

      void uploadDroppedPaths(event.paths);
    });

    return () => {
      void unlisten.then((dispose) => dispose());
    };
  }, [entries, path, sessionId]);

  useEffect(() => {
    setSelectedEntryPaths((current) => {
      const availablePaths = new Set(entries.map((entry) => entry.path));
      const next = new Set(
        [...current].filter((entryPath) => availablePaths.has(entryPath)),
      );
      return next.size === current.size ? current : next;
    });
  }, [entries]);

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
    await deleteEntries([entry]);
  }

  async function deleteEntries(targetEntries: SftpEntry[]) {
    if (!sessionId) return;
    try {
      for (const entry of targetEntries) {
        await callBackend("delete_sftp_path", {
          request: { session_id: sessionId, path: entry.path },
        });
      }
      setSelectedEntryPaths((current) => {
        const deletedPaths = new Set(targetEntries.map((entry) => entry.path));
        return new Set(
          [...current].filter((entryPath) => !deletedPaths.has(entryPath)),
        );
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

  async function confirmBatchDeleteEntries() {
    if (!batchDeleteCandidates.length) return;
    const candidates = batchDeleteCandidates;
    setBatchDeleteCandidates([]);
    await deleteEntries(candidates);
  }

  function toggleEntrySelection(entry: SftpEntry) {
    setSelectedEntryPaths((current) => {
      const next = new Set(current);
      if (next.has(entry.path)) {
        next.delete(entry.path);
      } else {
        next.add(entry.path);
      }
      return next;
    });
  }

  function selectAllVisibleEntries(checked: boolean) {
    setSelectedEntryPaths((current) => {
      const next = new Set(current);
      for (const entry of sortedEntries) {
        if (checked) {
          next.add(entry.path);
        } else {
          next.delete(entry.path);
        }
      }
      return next;
    });
  }

  function updateTransferTask(id: string, patch: Partial<TransferTask>) {
    if (patch.status && patch.status !== "running") {
      runningTransferIdsRef.current.delete(id);
    }
    setTransferTasks((tasks) =>
      tasks.map((task) => (task.id === id ? { ...task, ...patch } : task)),
    );
  }

  function nextTransferId() {
    transferSeqRef.current += 1;
    return `transfer-${transferSeqRef.current}`;
  }

  function trackRunningTransfer(id: string) {
    runningTransferIdsRef.current.add(id);
  }

  function cancelTransfer(id: string) {
    runningTransferIdsRef.current.delete(id);
    updateTransferTask(id, { status: "canceled" });
    void callBackend("cancel_sftp_transfer", {
      request: { transfer_id: id },
    });
  }

  function cancelRunningTransfers() {
    const transferIds = Array.from(runningTransferIdsRef.current);
    runningTransferIdsRef.current.clear();
    for (const transferId of transferIds) {
      void callBackend("cancel_sftp_transfer", {
        request: { transfer_id: transferId },
      });
    }
  }

  async function uploadFile() {
    if (!sessionId) return;
    const localPath = await pickUploadFile();
    if (!localPath) return;
    const name = localFileName(localPath, t);
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
    const name = localFileName(localPath, t);
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

  function isPositionInsideFileList(x: number, y: number) {
    const rect = fileListRef.current?.getBoundingClientRect();
    if (!rect) return false;
    return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
  }

  async function uploadDroppedPaths(localPaths: string[]) {
    if (!sessionId) return;
    for (const localPath of localPaths) {
      try {
        const localPathInfo = await callBackend<LocalPathKindResponse>(
          "get_local_path_kind",
          { request: { path: localPath } },
        );
        const name = localPathInfo.name || localFileName(localPath, t);
        const remotePath = joinRemotePath(path, name);
        const upload = {
          kind: localPathInfo.kind,
          localPath,
          name,
          remotePath,
        };

        if (entries.some((entry) => entry.name === name)) {
          setPendingUpload(upload);
          return;
        }

        await uploadSelectedFile(upload, false);
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : String(caught));
      }
    }
  }

  async function uploadSelectedFile(upload: PendingUpload, overwrite: boolean) {
    if (!sessionId) return;
    const taskId = nextTransferId();
    trackRunningTransfer(taskId);
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
      if (message === "transfer canceled") {
        updateTransferTask(taskId, { status: "canceled" });
        await refresh();
      } else {
        updateTransferTask(taskId, { status: "failed", error: message });
        setError(message);
      }
    }
  }

  async function confirmUploadOverwrite() {
    if (!pendingUpload) return;
    const upload = pendingUpload;
    setPendingUpload(null);
    await uploadSelectedFile(upload, true);
  }

  async function compressEntry(entry: SftpEntry) {
    await compressEntries([entry]);
  }

  async function compressEntries(targetEntries: SftpEntry[]) {
    if (!sessionId) return;
    if (targetEntries.length > 1) {
      setPendingBatchArchive({
        archiveName: "selected.tar.gz",
        entries: targetEntries,
      });
      return;
    }
    try {
      for (const entry of targetEntries) {
        await callBackend("compress_sftp_path", {
          request: { session_id: sessionId, path: entry.path },
        });
      }
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }

  async function confirmBatchArchive(event: React.FormEvent) {
    event.preventDefault();
    if (!sessionId || !pendingBatchArchive) return;
    const archiveName = pendingBatchArchive.archiveName.trim();
    if (!archiveName) return;
    try {
      await callBackend("compress_sftp_paths", {
        request: {
          session_id: sessionId,
          archive_name: archiveName,
          paths: pendingBatchArchive.entries.map((entry) => entry.path),
        },
      });
      setPendingBatchArchive(null);
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
      setError(t("sftp.unsupported_file"));
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
        status: t("sftp.saved"),
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
    await downloadFileToPath(entry, localPath);
  }

  async function downloadFileToPath(entry: SftpEntry, localPath: string) {
    if (!sessionId) return;
    const taskId = nextTransferId();
    trackRunningTransfer(taskId);
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
      if (message === "transfer canceled") {
        updateTransferTask(taskId, { status: "canceled" });
        await refresh();
      } else {
        updateTransferTask(taskId, { status: "failed", error: message });
        setError(message);
      }
    }
  }

  async function downloadDirectory(entry: SftpEntry) {
    if (!sessionId) return;
    const selectedDirectory = await pickDownloadDirectory();
    if (!selectedDirectory) return;
    const localPath = joinLocalPath(selectedDirectory, entry.name);
    await downloadDirectoryToPath(entry, localPath);
  }

  async function downloadDirectoryToPath(entry: SftpEntry, localPath: string) {
    if (!sessionId) return;
    const taskId = nextTransferId();
    trackRunningTransfer(taskId);
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
      if (message === "transfer canceled") {
        updateTransferTask(taskId, { status: "canceled" });
        await refresh();
      } else {
        updateTransferTask(taskId, { status: "failed", error: message });
        setError(message);
      }
    }
  }

  async function downloadEntries(targetEntries: SftpEntry[]) {
    if (!sessionId || targetEntries.length === 0) return;
    if (targetEntries.length === 1) {
      const [entry] = targetEntries;
      await (entry.kind === "directory"
        ? downloadDirectory(entry)
        : downloadFile(entry));
      return;
    }
    const selectedDirectory = await pickDownloadDirectory();
    if (!selectedDirectory) return;
    for (const entry of targetEntries) {
      const localPath = joinLocalPath(selectedDirectory, entry.name);
      if (entry.kind === "directory") {
        await downloadDirectoryToPath(entry, localPath);
      } else {
        await downloadFileToPath(entry, localPath);
      }
    }
  }

  function currentDirectoryMenuItems(): ContextMenuItem[] {
    return [
      { label: t("sftp.refresh"), onSelect: () => void refresh() },
      ...currentDirectoryCreateMenuItems(),
    ];
  }

  function currentDirectoryCreateMenuItems(): ContextMenuItem[] {
    return [
      {
        label: t("sftp.create_file"),
        onSelect: () =>
          openDialog({
            kind: "create-file",
            title: t("sftp.create_file"),
            initialValue: "",
          }),
      },
      {
        label: t("sftp.create_directory"),
        onSelect: () =>
          openDialog({
            kind: "create-directory",
            title: t("sftp.create_directory"),
            initialValue: "",
          }),
      },
      { label: t("sftp.upload_file"), onSelect: () => void uploadFile() },
      { label: t("sftp.upload_directory"), onSelect: () => void uploadDirectory() },
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
    const menuTargetEntries = selectedEntryPaths.has(entry.path)
      ? selectedEntries
      : [entry];
    const isBatchMenu = menuTargetEntries.length > 1;
    if (isBatchMenu) {
      const items: ContextMenuItem[] = [
        { label: t("sftp.refresh"), onSelect: () => void refresh() },
        {
          label: t("sftp.download_selected"),
          onSelect: () => void downloadEntries(menuTargetEntries),
        },
        {
          label: t("sftp.compress_selected"),
          onSelect: () => void compressEntries(menuTargetEntries),
        },
        {
          label: t("sftp.copy_selected_paths"),
          onSelect: () =>
            void writeClipboardText(
              menuTargetEntries.map((selectedEntry) => selectedEntry.path).join("\r\n"),
            ),
        },
        {
          label: t("sftp.delete_selected"),
          onSelect: () => setBatchDeleteCandidates(menuTargetEntries),
        },
        { type: "separator" },
        { type: "label", label: t("sftp.current_directory_actions") },
        ...currentDirectoryCreateMenuItems(),
      ];
      setContextMenu({
        x: event.clientX,
        y: event.clientY,
        items,
      });
      return;
    }
    const items: ContextMenuItem[] = [
      { label: t("sftp.refresh"), onSelect: () => void refresh() },
      {
        label: t("sftp.download"),
        onSelect: () =>
          void (entry.kind === "directory"
            ? downloadDirectory(entry)
            : downloadFile(entry)),
      },
      ...(isTextEntry(entry)
        ? [{ label: t("sftp.edit"), onSelect: () => void openTextFile(entry) }]
        : []),
      { label: t("sftp.compress"), onSelect: () => void compressEntry(entry) },
      ...(isArchiveEntry(entry)
        ? [{ label: t("sftp.extract"), onSelect: () => void extractArchive(entry) }]
        : []),
      {
        label: t("sftp.rename"),
        onSelect: () =>
          openDialog({
            kind: "rename",
            title: t("sftp.rename"),
            initialValue: entry.name,
            entry,
          }),
      },
      {
        label: t("sftp.copy_path"),
        onSelect: () => void writeClipboardText(entry.path),
      },
      { label: t("sftp.delete"), onSelect: () => setDeleteCandidate(entry) },
      { type: "separator" },
      { type: "label", label: t("sftp.current_directory_actions") },
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
        <h2>{t("sftp.no_connection")}</h2>
        <p>{t("sftp.no_connection_hint")}</p>
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
          {t("sftp.back")}
        </button>
        <button
          type="button"
          onClick={() => void goForward()}
          disabled={!forwardStack.length}
        >
          {t("sftp.forward")}
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
          aria-label={t("sftp.remote_path")}
        />
        <button type="button" onClick={() => void refresh()}>
          {t("sftp.refresh")}
        </button>
        <button
          type="button"
          onClick={() =>
            openDialog({
              kind: "create-directory",
              title: t("sftp.create_directory"),
              initialValue: "",
            })
          }
        >
          {t("sftp.new_directory")}
        </button>
      </header>
      {error ? <p role="alert">{error}</p> : null}
      {isLoading ? <p role="status">{t("sftp.loading")}</p> : null}
      <div
        ref={fileListRef}
        className={`sftp-table-scroll${isDragOverFileList ? " sftp-table-scroll--drag-over" : ""}`}
        aria-label={t("sftp.file_list")}
        onContextMenu={openBlankContextMenu}
      >
        {isDragOverFileList ? (
          <div className="sftp-drop-overlay">{t("sftp.drop_to_upload")}</div>
        ) : null}
        <table>
          <thead>
            <tr>
              <th className="sftp-selection-cell">
                <input
                  type="checkbox"
                  aria-label={t("sftp.select_all_visible")}
                  checked={
                    sortedEntries.length > 0 &&
                    sortedEntries.every((entry) => selectedEntryPaths.has(entry.path))
                  }
                  onChange={(event) => selectAllVisibleEntries(event.target.checked)}
                />
              </th>
              <th>
                <button
                  type="button"
                  aria-label={t("sftp.sort_by_name")}
                  onClick={() => toggleSort("name")}
                >
                  {t("sftp.name")}
                </button>
              </th>
              <th>{t("sftp.type")}</th>
              <th>
                <button
                  type="button"
                  aria-label={t("sftp.sort_by_size")}
                  onClick={() => toggleSort("size")}
                >
                  {t("sftp.size")}
                </button>
              </th>
              <th>
                <button
                  type="button"
                  aria-label={t("sftp.sort_by_modified_time")}
                  onClick={() => toggleSort("modified_at")}
                >
                  {t("sftp.modified_time")}
                </button>
              </th>
              <th>{t("sftp.permissions")}</th>
            </tr>
          </thead>
          <tbody>
            {sortedEntries.map((entry) => (
              <tr
                key={entry.path}
                className={
                  selectedEntryPaths.has(entry.path)
                    ? "sftp-entry-row--selected"
                    : undefined
                }
                onDoubleClick={() => {
                  if (entry.kind === "directory") {
                    void navigateTo(entry.path);
                  } else {
                    void openTextFile(entry);
                  }
                }}
                onContextMenu={(event) => openEntryContextMenu(event, entry)}
              >
                <td className="sftp-selection-cell">
                  <input
                    type="checkbox"
                    aria-label={t("sftp.select_entry", { name: entry.name })}
                    checked={selectedEntryPaths.has(entry.path)}
                    onChange={() => toggleEntrySelection(entry)}
                    onDoubleClick={(event) => event.stopPropagation()}
                    onClick={(event) => event.stopPropagation()}
                  />
                </td>
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
      <TransferQueue tasks={transferTasks} onCancel={cancelTransfer} />
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
                <button type="button" onClick={closeDialog} aria-label={t("sftp.close")}>
                  ×
                </button>
              </header>
              <label>
                <span>{t("sftp.name")}</span>
                <input
                  autoFocus
                  value={dialogName}
                  onChange={(event) => setDialogName(event.target.value)}
                  aria-label={t("sftp.name")}
                />
              </label>
              <div className="sftp-dialog__actions">
                <button type="button" onClick={closeDialog}>
                  {t("sftp.cancel")}
                </button>
                <button type="submit">{t("sftp.confirm")}</button>
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
            aria-label={t("sftp.confirm_delete")}
            onPointerDown={(event) => event.stopPropagation()}
          >
            <div className="connection-form">
              <header className="connection-dialog__header">
                <h2>{t("sftp.confirm_delete")}</h2>
                <button
                  type="button"
                  onClick={() => setDeleteCandidate(null)}
                  aria-label={t("sftp.close")}
                >
                  ×
                </button>
              </header>
              <p>{getDeleteConfirmationText(deleteCandidate, t)}</p>
              <div className="sftp-dialog__actions">
                <button type="button" onClick={() => setDeleteCandidate(null)}>
                  {t("sftp.cancel")}
                </button>
                <button
                  type="button"
                  className="sftp-dialog__danger-button"
                  onClick={() => void confirmDeleteEntry()}
                >
                  {t("sftp.confirm")}
                </button>
              </div>
            </div>
          </section>
        </div>
      ) : null}
      {batchDeleteCandidates.length ? (
        <div
          className="connection-dialog__backdrop"
          role="presentation"
          onPointerDown={() => setBatchDeleteCandidates([])}
        >
          <section
            className="connection-dialog sftp-dialog"
            role="dialog"
            aria-label={t("sftp.confirm_delete")}
            onPointerDown={(event) => event.stopPropagation()}
          >
            <div className="connection-form">
              <header className="connection-dialog__header">
                <h2>{t("sftp.confirm_delete")}</h2>
                <button
                  type="button"
                  onClick={() => setBatchDeleteCandidates([])}
                  aria-label={t("sftp.close")}
                >
                  ×
                </button>
              </header>
              <p>{getBatchDeleteConfirmationText(batchDeleteCandidates, t)}</p>
              <div className="sftp-dialog__actions">
                <button type="button" onClick={() => setBatchDeleteCandidates([])}>
                  {t("sftp.cancel")}
                </button>
                <button
                  type="button"
                  className="sftp-dialog__danger-button"
                  onClick={() => void confirmBatchDeleteEntries()}
                >
                  {t("sftp.confirm")}
                </button>
              </div>
            </div>
          </section>
        </div>
      ) : null}
      {pendingBatchArchive ? (
        <div
          className="connection-dialog__backdrop"
          role="presentation"
          onPointerDown={() => setPendingBatchArchive(null)}
        >
          <form
            className="connection-dialog sftp-dialog"
            role="dialog"
            aria-label={t("sftp.compress_selected")}
            onSubmit={(event) => void confirmBatchArchive(event)}
            onPointerDown={(event) => event.stopPropagation()}
          >
            <div className="connection-form">
              <header className="connection-dialog__header">
                <h2>{t("sftp.compress_selected")}</h2>
                <button
                  type="button"
                  onClick={() => setPendingBatchArchive(null)}
                  aria-label={t("sftp.close")}
                >
                  ×
                </button>
              </header>
              <label>
                {t("sftp.archive_name")}
                <input
                  value={pendingBatchArchive.archiveName}
                  onChange={(event) =>
                    setPendingBatchArchive({
                      ...pendingBatchArchive,
                      archiveName: event.target.value,
                    })
                  }
                  aria-label={t("sftp.name")}
                />
              </label>
              <div className="sftp-dialog__actions">
                <button type="button" onClick={() => setPendingBatchArchive(null)}>
                  {t("sftp.cancel")}
                </button>
                <button type="submit">{t("sftp.confirm")}</button>
              </div>
            </div>
          </form>
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
            aria-label={t("sftp.confirm_overwrite")}
            onPointerDown={(event) => event.stopPropagation()}
          >
            <div className="connection-form">
              <header className="connection-dialog__header">
                <h2>{t("sftp.confirm_overwrite")}</h2>
                <button
                  type="button"
                  onClick={() => setPendingUpload(null)}
                  aria-label={t("sftp.close")}
                >
                  ×
                </button>
              </header>
              <p>{t("sftp.overwrite_message", { name: pendingUpload.name })}</p>
              <div className="sftp-dialog__actions">
                <button type="button" onClick={() => setPendingUpload(null)}>
                  {t("sftp.cancel")}
                </button>
                <button
                  type="button"
                  className="sftp-dialog__danger-button"
                  onClick={() => void confirmUploadOverwrite()}
                >
                  {t("sftp.overwrite")}
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
            aria-label={t("sftp.edit_file", { name: textFile.name })}
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
                aria-label={t("sftp.drag_editor")}
                onPointerDown={startEditorDialogMove}
              >
                <h2>{t("sftp.edit_file", { name: textFile.name })}</h2>
                <button
                  type="button"
                  onClick={requestCloseTextFile}
                  aria-label={t("sftp.close_editor")}
                >
                  ×
                </button>
              </header>
              <label className="sftp-editor-dialog__content">
                <span className="sftp-editor-dialog__content-header">
                  <span>{t("sftp.file_content")}</span>
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
                  aria-label={t("sftp.file_content")}
                />
              </label>
              <div className="sftp-dialog__actions">
                {textFile.status ? <span>{textFile.status}</span> : null}
                <button type="button" onClick={requestCloseTextFile}>
                  {t("sftp.close")}
                </button>
                <button type="button" onClick={() => void saveTextFile(false)}>
                  {t("sftp.save")}
                </button>
              </div>
            </div>
            <span
              className="sftp-editor-dialog__resize-handle sftp-editor-dialog__resize-handle--corner"
              aria-label={t("sftp.resize_editor")}
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
            aria-label={t("sftp.confirm_close")}
            onPointerDown={(event) => event.stopPropagation()}
          >
            <div className="connection-form">
              <header className="connection-dialog__header">
                <h2>{t("sftp.confirm_close")}</h2>
                <button
                  type="button"
                  onClick={() => setConfirmTextClose(false)}
                  aria-label={t("sftp.close")}
                >
                  ×
                </button>
              </header>
              <p>{t("sftp.dirty_close_message", { name: textFile.name })}</p>
              <div className="sftp-dialog__actions">
                <button type="button" onClick={() => setConfirmTextClose(false)}>
                  {t("sftp.cancel")}
                </button>
                <button
                  type="button"
                  className="sftp-dialog__danger-button"
                  onClick={closeTextFileWithoutSaving}
                >
                  {t("sftp.confirm")}
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
            aria-label={t("sftp.confirm_overwrite_save")}
            onPointerDown={(event) => event.stopPropagation()}
          >
            <div className="connection-form">
              <header className="connection-dialog__header">
                <h2>{t("sftp.confirm_overwrite_save")}</h2>
                <button
                  type="button"
                  onClick={() => setConfirmTextOverwrite(false)}
                  aria-label={t("sftp.close")}
                >
                  ×
                </button>
              </header>
              <p>{t("sftp.remote_changed_message", { name: textFile.name })}</p>
              <div className="sftp-dialog__actions">
                <button type="button" onClick={() => setConfirmTextOverwrite(false)}>
                  {t("sftp.cancel")}
                </button>
                <button
                  type="button"
                  className="sftp-dialog__danger-button"
                  onClick={() => void saveTextFile(true)}
                >
                  {t("sftp.overwrite_save")}
                </button>
              </div>
            </div>
          </section>
        </div>
      ) : null}
    </section>
  );
}
