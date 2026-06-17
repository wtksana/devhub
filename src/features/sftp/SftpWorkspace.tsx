import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ContextMenu, type ContextMenuState } from "../../app/ContextMenu";
import { writeClipboardText } from "../../lib/clipboard";
import { callBackend } from "../../lib/tauri";
import type { SftpFileSizeUnit } from "../settings/settingsTypes";
import type { SftpEntry } from "./sftpTypes";
import { TransferQueue } from "./TransferQueue";

interface SftpWorkspaceProps {
  connectionId: string | null;
  sizeUnit?: SftpFileSizeUnit;
}

type SortKey = "name" | "size";
type SortDirection = "asc" | "desc";
type SftpDialogState =
  | { kind: "create-directory"; title: "新建文件夹"; initialValue: ""; entry?: undefined }
  | { kind: "create-file"; title: "新建文件"; initialValue: ""; entry?: undefined }
  | { kind: "rename"; title: "重命名"; initialValue: string; entry: SftpEntry };

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
  return parent === "/" ? `/${normalizedName}` : `${parent.replace(/\/+$/, "")}/${normalizedName}`;
}

function siblingRemotePath(path: string, nextName: string) {
  const parent = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) || "/" : "/";
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

function getEntryNameClassName(entry: SftpEntry) {
  const kind = entry.kind === "symlink" ? "link" : entry.kind;
  return `sftp-entry-name sftp-entry-name--${kind}`;
}

function getDeleteConfirmationText(entry: SftpEntry) {
  return `确认删除 ${entry.name}${entry.kind === "directory" ? " 文件夹" : ""}？`;
}

export function SftpWorkspace({ connectionId, sizeUnit = "bytes" }: SftpWorkspaceProps) {
  const [path, setPath] = useState("/");
  const [addressPath, setAddressPath] = useState("/");
  const [entries, setEntries] = useState<SftpEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [backStack, setBackStack] = useState<string[]>([]);
  const [forwardStack, setForwardStack] = useState<string[]>([]);
  const [sort, setSort] = useState<{ key: SortKey; direction: SortDirection } | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [dialog, setDialog] = useState<SftpDialogState | null>(null);
  const [dialogName, setDialogName] = useState("");
  const [deleteCandidate, setDeleteCandidate] = useState<SftpEntry | null>(null);
  const initialLoadSessionRef = useRef<string | null>(null);

  const sortedEntries = useMemo(() => {
    if (!sort) return entries;
    return [...entries].sort((left, right) => {
      const result =
        sort.key === "name"
          ? left.name.localeCompare(right.name)
          : left.size - right.size || left.name.localeCompare(right.name);
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

  const loadPath = useCallback(async (nextPath: string) => {
    if (!sessionId) return;
    const normalizedPath = normalizeRemotePath(nextPath);
    setIsLoading(true);
    try {
      const nextEntries = await callBackend<SftpEntry[]>("list_sftp_directory", {
        request: { session_id: sessionId, path: normalizedPath },
      });
      setEntries(nextEntries);
      setError(null);
      return normalizedPath;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
      return null;
    } finally {
      setIsLoading(false);
    }
  }, [sessionId]);

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
          : key === "size"
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
        request: { session_id: sessionId, from: entry.path, to: siblingRemotePath(entry.path, nextName) },
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

  function openBlankContextMenu(event: React.MouseEvent) {
    event.preventDefault();
    setContextMenu({
      x: event.clientX,
      y: event.clientY,
      items: [
        { label: "上传文件", onSelect: () => undefined },
        { label: "刷新", onSelect: () => void refresh() },
        { label: "新建文件夹", onSelect: () => openDialog({ kind: "create-directory", title: "新建文件夹", initialValue: "" }) },
        { label: "新建文件", onSelect: () => openDialog({ kind: "create-file", title: "新建文件", initialValue: "" }) },
      ],
    });
  }

  function openEntryContextMenu(event: React.MouseEvent, entry: SftpEntry) {
    event.preventDefault();
    event.stopPropagation();
    const items = [
      { label: "下载", onSelect: () => undefined },
      { label: "重命名", onSelect: () => openDialog({ kind: "rename", title: "重命名", initialValue: entry.name, entry }) },
      { label: "复制路径", onSelect: () => void writeClipboardText(entry.path) },
      { label: "删除", onSelect: () => setDeleteCandidate(entry) },
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
        <button type="button" onClick={() => void goBack()} disabled={!backStack.length}>
          后退
        </button>
        <button type="button" onClick={() => void goForward()} disabled={!forwardStack.length}>
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
        <button type="button" onClick={() => openDialog({ kind: "create-directory", title: "新建文件夹", initialValue: "" })}>
          新建目录
        </button>
      </header>
      {error ? <p role="alert">{error}</p> : null}
      {isLoading ? <p role="status">加载中...</p> : null}
      <div className="sftp-table-scroll" aria-label="SFTP 文件列表" onContextMenu={openBlankContextMenu}>
        <table>
          <thead>
            <tr>
              <th>
                <button type="button" aria-label="按名称排序" onClick={() => toggleSort("name")}>
                  名称
                </button>
              </th>
              <th>类型</th>
              <th>
                <button type="button" aria-label="按大小排序" onClick={() => toggleSort("size")}>
                  大小
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
                  }
                }}
                onContextMenu={(event) => openEntryContextMenu(event, entry)}
              >
                <td>
                  <span className={getEntryNameClassName(entry)}>{entry.name}</span>
                </td>
                <td>{entry.kind}</td>
                <td>{formatFileSize(entry.size, sizeUnit)}</td>
                <td>{entry.permissions ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="sftp-blank-action-area" aria-label="SFTP 空白操作区" onContextMenu={openBlankContextMenu} />
      </div>
      <TransferQueue />
      <ContextMenu menu={contextMenu} onClose={() => setContextMenu(null)} />
      {dialog ? (
        <div className="connection-dialog__backdrop" role="presentation" onPointerDown={closeDialog}>
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
        <div className="connection-dialog__backdrop" role="presentation" onPointerDown={() => setDeleteCandidate(null)}>
          <section
            className="connection-dialog sftp-dialog"
            role="dialog"
            aria-label="确认删除"
            onPointerDown={(event) => event.stopPropagation()}
          >
            <div className="connection-form">
              <header className="connection-dialog__header">
                <h2>确认删除</h2>
                <button type="button" onClick={() => setDeleteCandidate(null)} aria-label="关闭">
                  ×
                </button>
              </header>
              <p>{getDeleteConfirmationText(deleteCandidate)}</p>
              <div className="sftp-dialog__actions">
                <button type="button" onClick={() => setDeleteCandidate(null)}>
                  取消
                </button>
                <button type="button" className="sftp-dialog__danger-button" onClick={() => void confirmDeleteEntry()}>
                  确认
                </button>
              </div>
            </div>
          </section>
        </div>
      ) : null}
    </section>
  );
}
