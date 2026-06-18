import { Fragment, useEffect, useMemo, useState } from "react";
import { useI18n } from "../../i18n/useI18n";
import { callBackend } from "../../lib/tauri";
import type { RedisKeyEntry, RedisKeyListResponse } from "./redisTypes";

interface RedisWorkspaceProps {
  connectionId: string | null;
  initialDatabase?: number;
}

const DEFAULT_LOAD_LIMIT = 5000;
const DEFAULT_KEY_SEPARATOR = ":";

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
                  <tr>
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
    </section>
  );
}
