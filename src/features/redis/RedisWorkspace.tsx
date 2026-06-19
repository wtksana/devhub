import { Fragment, useEffect, useMemo, useState } from "react";
import { ContextMenu, type ContextMenuState } from "../../app/ContextMenu";
import { useI18n } from "../../i18n/useI18n";
import { callBackend } from "../../lib/tauri";
import type { RedisKeyEntry, RedisKeyListResponse, RedisKeyValueResponse } from "./redisTypes";

interface RedisWorkspaceProps {
  connectionId: string | null;
  initialDatabase?: number;
}

const DEFAULT_LOAD_LIMIT = 5000;
const DEFAULT_KEY_SEPARATOR = ":";
const DEFAULT_VALUE_LIMIT = 500;
const DEFAULT_MAX_STRING_BYTES = 5 * 1024 * 1024;

interface RedisFolderNode {
  kind: "folder";
  id: string;
  name: string;
  depth: number;
  path: string;
}

interface RedisKeyNode {
  kind: "key";
  id: string;
  depth: number;
  entry: RedisKeyEntry;
}

type RedisTreeRow = RedisFolderNode | RedisKeyNode;

interface RedisTreeFolder {
  name: string;
  path: string;
  children: Map<string, RedisTreeFolder>;
  keys: RedisKeyEntry[];
}

function keywordToPattern(keyword: string) {
  const trimmedKeyword = keyword.trim();
  return trimmedKeyword ? `*${trimmedKeyword}*` : "*";
}

function formatTtl(ttl: number, neverExpiresText: string) {
  if (ttl === -1) return neverExpiresText;
  if (ttl === -2) return "";
  return String(ttl);
}

