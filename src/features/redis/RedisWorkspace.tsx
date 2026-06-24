import { Fragment, useEffect, useMemo, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { ContextMenu, type ContextMenuState } from "../../app/ContextMenu";
import { AppIcon } from "../../app/AppIcon";
import AddIcon from "../../assets/icons/material-symbols--add-rounded.svg?react";
import CollapseIcon from "../../assets/icons/material-symbols--chevron-right-rounded.svg?react";
import ExpandIcon from "../../assets/icons/material-symbols--keyboard-arrow-down-rounded.svg?react";
import RefreshIcon from "../../assets/icons/solar--refresh-bold.svg?react";
import { useI18n } from "../../i18n/useI18n";
import { logFrontendError } from "../../lib/appLogging";
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
const REDIS_ROW_HEIGHT = 30;
const REDIS_OVERSCAN_ROWS = 8;
const REDIS_DEFAULT_VISIBLE_ROWS = 32;

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
type CreateRedisKeyType = "string" | "hash" | "list" | "set" | "zset";

interface RedisTreeFolder {
  name: string;
  path: string;
  children: Map<string, RedisTreeFolder>;
  keys: RedisKeyEntry[];
}

interface CreateRedisKeyDraft {
  key: string;
  keyType: CreateRedisKeyType;
  ttlSeconds: string;
  stringValue: string;
  hashEntries: Array<{ field: string; value: string }>;
  listItems: string[];
  setMembers: string[];
  zsetEntries: Array<{ member: string; score: string }>;
}

const DEFAULT_CREATE_KEY_DRAFT: CreateRedisKeyDraft = {
  key: "",
  keyType: "string",
  ttlSeconds: "",
  stringValue: "",
  hashEntries: [{ field: "", value: "" }],
  listItems: [""],
  setMembers: [""],
  zsetEntries: [{ member: "", score: "0" }],
};

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

function keyFolderPath(key: string, separator: string) {
  const normalizedSeparator = separator.trim();
  if (!normalizedSeparator) return "";
  const parts = key.split(normalizedSeparator).filter(Boolean);
  if (parts.length <= 1) return "";
  return parts.slice(0, -1).join("/");
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

function buildFolderKeyIndex(keys: RedisKeyEntry[], separator: string) {
  const folderKeys = new Map<string, string[]>();
  for (const entry of keys) {
    const folderPath = keyFolderPath(entry.key, separator);
    if (!folderPath) continue;
    const folders = folderPath.split("/");
    for (let index = 0; index < folders.length; index += 1) {
      const path = folders.slice(0, index + 1).join("/");
      const current = folderKeys.get(path);
      if (current) {
        current.push(entry.key);
      } else {
        folderKeys.set(path, [entry.key]);
      }
    }
  }
  return folderKeys;
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
  const [hashDrafts, setHashDrafts] = useState<Record<string, string>>({});
  const [newHashField, setNewHashField] = useState("");
  const [newHashValue, setNewHashValue] = useState("");
  const [listDrafts, setListDrafts] = useState<string[]>([]);
  const [newListItem, setNewListItem] = useState("");
  const [newSetMember, setNewSetMember] = useState("");
  const [zsetDrafts, setZsetDrafts] = useState<Record<string, string>>({});
  const [newZsetMember, setNewZsetMember] = useState("");
  const [newZsetScore, setNewZsetScore] = useState("");
  const [isKeyActionRunning, setIsKeyActionRunning] = useState(false);
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [deleteCandidate, setDeleteCandidate] = useState<RedisKeyEntry | null>(null);
  const [bulkDeleteCandidate, setBulkDeleteCandidate] = useState<string[] | null>(null);
  const [isBulkTtlDialogOpen, setIsBulkTtlDialogOpen] = useState(false);
  const [bulkTtlDraft, setBulkTtlDraft] = useState("");
  const [renameCandidate, setRenameCandidate] = useState<RedisKeyEntry | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [createDraft, setCreateDraft] = useState<CreateRedisKeyDraft>(DEFAULT_CREATE_KEY_DRAFT);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [tableScrollTop, setTableScrollTop] = useState(0);
  const [tableViewportHeight, setTableViewportHeight] = useState(0);
  const selectedKeySet = useMemo(() => new Set(selectedKeys), [selectedKeys]);
  const folderKeyIndex = useMemo(() => buildFolderKeyIndex(keys, keySeparator), [keys, keySeparator]);
  const treeRows = useMemo(
    () => buildRedisTreeRows(keys, keySeparator, expandedFolders),
    [keys, keySeparator, expandedFolders],
  );
  const visibleTreeRange = useMemo(() => {
    if (tableViewportHeight <= 0) {
      return {
        start: 0,
        end: Math.min(treeRows.length, REDIS_DEFAULT_VISIBLE_ROWS + REDIS_OVERSCAN_ROWS),
      };
    }
    const start = Math.max(0, Math.floor(tableScrollTop / REDIS_ROW_HEIGHT) - REDIS_OVERSCAN_ROWS);
    const visibleCount = Math.ceil(tableViewportHeight / REDIS_ROW_HEIGHT) + REDIS_OVERSCAN_ROWS * 2;
    return {
      start,
      end: Math.min(treeRows.length, start + visibleCount),
    };
  }, [tableScrollTop, tableViewportHeight, treeRows.length]);
  const visibleTreeRows = treeRows.slice(visibleTreeRange.start, visibleTreeRange.end);
  const topSpacerHeight = visibleTreeRange.start * REDIS_ROW_HEIGHT;
  const bottomSpacerHeight = Math.max(0, (treeRows.length - visibleTreeRange.end) * REDIS_ROW_HEIGHT);

  function redisTarget(key?: string) {
    return `${connectionId}:db${database}${key ? `:${key}` : ""}`;
  }

  function logRedisError(
    action: string,
    caught: unknown,
    key?: string,
    metadata: Record<string, string | number | boolean | null> = {},
  ) {
    if (!connectionId) return;
    void logFrontendError("frontend.redis", action, caught, redisTarget(key), {
      database,
      ...metadata,
    });
  }

  async function loadKeys(nextDatabase = database, nextKeyword = keyword, nextLoadLimit = loadLimit) {
    if (!connectionId) return;
    setIsLoading(true);
    try {
      const entries: RedisKeyEntry[] = [];
      const pattern = keywordToPattern(nextKeyword);
      let nextCursor = 0;
      let total = 0;

      do {
        const response = await callBackend<RedisKeyListResponse>("list_redis_keys", {
          request: {
            connection_id: connectionId,
            database: nextDatabase,
            pattern,
            count: nextLoadLimit - entries.length,
            cursor: nextCursor,
          },
        });
        total = response.total_count;
        entries.push(...response.entries);
        nextCursor = response.next_cursor ?? 0;
      } while (nextCursor !== 0 && entries.length < nextLoadLimit);

      setTotalCount(total);
      setKeys(entries);
      setSelectedKeys((current) => {
        const loadedKeys = new Set(entries.map((entry) => entry.key));
        return current.filter((key) => loadedKeys.has(key));
      });
      setTableScrollTop(0);
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
      logRedisError("list_redis_keys", caught, undefined, {
        database: nextDatabase,
        count: nextLoadLimit,
      });
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
    setSelectedKeys([]);
    void loadKeys(initialDatabase, "", DEFAULT_LOAD_LIMIT);
  }, [connectionId, initialDatabase]);

  useEffect(() => {
    if (
      !keyDetail
      && !deleteCandidate
      && !bulkDeleteCandidate
      && !isBulkTtlDialogOpen
      && !renameCandidate
      && !isCreateDialogOpen
    ) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      if (isCreateDialogOpen) {
        setIsCreateDialogOpen(false);
        return;
      }
      if (renameCandidate) {
        setRenameCandidate(null);
        return;
      }
      if (isBulkTtlDialogOpen) {
        setIsBulkTtlDialogOpen(false);
        return;
      }
      if (bulkDeleteCandidate) {
        setBulkDeleteCandidate(null);
        return;
      }
      if (deleteCandidate) {
        setDeleteCandidate(null);
        return;
      }
      setKeyDetail(null);
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [keyDetail, deleteCandidate, bulkDeleteCandidate, isBulkTtlDialogOpen, renameCandidate, isCreateDialogOpen]);

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

  function toggleSelectedKey(key: string) {
    setSelectedKeys((current) => {
      const currentSet = new Set(current);
      return currentSet.has(key)
        ? current.filter((selectedKey) => selectedKey !== key)
        : [...current, key];
    });
  }

  function folderKeys(path: string) {
    return folderKeyIndex.get(path) ?? [];
  }

  function toggleSelectedFolder(path: string) {
    const keysInFolder = folderKeys(path);
    if (keysInFolder.length === 0) return;
    setSelectedKeys((current) => {
      const selectedSet = new Set(current);
      const isFullySelected = keysInFolder.every((key) => selectedSet.has(key));
      for (const key of keysInFolder) {
        if (isFullySelected) {
          selectedSet.delete(key);
        } else {
          selectedSet.add(key);
        }
      }
      return keys.filter((entry) => selectedSet.has(entry.key)).map((entry) => entry.key);
    });
  }

  function selectedKeysForAction(entry: RedisKeyEntry) {
    return selectedKeySet.has(entry.key) ? selectedKeys : [entry.key];
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
      logRedisError("get_redis_key_value", caught, entry.key);
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
    const actionKeys = selectedKeysForAction(entry);
    setContextMenu({
      x: event.clientX,
      y: event.clientY,
      items: [
        {
          label: t("redis.edit"),
          onSelect: () => void openKeyDetail(entry),
        },
        {
          label: t("redis.rename"),
          onSelect: () => openRenameDialog(entry),
        },
        {
          label: t("redis.delete"),
          onSelect: () => setDeleteCandidate(entry),
        },
        {
          label: t("redis.bulk_delete"),
          onSelect: () => setBulkDeleteCandidate(actionKeys),
        },
        {
          label: t("redis.bulk_set_ttl"),
          onSelect: () => {
            setBulkTtlDraft("");
            setSelectedKeys(actionKeys);
            setIsBulkTtlDialogOpen(true);
          },
        },
        {
          label: t("redis.bulk_remove_ttl"),
          onSelect: () => void persistSelectedKeys(actionKeys),
        },
      ],
    });
  }

  function openRenameDialog(entry: RedisKeyEntry) {
    setRenameCandidate(entry);
    setRenameDraft(entry.key);
  }

  function openCreateDialog() {
    setCreateDraft(DEFAULT_CREATE_KEY_DRAFT);
    setKeyDetailError(null);
    setIsCreateDialogOpen(true);
  }

  function applyKeyDetail(detail: RedisKeyValueResponse) {
    setKeyDetail(detail);
    setStringDraft(detail.value.kind === "string" ? detail.value.value : "");
    setHashDrafts(detail.value.kind === "hash"
      ? Object.fromEntries(detail.value.entries)
      : {});
    setNewHashField("");
    setNewHashValue("");
    setListDrafts(detail.value.kind === "list" ? detail.value.items : []);
    setNewListItem("");
    setNewSetMember("");
    setZsetDrafts(detail.value.kind === "zset"
      ? Object.fromEntries(detail.value.entries.map(([member, score]) => [member, String(score)]))
      : {});
    setNewZsetMember("");
    setNewZsetScore("0");
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
      logRedisError("set_redis_string_value", caught, keyDetail.key);
    } finally {
      setIsKeyActionRunning(false);
    }
  }

  async function runKeyDetailAction(actionName: string, key: string, action: () => Promise<void>) {
    setIsKeyActionRunning(true);
    setKeyDetailError(null);
    try {
      await action();
      await reloadKeyDetail();
    } catch (caught) {
      setKeyDetailError(caught instanceof Error ? caught.message : String(caught));
      logRedisError(actionName, caught, key);
    } finally {
      setIsKeyActionRunning(false);
    }
  }

  async function saveHashField(field: string) {
    if (!connectionId || !keyDetail || keyDetail.value.kind !== "hash") return;
    const value = hashDrafts[field] ?? "";
    await runKeyDetailAction("set_redis_hash_field", keyDetail.key, async () => {
      await callBackend("set_redis_hash_field", {
        request: {
          connection_id: connectionId,
          database,
          key: keyDetail.key,
          field,
          value,
        },
      });
    });
  }

  async function addHashField() {
    if (!connectionId || !keyDetail || keyDetail.value.kind !== "hash") return;
    const field = newHashField.trim();
    if (!field) {
      setKeyDetailError(t("redis.hash_field_required"));
      return;
    }
    await runKeyDetailAction("set_redis_hash_field", keyDetail.key, async () => {
      await callBackend("set_redis_hash_field", {
        request: {
          connection_id: connectionId,
          database,
          key: keyDetail.key,
          field,
          value: newHashValue,
        },
      });
    });
  }

  async function deleteHashField(field: string) {
    if (!connectionId || !keyDetail || keyDetail.value.kind !== "hash") return;
    await runKeyDetailAction("delete_redis_hash_field", keyDetail.key, async () => {
      await callBackend("delete_redis_hash_field", {
        request: {
          connection_id: connectionId,
          database,
          key: keyDetail.key,
          field,
        },
      });
    });
  }

  async function saveListItem(index: number) {
    if (!connectionId || !keyDetail || keyDetail.value.kind !== "list") return;
    await runKeyDetailAction("set_redis_list_item", keyDetail.key, async () => {
      await callBackend("set_redis_list_item", {
        request: {
          connection_id: connectionId,
          database,
          key: keyDetail.key,
          index,
          value: listDrafts[index] ?? "",
        },
      });
    });
  }

  async function appendListItem() {
    if (!connectionId || !keyDetail || keyDetail.value.kind !== "list") return;
    await runKeyDetailAction("append_redis_list_item", keyDetail.key, async () => {
      await callBackend("append_redis_list_item", {
        request: {
          connection_id: connectionId,
          database,
          key: keyDetail.key,
          value: newListItem,
        },
      });
    });
  }

  async function deleteListItem(index: number) {
    if (!connectionId || !keyDetail || keyDetail.value.kind !== "list") return;
    await runKeyDetailAction("delete_redis_list_item", keyDetail.key, async () => {
      await callBackend("delete_redis_list_item", {
        request: {
          connection_id: connectionId,
          database,
          key: keyDetail.key,
          index,
        },
      });
    });
  }

  async function addSetMember() {
    if (!connectionId || !keyDetail || keyDetail.value.kind !== "set") return;
    const member = newSetMember.trim();
    if (!member) {
      setKeyDetailError(t("redis.member_required"));
      return;
    }
    await runKeyDetailAction("add_redis_set_member", keyDetail.key, async () => {
      await callBackend("add_redis_set_member", {
        request: {
          connection_id: connectionId,
          database,
          key: keyDetail.key,
          member,
        },
      });
    });
  }

  async function deleteSetMember(member: string) {
    if (!connectionId || !keyDetail || keyDetail.value.kind !== "set") return;
    await runKeyDetailAction("delete_redis_set_member", keyDetail.key, async () => {
      await callBackend("delete_redis_set_member", {
        request: {
          connection_id: connectionId,
          database,
          key: keyDetail.key,
          member,
        },
      });
    });
  }

  async function saveZsetMember(member: string) {
    if (!connectionId || !keyDetail || keyDetail.value.kind !== "zset") return;
    await runKeyDetailAction("set_redis_zset_member", keyDetail.key, async () => {
      await callBackend("set_redis_zset_member", {
        request: {
          connection_id: connectionId,
          database,
          key: keyDetail.key,
          member,
          score: zsetDrafts[member] ?? "0",
        },
      });
    });
  }

  async function addZsetMember() {
    if (!connectionId || !keyDetail || keyDetail.value.kind !== "zset") return;
    const member = newZsetMember.trim();
    if (!member) {
      setKeyDetailError(t("redis.member_required"));
      return;
    }
    await runKeyDetailAction("set_redis_zset_member", keyDetail.key, async () => {
      await callBackend("set_redis_zset_member", {
        request: {
          connection_id: connectionId,
          database,
          key: keyDetail.key,
          member,
          score: newZsetScore,
        },
      });
    });
  }

  async function deleteZsetMember(member: string) {
    if (!connectionId || !keyDetail || keyDetail.value.kind !== "zset") return;
    await runKeyDetailAction("delete_redis_zset_member", keyDetail.key, async () => {
      await callBackend("delete_redis_zset_member", {
        request: {
          connection_id: connectionId,
          database,
          key: keyDetail.key,
          member,
        },
      });
    });
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
      logRedisError("set_redis_key_ttl", caught, keyDetail.key, { ttl_seconds: ttlSeconds });
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
      logRedisError("persist_redis_key", caught, keyDetail.key);
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
      logRedisError("delete_redis_key", caught, deletingKey);
      setDeleteCandidate(null);
    } finally {
      setIsKeyActionRunning(false);
    }
  }

  async function confirmBulkDeleteKeys() {
    if (!connectionId || !bulkDeleteCandidate) return;
    const deletingKeys = bulkDeleteCandidate;
    setIsKeyActionRunning(true);
    setKeyDetailError(null);
    try {
      await callBackend("delete_redis_keys", {
        request: {
          connection_id: connectionId,
          database,
          keys: deletingKeys,
        },
      });
      setBulkDeleteCandidate(null);
      setSelectedKeys([]);
      if (keyDetail && deletingKeys.includes(keyDetail.key)) {
        setKeyDetail(null);
      }
      await loadKeys();
    } catch (caught) {
      setKeyDetailError(caught instanceof Error ? caught.message : String(caught));
      logRedisError("delete_redis_keys", caught, undefined, { count: deletingKeys.length });
      setBulkDeleteCandidate(null);
    } finally {
      setIsKeyActionRunning(false);
    }
  }

  async function confirmSetBulkTtl(event: React.FormEvent) {
    event.preventDefault();
    if (!connectionId || selectedKeys.length === 0) return;
    const ttlSeconds = Number(bulkTtlDraft);
    if (!Number.isInteger(ttlSeconds) || ttlSeconds <= 0) {
      setKeyDetailError(t("redis.ttl_invalid"));
      return;
    }

    setIsKeyActionRunning(true);
    setKeyDetailError(null);
    try {
      await callBackend("set_redis_keys_ttl", {
        request: {
          connection_id: connectionId,
          database,
          keys: selectedKeys,
          ttl_seconds: ttlSeconds,
        },
      });
      setIsBulkTtlDialogOpen(false);
      await loadKeys();
      if (keyDetail && selectedKeys.includes(keyDetail.key)) {
        await reloadKeyDetail();
      }
    } catch (caught) {
      setKeyDetailError(caught instanceof Error ? caught.message : String(caught));
      logRedisError("set_redis_keys_ttl", caught, undefined, {
        count: selectedKeys.length,
        ttl_seconds: ttlSeconds,
      });
    } finally {
      setIsKeyActionRunning(false);
    }
  }

  async function persistSelectedKeys(keysToPersist: string[]) {
    if (!connectionId || keysToPersist.length === 0) return;
    setIsKeyActionRunning(true);
    setKeyDetailError(null);
    try {
      await callBackend("persist_redis_keys", {
        request: {
          connection_id: connectionId,
          database,
          keys: keysToPersist,
        },
      });
      await loadKeys();
      if (keyDetail && keysToPersist.includes(keyDetail.key)) {
        await reloadKeyDetail();
      }
    } catch (caught) {
      setKeyDetailError(caught instanceof Error ? caught.message : String(caught));
      logRedisError("persist_redis_keys", caught, undefined, { count: keysToPersist.length });
    } finally {
      setIsKeyActionRunning(false);
    }
  }

  async function confirmRenameKey(event: React.FormEvent) {
    event.preventDefault();
    if (!connectionId || !renameCandidate) return;
    const source = renameCandidate;
    const newKey = renameDraft.trim();
    if (!newKey) {
      setKeyDetailError(t("redis.rename_key_required"));
      return;
    }

    setIsKeyActionRunning(true);
    setKeyDetailError(null);
    try {
      await callBackend("rename_redis_key", {
        request: {
          connection_id: connectionId,
          database,
          key: source.key,
          new_key: newKey,
        },
      });
      setRenameCandidate(null);
      await loadKeys();
      await openKeyDetail({
        key: newKey,
        key_type: source.key_type,
        ttl: source.ttl,
      });
    } catch (caught) {
      setKeyDetailError(caught instanceof Error ? caught.message : String(caught));
      logRedisError("rename_redis_key", caught, source.key);
    } finally {
      setIsKeyActionRunning(false);
    }
  }

  async function confirmCreateKey(event: React.FormEvent) {
    event.preventDefault();
    if (!connectionId) return;
    const key = createDraft.key.trim();
    if (!key) {
      setKeyDetailError(t("redis.key_required"));
      return;
    }
    const ttlSeconds = createDraft.ttlSeconds.trim() ? Number(createDraft.ttlSeconds) : null;
    if (ttlSeconds !== null && (!Number.isInteger(ttlSeconds) || ttlSeconds <= 0)) {
      setKeyDetailError(t("redis.ttl_invalid"));
      return;
    }

    setIsKeyActionRunning(true);
    setKeyDetailError(null);
    try {
      await callBackend("create_redis_key", {
        request: {
          connection_id: connectionId,
          database,
          key,
          key_type: createDraft.keyType,
          ttl_seconds: ttlSeconds,
          string_value: createDraft.stringValue,
          hash_entries: createDraft.hashEntries,
          list_items: createDraft.listItems,
          set_members: createDraft.setMembers,
          zset_entries: createDraft.zsetEntries,
        },
      });
      setIsCreateDialogOpen(false);
      await loadKeys();
    } catch (caught) {
      setKeyDetailError(caught instanceof Error ? caught.message : String(caught));
      logRedisError("create_redis_key", caught, key, { key_type: createDraft.keyType });
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
        <button
          type="button"
          className="workspace-icon-button"
          aria-label={t("redis.create_key")}
          title={t("redis.create_key")}
          onClick={openCreateDialog}
        >
          <AppIcon icon={AddIcon} decorative />
        </button>
        <label className="redis-toolbar__keyword">
          <input
            aria-label={t("redis.keyword")}
            placeholder={t("redis.keyword")}
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                void loadKeys();
              }
            }}
          />
        </label>
        <button
          type="button"
          className="workspace-icon-button"
          aria-label={t("redis.refresh")}
          title={t("redis.refresh")}
          onClick={() => void loadKeys()}
        >
          <AppIcon icon={RefreshIcon} decorative />
        </button>
      </header>
      {error ? <p role="alert">{error}</p> : null}
      {isLoading ? <p role="status">{t("redis.loading")}</p> : null}
      <div
        className="redis-table-scroll"
        aria-label={t("redis.key_list")}
        onScroll={(event) => {
          setTableScrollTop(event.currentTarget.scrollTop);
          setTableViewportHeight(event.currentTarget.clientHeight);
        }}
        ref={(element) => {
          if (element && tableViewportHeight !== element.clientHeight) {
            setTableViewportHeight(element.clientHeight);
          }
        }}
      >
        <table>
          <thead>
            <tr>
              <th className="redis-table__selection-cell" aria-label={t("redis.selection")} />
              <th>{t("redis.key")}</th>
              <th>{t("redis.type")}</th>
              <th>{t("redis.ttl")}</th>
            </tr>
          </thead>
          <tbody>
            {topSpacerHeight > 0 ? (
              <tr className="redis-virtual-spacer" aria-hidden="true">
                <td colSpan={4} style={{ height: `${topSpacerHeight}px` }} />
              </tr>
            ) : null}
            {visibleTreeRows.map((row) => (
              <Fragment key={row.id}>
                {row.kind === "folder" ? (
                  <tr className="redis-folder-row">
                    <td className="redis-table__selection-cell">
                      {(() => {
                        const keysInFolder = folderKeys(row.path);
                        const selectedCount = keysInFolder.filter((key) => selectedKeySet.has(key)).length;
                        return (
                          <input
                            type="checkbox"
                            aria-label={t("redis.select_folder", { name: row.path })}
                            checked={keysInFolder.length > 0 && selectedCount === keysInFolder.length}
                            ref={(element) => {
                              if (element) {
                                element.indeterminate = selectedCount > 0 && selectedCount < keysInFolder.length;
                              }
                            }}
                            onChange={() => toggleSelectedFolder(row.path)}
                          />
                        );
                      })()}
                    </td>
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
                        <AppIcon
                          icon={expandedFolders.has(row.path) ? ExpandIcon : CollapseIcon}
                          decorative
                          className="redis-folder-button__icon"
                        />
                        <span>{row.name}</span>
                      </button>
                    </td>
                    <td>{t("redis.folder")}</td>
                    <td />
                  </tr>
                ) : (
                  <tr
                    className={selectedKeySet.has(row.entry.key) ? "redis-key-row--selected" : undefined}
                    onDoubleClick={() => void openKeyDetail(row.entry)}
                    onContextMenu={(event) => openKeyContextMenu(event, row.entry)}
                  >
                    <td className="redis-table__selection-cell">
                      <input
                        type="checkbox"
                        aria-label={t("redis.select_key", { key: row.entry.key })}
                        checked={selectedKeySet.has(row.entry.key)}
                        onChange={() => toggleSelectedKey(row.entry.key)}
                        onDoubleClick={(event) => event.stopPropagation()}
                      />
                    </td>
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
            {bottomSpacerHeight > 0 ? (
              <tr className="redis-virtual-spacer" aria-hidden="true">
                <td colSpan={4} style={{ height: `${bottomSpacerHeight}px` }} />
              </tr>
            ) : null}
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
                  {renderKeyDetailValue({
                    detail: keyDetail,
                    t,
                    stringDraft,
                    setStringDraft,
                    hashDrafts,
                    setHashDrafts,
                    newHashField,
                    setNewHashField,
                    newHashValue,
                    setNewHashValue,
                    listDrafts,
                    setListDrafts,
                    newListItem,
                    setNewListItem,
                    newSetMember,
                    setNewSetMember,
                    zsetDrafts,
                    setZsetDrafts,
                    newZsetMember,
                    setNewZsetMember,
                    newZsetScore,
                    setNewZsetScore,
                    isKeyActionRunning,
                    saveHashField,
                    addHashField,
                    deleteHashField,
                    saveListItem,
                    appendListItem,
                    deleteListItem,
                    addSetMember,
                    deleteSetMember,
                    saveZsetMember,
                    addZsetMember,
                    deleteZsetMember,
                  })}
                  <div className="redis-key-dialog__actions">
                    {keyDetail.value.kind === "string" ? (
                      <button type="button" disabled={isKeyActionRunning} onClick={() => void saveStringValue()}>
                        {t("redis.save_value")}
                      </button>
                    ) : (
                      <span>{t("redis.collection_edit_hint")}</span>
                    )}
                    <div>
                      <button
                        type="button"
                        disabled={isKeyActionRunning}
                        onClick={() => openRenameDialog({
                          key: keyDetail.key,
                          key_type: keyDetail.key_type,
                          ttl: keyDetail.ttl,
                        })}
                      >
                        {t("redis.rename")}
                      </button>
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
      {bulkDeleteCandidate ? (
        <div className="connection-dialog__backdrop">
          <section
            className="connection-dialog sftp-dialog"
            role="dialog"
            aria-modal="true"
            aria-label={t("redis.confirm_bulk_delete")}
          >
            <form className="connection-form" onSubmit={(event) => {
              event.preventDefault();
              void confirmBulkDeleteKeys();
            }}>
              <header className="connection-dialog__header">
                <h2>{t("redis.confirm_bulk_delete")}</h2>
                <button type="button" aria-label={t("redis.cancel")} onClick={() => setBulkDeleteCandidate(null)}>
                  x
                </button>
              </header>
              <p>{t("redis.bulk_delete_confirm_message", { count: bulkDeleteCandidate.length })}</p>
              <div className="sftp-dialog__actions">
                <button type="button" onClick={() => setBulkDeleteCandidate(null)}>
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
      {isBulkTtlDialogOpen ? (
        <div className="connection-dialog__backdrop">
          <section
            className="connection-dialog sftp-dialog"
            role="dialog"
            aria-modal="true"
            aria-label={t("redis.bulk_set_ttl")}
          >
            <form className="connection-form" onSubmit={(event) => void confirmSetBulkTtl(event)}>
              <header className="connection-dialog__header">
                <h2>{t("redis.bulk_set_ttl")}</h2>
                <button type="button" aria-label={t("redis.cancel")} onClick={() => setIsBulkTtlDialogOpen(false)}>
                  x
                </button>
              </header>
              {keyDetailError ? <p role="alert">{keyDetailError}</p> : null}
              <p>{t("redis.selected_count", { count: selectedKeys.length })}</p>
              <label>
                <span>{t("redis.ttl_seconds")}</span>
                <input
                  aria-label={t("redis.ttl_seconds")}
                  type="number"
                  min={1}
                  value={bulkTtlDraft}
                  onChange={(event) => setBulkTtlDraft(event.target.value)}
                />
              </label>
              <div className="sftp-dialog__actions">
                <button type="button" onClick={() => setIsBulkTtlDialogOpen(false)}>
                  {t("redis.cancel")}
                </button>
                <button type="submit" disabled={isKeyActionRunning}>
                  {t("redis.confirm")}
                </button>
              </div>
            </form>
          </section>
        </div>
      ) : null}
      {renameCandidate ? (
        <div className="connection-dialog__backdrop">
          <section
            className="connection-dialog sftp-dialog"
            role="dialog"
            aria-modal="true"
            aria-label={t("redis.rename_key")}
          >
            <form className="connection-form" onSubmit={(event) => void confirmRenameKey(event)}>
              <header className="connection-dialog__header">
                <h2>{t("redis.rename_key")}</h2>
                <button type="button" aria-label={t("redis.cancel")} onClick={() => setRenameCandidate(null)}>
                  x
                </button>
              </header>
              <label>
                <span>{t("redis.new_key")}</span>
                <input
                  aria-label={t("redis.new_key")}
                  value={renameDraft}
                  onChange={(event) => setRenameDraft(event.target.value)}
                />
              </label>
              <div className="sftp-dialog__actions">
                <button type="button" onClick={() => setRenameCandidate(null)}>
                  {t("redis.cancel")}
                </button>
                <button type="submit" disabled={isKeyActionRunning}>
                  {t("redis.confirm")}
                </button>
              </div>
            </form>
          </section>
        </div>
      ) : null}
      {isCreateDialogOpen ? (
        <div className="connection-dialog__backdrop">
          <section
            className="connection-dialog sftp-dialog redis-create-dialog"
            role="dialog"
            aria-modal="true"
            aria-label={t("redis.create_key_dialog")}
          >
            <form className="connection-form" onSubmit={(event) => void confirmCreateKey(event)}>
              <header className="connection-dialog__header">
                <h2>{t("redis.create_key_dialog")}</h2>
                <button type="button" aria-label={t("redis.cancel")} onClick={() => setIsCreateDialogOpen(false)}>
                  x
                </button>
              </header>
              {keyDetailError ? <p role="alert">{keyDetailError}</p> : null}
              <label>
                <span>{t("redis.key_name")}</span>
                <input
                  aria-label={t("redis.key_name")}
                  value={createDraft.key}
                  onChange={(event) => setCreateDraft((draft) => ({ ...draft, key: event.target.value }))}
                />
              </label>
              <label>
                <span>{t("redis.type")}</span>
                <select
                  aria-label={t("redis.type")}
                  value={createDraft.keyType}
                  onChange={(event) => setCreateDraft((draft) => ({
                    ...draft,
                    keyType: event.target.value as CreateRedisKeyType,
                  }))}
                >
                  <option value="string">string</option>
                  <option value="hash">hash</option>
                  <option value="list">list</option>
                  <option value="set">set</option>
                  <option value="zset">zset</option>
                </select>
              </label>
              <label>
                <span>{t("redis.ttl_seconds")}</span>
                <input
                  aria-label={t("redis.ttl_seconds")}
                  type="number"
                  min={1}
                  value={createDraft.ttlSeconds}
                  onChange={(event) => setCreateDraft((draft) => ({ ...draft, ttlSeconds: event.target.value }))}
                />
              </label>
              {renderCreateKeyValueEditor(createDraft, setCreateDraft, t)}
              <div className="sftp-dialog__actions">
                <button type="button" onClick={() => setIsCreateDialogOpen(false)}>
                  {t("redis.cancel")}
                </button>
                <button type="submit" disabled={isKeyActionRunning}>
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

function renderCreateKeyValueEditor(
  draft: CreateRedisKeyDraft,
  setDraft: Dispatch<SetStateAction<CreateRedisKeyDraft>>,
  t: ReturnType<typeof useI18n>["t"],
) {
  if (draft.keyType === "string") {
    return (
      <label>
        <span>{t("redis.string_content")}</span>
        <textarea
          className="redis-create-dialog__textarea"
          aria-label={t("redis.string_content")}
          value={draft.stringValue}
          onChange={(event) => setDraft((current) => ({ ...current, stringValue: event.target.value }))}
        />
      </label>
    );
  }

  if (draft.keyType === "hash") {
    return (
      <div className="redis-create-dialog__rows">
        {draft.hashEntries.map((entry, index) => (
          <div className="redis-create-dialog__row" key={index}>
            <label>
              <input
                aria-label={t("redis.hash_field")}
                placeholder={t("redis.hash_field")}
                value={entry.field}
                onChange={(event) => setDraft((current) => ({
                  ...current,
                  hashEntries: current.hashEntries.map((item, itemIndex) => (
                    itemIndex === index ? { ...item, field: event.target.value } : item
                  )),
                }))}
              />
            </label>
            <label>
              <input
                aria-label={t("redis.hash_value")}
                placeholder={t("redis.hash_value")}
                value={entry.value}
                onChange={(event) => setDraft((current) => ({
                  ...current,
                  hashEntries: current.hashEntries.map((item, itemIndex) => (
                    itemIndex === index ? { ...item, value: event.target.value } : item
                  )),
                }))}
              />
            </label>
            <button
              type="button"
              className="redis-create-dialog__remove-button"
              aria-label={t("redis.remove_entry")}
              onClick={() => setDraft((current) => ({
                ...current,
                hashEntries: current.hashEntries.length > 1
                  ? current.hashEntries.filter((_, itemIndex) => itemIndex !== index)
                  : [{ field: "", value: "" }],
              }))}
            >
              -
            </button>
          </div>
        ))}
        <button
          type="button"
          className="redis-create-dialog__add-button"
          onClick={() => setDraft((current) => ({
            ...current,
            hashEntries: [...current.hashEntries, { field: "", value: "" }],
          }))}
        >
          {t("redis.add_entry")}
        </button>
      </div>
    );
  }

  if (draft.keyType === "zset") {
    return (
      <div className="redis-create-dialog__rows">
        {draft.zsetEntries.map((entry, index) => (
          <div className="redis-create-dialog__row" key={index}>
            <label>
              <input
                aria-label={t("redis.member")}
                placeholder={t("redis.member")}
                value={entry.member}
                onChange={(event) => setDraft((current) => ({
                  ...current,
                  zsetEntries: current.zsetEntries.map((item, itemIndex) => (
                    itemIndex === index ? { ...item, member: event.target.value } : item
                  )),
                }))}
              />
            </label>
            <label>
              <input
                aria-label={t("redis.score")}
                placeholder={t("redis.score")}
                value={entry.score}
                onChange={(event) => setDraft((current) => ({
                  ...current,
                  zsetEntries: current.zsetEntries.map((item, itemIndex) => (
                    itemIndex === index ? { ...item, score: event.target.value } : item
                  )),
                }))}
              />
            </label>
            <button
              type="button"
              className="redis-create-dialog__remove-button"
              aria-label={t("redis.remove_entry")}
              onClick={() => setDraft((current) => ({
                ...current,
                zsetEntries: current.zsetEntries.length > 1
                  ? current.zsetEntries.filter((_, itemIndex) => itemIndex !== index)
                  : [{ member: "", score: "0" }],
              }))}
            >
              -
            </button>
          </div>
        ))}
        <button
          type="button"
          className="redis-create-dialog__add-button"
          onClick={() => setDraft((current) => ({
            ...current,
            zsetEntries: [...current.zsetEntries, { member: "", score: "0" }],
          }))}
        >
          {t("redis.add_entry")}
        </button>
      </div>
    );
  }

  const isList = draft.keyType === "list";
  const label = isList ? t("redis.item") : t("redis.member");
  const items = isList ? draft.listItems : draft.setMembers;
  return (
    <div className="redis-create-dialog__rows">
      {items.map((value, index) => (
        <div className="redis-create-dialog__single-row" key={index}>
          <label>
            <input
              aria-label={label}
              placeholder={label}
              value={value}
              onChange={(event) => setDraft((current) => {
                const currentItems = isList ? current.listItems : current.setMembers;
                const nextItems = currentItems.map((item, itemIndex) => (
                  itemIndex === index ? event.target.value : item
                ));
                return isList
                  ? { ...current, listItems: nextItems }
                  : { ...current, setMembers: nextItems };
              })}
            />
          </label>
          <button
            type="button"
            className="redis-create-dialog__remove-button"
            aria-label={t("redis.remove_entry")}
            onClick={() => setDraft((current) => {
              const currentItems = isList ? current.listItems : current.setMembers;
              const nextItems = currentItems.length > 1
                ? currentItems.filter((_, itemIndex) => itemIndex !== index)
                : [""];
              return isList
                ? { ...current, listItems: nextItems }
                : { ...current, setMembers: nextItems };
            })}
          >
            -
          </button>
        </div>
      ))}
      <button
        type="button"
        className="redis-create-dialog__add-button"
        onClick={() => setDraft((current) => (
          isList
            ? { ...current, listItems: [...current.listItems, ""] }
            : { ...current, setMembers: [...current.setMembers, ""] }
        ))}
      >
        {isList ? t("redis.add_item") : t("redis.add_member")}
      </button>
    </div>
  );
}

interface RenderKeyDetailValueOptions {
  detail: RedisKeyValueResponse;
  t: ReturnType<typeof useI18n>["t"];
  stringDraft: string;
  setStringDraft: (value: string) => void;
  hashDrafts: Record<string, string>;
  setHashDrafts: Dispatch<SetStateAction<Record<string, string>>>;
  newHashField: string;
  setNewHashField: (value: string) => void;
  newHashValue: string;
  setNewHashValue: (value: string) => void;
  listDrafts: string[];
  setListDrafts: Dispatch<SetStateAction<string[]>>;
  newListItem: string;
  setNewListItem: (value: string) => void;
  newSetMember: string;
  setNewSetMember: (value: string) => void;
  zsetDrafts: Record<string, string>;
  setZsetDrafts: Dispatch<SetStateAction<Record<string, string>>>;
  newZsetMember: string;
  setNewZsetMember: (value: string) => void;
  newZsetScore: string;
  setNewZsetScore: (value: string) => void;
  isKeyActionRunning: boolean;
  saveHashField: (field: string) => Promise<void>;
  addHashField: () => Promise<void>;
  deleteHashField: (field: string) => Promise<void>;
  saveListItem: (index: number) => Promise<void>;
  appendListItem: () => Promise<void>;
  deleteListItem: (index: number) => Promise<void>;
  addSetMember: () => Promise<void>;
  deleteSetMember: (member: string) => Promise<void>;
  saveZsetMember: (member: string) => Promise<void>;
  addZsetMember: () => Promise<void>;
  deleteZsetMember: (member: string) => Promise<void>;
}

function renderKeyDetailValue(options: RenderKeyDetailValueOptions) {
  const {
    detail,
    t,
    stringDraft,
    setStringDraft,
    hashDrafts,
    setHashDrafts,
    newHashField,
    setNewHashField,
    newHashValue,
    setNewHashValue,
    listDrafts,
    setListDrafts,
    newListItem,
    setNewListItem,
    newSetMember,
    setNewSetMember,
    zsetDrafts,
    setZsetDrafts,
    newZsetMember,
    setNewZsetMember,
    newZsetScore,
    setNewZsetScore,
    isKeyActionRunning,
    saveHashField,
    addHashField,
    deleteHashField,
    saveListItem,
    appendListItem,
    deleteListItem,
    addSetMember,
    deleteSetMember,
    saveZsetMember,
    addZsetMember,
    deleteZsetMember,
  } = options;
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
        <div className="redis-key-dialog__rows">
          {value.entries.map(([field]) => (
            <div className="redis-key-dialog__edit-row" key={field}>
              <span className="redis-key-dialog__row-key">{field}</span>
              <input
                aria-label={t("redis.hash_field_value_label", { field })}
                value={hashDrafts[field] ?? ""}
                onChange={(event) => setHashDrafts((current) => ({
                  ...current,
                  [field]: event.target.value,
                }))}
              />
              <button
                type="button"
                className="redis-key-dialog__action-button"
                aria-label={t("redis.save_hash_field", { field })}
                disabled={isKeyActionRunning}
                onClick={() => void saveHashField(field)}
              >
                {t("redis.save")}
              </button>
              <button
                type="button"
                className="redis-key-dialog__action-button sftp-dialog__danger-button"
                aria-label={t("redis.delete_hash_field", { field })}
                disabled={isKeyActionRunning}
                onClick={() => void deleteHashField(field)}
              >
                {t("redis.delete")}
              </button>
            </div>
          ))}
          <div className="redis-key-dialog__edit-row">
            <input
              aria-label={t("redis.new_hash_field")}
              placeholder={t("redis.new_hash_field")}
              value={newHashField}
              onChange={(event) => setNewHashField(event.target.value)}
            />
            <input
              aria-label={t("redis.new_hash_value")}
              placeholder={t("redis.new_hash_value")}
              value={newHashValue}
              onChange={(event) => setNewHashValue(event.target.value)}
            />
            <button
              type="button"
              className="redis-key-dialog__action-button"
              aria-label={t("redis.add_hash_field")}
              disabled={isKeyActionRunning}
              onClick={() => void addHashField()}
            >
              {t("redis.add")}
            </button>
          </div>
        </div>
      </>
    );
  }
  if (value.kind === "list") {
    return (
      <>
        {value.truncated ? <p className="redis-key-dialog__hint">{t("redis.value_truncated")}</p> : null}
        <div className="redis-key-dialog__rows">
          {value.items.map((item, index) => (
            <div className="redis-key-dialog__edit-row" key={`${index}:${item}`}>
              <span className="redis-key-dialog__row-key">#{index}</span>
              <input
                aria-label={t("redis.list_item_label", { index })}
                value={listDrafts[index] ?? ""}
                onChange={(event) => setListDrafts((current) => current.map((draft, draftIndex) => (
                  draftIndex === index ? event.target.value : draft
                )))}
              />
              <button
                type="button"
                className="redis-key-dialog__action-button"
                aria-label={t("redis.save_list_item", { index })}
                disabled={isKeyActionRunning}
                onClick={() => void saveListItem(index)}
              >
                {t("redis.save")}
              </button>
              <button
                type="button"
                className="redis-key-dialog__action-button sftp-dialog__danger-button"
                aria-label={t("redis.delete_list_item", { index })}
                disabled={isKeyActionRunning}
                onClick={() => void deleteListItem(index)}
              >
                {t("redis.delete")}
              </button>
            </div>
          ))}
          <div className="redis-key-dialog__edit-row">
            <span aria-hidden="true" className="redis-key-dialog__row-spacer" />
            <input
              aria-label={t("redis.new_item")}
              placeholder={t("redis.new_item")}
              value={newListItem}
              onChange={(event) => setNewListItem(event.target.value)}
            />
            <button
              type="button"
              className="redis-key-dialog__action-button"
              aria-label={t("redis.add_item")}
              disabled={isKeyActionRunning}
              onClick={() => void appendListItem()}
            >
              {t("redis.add")}
            </button>
          </div>
        </div>
      </>
    );
  }
  if (value.kind === "set") {
    return (
      <>
        {value.truncated ? <p className="redis-key-dialog__hint">{t("redis.value_truncated")}</p> : null}
        <div className="redis-key-dialog__rows">
          {value.members.map((member) => (
            <div className="redis-key-dialog__edit-row redis-key-dialog__edit-row--set" key={member}>
              <span className="redis-key-dialog__row-key">{member}</span>
              <button
                type="button"
                className="redis-key-dialog__action-button sftp-dialog__danger-button"
                aria-label={t("redis.delete_set_member", { member })}
                disabled={isKeyActionRunning}
                onClick={() => void deleteSetMember(member)}
              >
                {t("redis.delete")}
              </button>
            </div>
          ))}
          <div className="redis-key-dialog__edit-row redis-key-dialog__edit-row--set">
            <input
              aria-label={t("redis.new_member")}
              placeholder={t("redis.new_member")}
              value={newSetMember}
              onChange={(event) => setNewSetMember(event.target.value)}
            />
            <button
              type="button"
              className="redis-key-dialog__action-button"
              aria-label={t("redis.add_member")}
              disabled={isKeyActionRunning}
              onClick={() => void addSetMember()}
            >
              {t("redis.add")}
            </button>
          </div>
        </div>
      </>
    );
  }
  if (value.kind === "zset") {
    return (
      <>
        {value.truncated ? <p className="redis-key-dialog__hint">{t("redis.value_truncated")}</p> : null}
        <div className="redis-key-dialog__rows">
          {value.entries.map(([member]) => (
            <div className="redis-key-dialog__edit-row redis-key-dialog__edit-row--zset" key={member}>
              <span className="redis-key-dialog__row-key">{member}</span>
              <input
                aria-label={t("redis.zset_score_label", { member })}
                value={zsetDrafts[member] ?? ""}
                onChange={(event) => setZsetDrafts((current) => ({
                  ...current,
                  [member]: event.target.value,
                }))}
              />
              <button
                type="button"
                className="redis-key-dialog__action-button"
                aria-label={t("redis.save_zset_member", { member })}
                disabled={isKeyActionRunning}
                onClick={() => void saveZsetMember(member)}
              >
                {t("redis.save")}
              </button>
              <button
                type="button"
                className="redis-key-dialog__action-button sftp-dialog__danger-button"
                aria-label={t("redis.delete_set_member", { member })}
                disabled={isKeyActionRunning}
                onClick={() => void deleteZsetMember(member)}
              >
                {t("redis.delete")}
              </button>
            </div>
          ))}
          <div className="redis-key-dialog__edit-row redis-key-dialog__edit-row--zset">
            <input
              aria-label={t("redis.new_member")}
              placeholder={t("redis.new_member")}
              value={newZsetMember}
              onChange={(event) => setNewZsetMember(event.target.value)}
            />
            <input
              aria-label={t("redis.new_score")}
              placeholder={t("redis.new_score")}
              value={newZsetScore}
              onChange={(event) => setNewZsetScore(event.target.value)}
            />
            <button
              type="button"
              className="redis-key-dialog__action-button"
              aria-label={t("redis.add_member")}
              disabled={isKeyActionRunning}
              onClick={() => void addZsetMember()}
            >
              {t("redis.add")}
            </button>
          </div>
        </div>
      </>
    );
  }
  return <p className="redis-key-dialog__hint">{t("redis.key_missing")}</p>;
}