function formatBytes(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function buildRedisTreeRows(keys: RedisKeyEntry[], separator: string, expandedFolders: Set<string>) {
  const normalizedSeparator = separator.trim();
  if (!normalizedSeparator) {
    return keys.map<RedisKeyNode>((entry) => ({
      kind: "key",
      id: `key:${entry.key}`,
      depth: 0,
      entry,
    }));
  }

  const root: RedisTreeFolder = {
    name: "",
    path: "",
    children: new Map(),
    keys: [],
  };
  const rows: RedisTreeRow[] = [];

  for (const entry of keys) {
    const parts = entry.key.split(normalizedSeparator).filter(Boolean);
    if (parts.length <= 1) {
      root.keys.push(entry);
      continue;
    }

    let currentFolder = root;
    let folderPath = "";
    for (let index = 0; index < parts.length - 1; index += 1) {
      folderPath = folderPath ? `${folderPath}/${parts[index]}` : parts[index];
      let childFolder = currentFolder.children.get(parts[index]);
      if (!childFolder) {
        childFolder = {
          name: parts[index],
          path: folderPath,
          children: new Map(),
          keys: [],
        };
        currentFolder.children.set(parts[index], childFolder);
      }
      currentFolder = childFolder;
    }
    currentFolder.keys.push(entry);
  }

  function appendFolder(folder: RedisTreeFolder, depth: number) {
    rows.push({
      kind: "folder",
      id: `folder:${folder.path}`,
      name: folder.name,
      depth,
      path: folder.path,
    });
    if (!expandedFolders.has(folder.path)) return;

    for (const entry of folder.keys) {
      rows.push({
        kind: "key",
        id: `key:${entry.key}`,
        depth: depth + 1,
        entry,
      });
    }

    for (const childFolder of folder.children.values()) {
      appendFolder(childFolder, depth + 1);
    }
  }

  for (const entry of root.keys) {
    rows.push({
      kind: "key",
      id: `key:${entry.key}`,
      depth: 0,
      entry,
    });
  }

  for (const folder of root.children.values()) {
    appendFolder(folder, 0);
  }

  return rows;
}

export function RedisWorkspace({ connectionId, initialDatabase = 0 }: RedisWorkspaceProps) {
  const { t } = useI18n();
  const [database, setDatabase] = useState(initialDatabase);
  const [keyword, setKeyword] = useState("");
  const [keySeparator, setKeySeparator] = useState(DEFAULT_KEY_SEPARATOR);
  const [loadLimit, setLoadLimit] = useState(DEFAULT_LOAD_LIMIT);
  const [totalCount, setTotalCount] = useState(0);
  const [keys, setKeys] = useState<RedisKeyEntry[]>([]);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(() => new Set());
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [keyDetail, setKeyDetail] = useState<RedisKeyValueResponse | null>(null);
  const [keyDetailError, setKeyDetailError] = useState<string | null>(null);
  const [isKeyDetailLoading, setIsKeyDetailLoading] = useState(false);
  const [stringDraft, setStringDraft] = useState("");
  const [ttlDraft, setTtlDraft] = useState("");
  const [isKeyActionRunning, setIsKeyActionRunning] = useState(false);
  const [deleteCandidate, setDeleteCandidate] = useState<RedisKeyEntry | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const treeRows = useMemo(
    () => buildRedisTreeRows(keys, keySeparator, expandedFolders),
    [keys, keySeparator, expandedFolders],
  );

  async function loadKeys(nextDatabase = database, nextKeyword = keyword, nextLoadLimit = loadLimit) {
    if (!connectionId) return;
    setIsLoading(true);
    try {
      const response = await callBackend<RedisKeyListResponse>("list_redis_keys", {
        request: {
          connection_id: connectionId,
          database: nextDatabase,
          pattern: keywordToPattern(nextKeyword),
          count: nextLoadLimit,
        },
      });
      setTotalCount(response.total_count);
      setKeys(response.entries);
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
      setTotalCount(0);
      setKeys([]);
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    setDatabase(initialDatabase);
    setKeyword("");
    setKeySeparator(DEFAULT_KEY_SEPARATOR);
    setLoadLimit(DEFAULT_LOAD_LIMIT);
    setExpandedFolders(new Set());
    void loadKeys(initialDatabase, "", DEFAULT_LOAD_LIMIT);
  }, [connectionId, initialDatabase]);

  useEffect(() => {
    if (!keyDetail && !deleteCandidate) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      if (deleteCandidate) {
        setDeleteCandidate(null);
        return;
      }
      setKeyDetail(null);
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [keyDetail, deleteCandidate]);

  if (!connectionId) {
    return (
      <section className="workspace-empty">
        <h2>{t("redis.no_connection")}</h2>
        <p>{t("redis.no_connection_hint")}</p>
      </section>
    );
  }

  function toggleFolder(path: string) {
    setExpandedFolders((current) => {
      const next = new Set(current);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }

  async function openKeyDetail(entry: RedisKeyEntry) {
    if (!connectionId) return;
    setContextMenu(null);
    setKeyDetail(null);
    setKeyDetailError(null);
    setIsKeyDetailLoading(true);
    try {
      const response = await callBackend<RedisKeyValueResponse>("get_redis_key_value", {
        request: {
          connection_id: connectionId,
          database,
          key: entry.key,
          limit: DEFAULT_VALUE_LIMIT,
          max_string_bytes: DEFAULT_MAX_STRING_BYTES,
        },
      });
      applyKeyDetail(response);
    } catch (caught) {
      setKeyDetailError(caught instanceof Error ? caught.message : String(caught));
      applyKeyDetail({
        key: entry.key,
        key_type: entry.key_type,
        ttl: entry.ttl,
        value: {
          kind: "none",
          value: null,
          truncated: false,
          size: 0,
        },
      });
    } finally {
      setIsKeyDetailLoading(false);
    }
  }

  function openKeyContextMenu(event: React.MouseEvent, entry: RedisKeyEntry) {
    event.preventDefault();
    event.stopPropagation();
    setContextMenu({
      x: event.clientX,
      y: event.clientY,
      items: [
        {
          label: t("redis.edit"),
          onSelect: () => void openKeyDetail(entry),
        },
        {
          label: t("redis.delete"),
          onSelect: () => setDeleteCandidate(entry),
        },
      ],
    });
  }

  function applyKeyDetail(detail: RedisKeyValueResponse) {
    setKeyDetail(detail);
    setStringDraft(detail.value.kind === "string" ? detail.value.value : "");
    setTtlDraft(detail.ttl > 0 ? String(detail.ttl) : "");
  }

  async function reloadKeyDetail() {
    if (!connectionId || !keyDetail) return;
    const response = await callBackend<RedisKeyValueResponse>("get_redis_key_value", {
      request: {
        connection_id: connectionId,
        database,
        key: keyDetail.key,
        limit: DEFAULT_VALUE_LIMIT,
        max_string_bytes: DEFAULT_MAX_STRING_BYTES,
      },
    });
    applyKeyDetail(response);
  }

  async function saveStringValue() {
    if (!connectionId || !keyDetail || keyDetail.value.kind !== "string") return;
    setIsKeyActionRunning(true);
    setKeyDetailError(null);
    try {
      await callBackend("set_redis_string_value", {
        request: {
          connection_id: connectionId,
          database,
          key: keyDetail.key,
          value: stringDraft,
        },
      });
      await reloadKeyDetail();
    } catch (caught) {
      setKeyDetailError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setIsKeyActionRunning(false);
    }
  }

  async function setKeyTtl() {
    if (!connectionId || !keyDetail) return;
    const ttlSeconds = Number(ttlDraft);
    if (!Number.isInteger(ttlSeconds) || ttlSeconds <= 0) {
      setKeyDetailError(t("redis.ttl_invalid"));
      return;
    }

    setIsKeyActionRunning(true);
    setKeyDetailError(null);
    try {
      await callBackend("set_redis_key_ttl", {
        request: {
          connection_id: connectionId,
          database,
          key: keyDetail.key,
          ttl_seconds: ttlSeconds,
        },
      });
      await reloadKeyDetail();
    } catch (caught) {
      setKeyDetailError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setIsKeyActionRunning(false);
    }
  }

  async function persistKey() {
    if (!connectionId || !keyDetail) return;
    setIsKeyActionRunning(true);
    setKeyDetailError(null);
    try {
      await callBackend("persist_redis_key", {
        request: {
          connection_id: connectionId,
          database,
          key: keyDetail.key,
        },
      });
      await reloadKeyDetail();
    } catch (caught) {
      setKeyDetailError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setIsKeyActionRunning(false);
    }
  }

  async function confirmDeleteKey() {
    if (!connectionId || !deleteCandidate) return;
    const deletingKey = deleteCandidate.key;
    setIsKeyActionRunning(true);
    setKeyDetailError(null);
    try {
      await callBackend("delete_redis_key", {
        request: {
          connection_id: connectionId,
          database,
          key: deletingKey,
        },
      });
      setDeleteCandidate(null);
      if (keyDetail?.key === deletingKey) {
        setKeyDetail(null);
      }
      await loadKeys();
    } catch (caught) {
      setKeyDetailError(caught instanceof Error ? caught.message : String(caught));
      setDeleteCandidate(null);
    } finally {
      setIsKeyActionRunning(false);
    }
  }

  return (
    <section className="redis-workspace">
      <header>
        <label className="redis-toolbar__database">
          <span>{t("redis.database")}</span>
          <input
            aria-label={t("redis.database")}
            type="number"
            min={0}
            value={database}
            onChange={(event) => setDatabase(Number(event.target.value))}
          />
        </label>
        <label className="redis-toolbar__separator">
          <span>{t("redis.key_separator")}</span>
          <input
            aria-label={t("redis.key_separator")}
            value={keySeparator}
            onChange={(event) => {
              setExpandedFolders(new Set());
              setKeySeparator(event.target.value);
            }}
          />
        </label>
        <span className="redis-toolbar__count">{t("redis.loaded_total", { total: totalCount, loaded: keys.length })}</span>
        <label className="redis-toolbar__limit">
          <span>{t("redis.max_load_prefix")}</span>
          <input
            aria-label={t("redis.load_limit")}
            type="number"
            min={1}
            value={loadLimit}
            onChange={(event) => setLoadLimit(Number(event.target.value))}
          />
          <span>{t("redis.load_limit_suffix")}</span>
        </label>
        <label className="redis-toolbar__keyword">
          <input
            aria-label={t("redis.keyword")}
            placeholder={t("redis.keyword")}
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
          />
        </label>
        <button type="button" onClick={() => void loadKeys()}>
          {t("redis.refresh")}
        </button>
      </header>
      {error ? <p role="alert">{error}</p> : null}
      {isLoading ? <p role="status">{t("redis.loading")}</p> : null}
      <div className="redis-table-scroll" aria-label={t("redis.key_list")}>
        <table>
          <thead>
            <tr>
              <th>{t("redis.key")}</th>
              <th>{t("redis.type")}</th>
              <th>{t("redis.ttl")}</th>
            </tr>
          </thead>
          <tbody>
            {treeRows.map((row) => (
              <Fragment key={row.id}>
                {row.kind === "folder" ? (
                  <tr className="redis-folder-row">
                    <td>
                      <button
                        type="button"
                        className="redis-folder-button"
                        style={{ paddingLeft: `${row.depth * 18}px` }}
                        aria-expanded={expandedFolders.has(row.path)}
                        aria-label={
                          expandedFolders.has(row.path)
                            ? t("redis.collapse_folder", { name: row.path })
                            : t("redis.expand_folder", { name: row.path })
                        }
                        onClick={() => toggleFolder(row.path)}
                      >
                        <span aria-hidden="true">{expandedFolders.has(row.path) ? "v" : ">"}</span>
                        <span>{row.name}</span>
                      </button>
                    </td>
                    <td>{t("redis.folder")}</td>
                    <td />
                  </tr>
                ) : (
                  <tr
                    onDoubleClick={() => void openKeyDetail(row.entry)}
                    onContextMenu={(event) => openKeyContextMenu(event, row.entry)}
                  >
                    <td>
                      <span className="redis-key-name" style={{ paddingLeft: `${row.depth * 18}px` }}>
                        {row.entry.key}
                      </span>
                    </td>
                    <td>{row.entry.key_type}</td>
                    <td>{formatTtl(row.entry.ttl, t("redis.ttl_never"))}</td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
        {!isLoading && !error && keys.length === 0 ? (
          <p className="redis-empty">{t("redis.empty")}</p>
        ) : null}
      </div>
      {isKeyDetailLoading || keyDetail ? (
        <div className="connection-dialog__backdrop">
          <section
            className="connection-dialog redis-key-dialog"
            role="dialog"
            aria-modal="true"
            aria-label={t("redis.view_key", { key: keyDetail?.key ?? "" })}
          >
            <header className="connection-dialog__header">
              <h2>{t("redis.view_key", { key: keyDetail?.key ?? "" })}</h2>
              <button type="button" aria-label={t("redis.close_key_detail")} onClick={() => setKeyDetail(null)}>
                x
              </button>
            </header>
            <div className="redis-key-dialog__body">
              {isKeyDetailLoading ? <p role="status">{t("redis.loading_key_detail")}</p> : null}
              {keyDetailError ? <p role="alert">{keyDetailError}</p> : null}
              {keyDetail ? (
                <>
                  <div className="redis-key-dialog__meta">
                    <span>{t("redis.key")} {keyDetail.key}</span>
                    <span>{t("redis.type")} {keyDetail.key_type}</span>
                    <span>{t("redis.ttl")} {formatTtl(keyDetail.ttl, t("redis.ttl_never"))}</span>
                    {keyDetail.value.kind === "string" ? (
                      <span>{t("redis.size")} {formatBytes(keyDetail.value.size)}</span>
                    ) : keyDetail.value.kind !== "none" ? (
                      <span>{t("redis.length")} {keyDetail.value.length}</span>
                    ) : null}
                  </div>
                  <div className="redis-key-dialog__ttl-editor">
                    <label>
                      <span>{t("redis.ttl_seconds")}</span>
                      <input
                        aria-label={t("redis.ttl_seconds")}
                        type="number"
                        min={1}
                        value={ttlDraft}
                        onChange={(event) => setTtlDraft(event.target.value)}
                      />
                    </label>
                    <button type="button" disabled={isKeyActionRunning} onClick={() => void setKeyTtl()}>
                      {t("redis.set_ttl")}
                    </button>
                    <button type="button" disabled={isKeyActionRunning} onClick={() => void persistKey()}>
                      {t("redis.remove_ttl")}
                    </button>
                  </div>
                  {renderKeyDetailValue(keyDetail, t, stringDraft, setStringDraft)}
                  <div className="redis-key-dialog__actions">
                    {keyDetail.value.kind === "string" ? (
                      <button type="button" disabled={isKeyActionRunning} onClick={() => void saveStringValue()}>
                        {t("redis.save_value")}
                      </button>
                    ) : (
                      <span>{t("redis.edit_only_string")}</span>
                    )}
                    <button
                      type="button"
                      className="sftp-dialog__danger-button"
                      disabled={isKeyActionRunning}
                      onClick={() => setDeleteCandidate({
                        key: keyDetail.key,
                        key_type: keyDetail.key_type,
                        ttl: keyDetail.ttl,
                      })}
                    >
                      {t("redis.delete_key")}
                    </button>
                  </div>
                </>
              ) : null}
            </div>
          </section>
        </div>
      ) : null}
      {deleteCandidate ? (
        <div className="connection-dialog__backdrop">
          <section
            className="connection-dialog sftp-dialog"
            role="dialog"
            aria-modal="true"
            aria-label={t("redis.confirm_delete")}
          >
            <form className="connection-form" onSubmit={(event) => {
              event.preventDefault();
              void confirmDeleteKey();
            }}>
              <header className="connection-dialog__header">
                <h2>{t("redis.confirm_delete")}</h2>
                <button type="button" aria-label={t("redis.cancel")} onClick={() => setDeleteCandidate(null)}>
                  x
                </button>
              </header>
              <p>{t("redis.delete_confirm_message", { key: deleteCandidate.key })}</p>
              <div className="sftp-dialog__actions">
                <button type="button" onClick={() => setDeleteCandidate(null)}>
                  {t("redis.cancel")}
                </button>
                <button type="submit" className="sftp-dialog__danger-button" disabled={isKeyActionRunning}>
                  {t("redis.confirm")}
                </button>
              </div>
            </form>
          </section>
        </div>
      ) : null}
      <ContextMenu menu={contextMenu} onClose={() => setContextMenu(null)} />
    </section>
  );
}

function renderKeyDetailValue(
  detail: RedisKeyValueResponse,
  t: ReturnType<typeof useI18n>["t"],
  stringDraft: string,
  setStringDraft: (value: string) => void,
) {
  const value = detail.value;
  if (value.kind === "string") {
    return (
      <>
        {value.truncated ? <p className="redis-key-dialog__hint">{t("redis.value_truncated")}</p> : null}
        <textarea
          className="redis-key-dialog__textarea"
          aria-label={t("redis.string_content")}
          value={stringDraft}
          onChange={(event) => setStringDraft(event.target.value)}
        />
      </>
    );
  }
  if (value.kind === "hash") {
    return (
      <>
        {value.truncated ? <p className="redis-key-dialog__hint">{t("redis.value_truncated")}</p> : null}
        <table className="redis-key-dialog__table">
          <tbody>
            {value.entries.map(([field, fieldValue]) => (
              <tr key={field}>
                <th>{field}</th>
                <td>{fieldValue}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </>
    );
  }
  if (value.kind === "list") {
    return (
      <>
        {value.truncated ? <p className="redis-key-dialog__hint">{t("redis.value_truncated")}</p> : null}
        <ol className="redis-key-dialog__list">
          {value.items.map((item, index) => (
            <li key={`${index}:${item}`}>{item}</li>
          ))}
        </ol>
      </>
    );
  }
  if (value.kind === "set") {
    return (
      <>
        {value.truncated ? <p className="redis-key-dialog__hint">{t("redis.value_truncated")}</p> : null}
        <ul className="redis-key-dialog__list">
          {value.members.map((member) => (
            <li key={member}>{member}</li>
          ))}
        </ul>
      </>
    );
  }
  if (value.kind === "zset") {
    return (
      <>
        {value.truncated ? <p className="redis-key-dialog__hint">{t("redis.value_truncated")}</p> : null}
        <table className="redis-key-dialog__table">
          <tbody>
            {value.entries.map(([member, score]) => (
              <tr key={member}>
                <th>{member}</th>
                <td>{score}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </>
    );
  }
  return <p className="redis-key-dialog__hint">{t("redis.key_missing")}</p>;
}
