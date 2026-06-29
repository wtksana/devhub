import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { useI18n } from "../../i18n/useI18n";
import { logFrontendError } from "../../lib/appLogging";
import { callBackend } from "../../lib/tauri";
import type { DatabaseTreeNode } from "./databaseTypes";
import { AppIcon } from "../../app/AppIcon";
import TableIcon from "../../assets/icons/mdi-light--table.svg?react";

interface DatabaseObjectTreeProps {
  connectionId: string;
  selectedDatabase: string;
  refreshKey?: number;
  onDatabaseChange: (database: string) => void;
  onOpenTable?: (node: DatabaseTreeNode) => void;
  onTableContextMenu?: (event: ReactMouseEvent, node: DatabaseTreeNode) => void;
  onTablesChange?: (nodes: DatabaseTreeNode[]) => void;
}

type DatabaseObjectRequest = ReturnType<typeof childRequest>;

const OBJECT_TREE_REQUEST_TIMEOUT_MS = 15_000;

function childRequest(connectionId: string, node?: DatabaseTreeNode) {
  if (!node) {
    return {
      connection_id: connectionId,
    };
  }
  if (node.kind === "database") {
    return {
      connection_id: connectionId,
      parent_kind: node.kind,
      database: node.name,
    };
  }
  if (node.kind === "schema") {
    return {
      connection_id: connectionId,
      parent_kind: node.kind,
      schema: node.name,
    };
  }
  if (node.kind === "table" || node.kind === "view") {
    const [schemaOrDatabase] = node.id.replace(/^[^:]+:/, "").split(".");
    return {
      connection_id: connectionId,
      parent_kind: node.kind,
      database: schemaOrDatabase,
      schema: schemaOrDatabase,
      table: node.name,
    };
  }
  return {
    connection_id: connectionId,
    parent_kind: node.kind,
  };
}

function objectRequestKey(request: DatabaseObjectRequest) {
  return JSON.stringify(request);
}

function listDatabaseObjectsOnce(
  request: DatabaseObjectRequest,
  pendingObjectRequests: Map<string, Promise<DatabaseTreeNode[]>>,
) {
  const key = objectRequestKey(request);
  const pendingRequest = pendingObjectRequests.get(key);
  if (pendingRequest) return pendingRequest;

  const requestPromise = withTimeout(
    callBackend<DatabaseTreeNode[]>("list_database_objects", { request }),
    OBJECT_TREE_REQUEST_TIMEOUT_MS,
  ).finally(() => {
    pendingObjectRequests.delete(key);
  });
  pendingObjectRequests.set(key, requestPromise);
  return requestPromise;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number) {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      reject(new Error("database object loading timed out"));
    }, timeoutMs);
    promise.then(
      (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        window.clearTimeout(timer);
        reject(error);
      },
    );
  });
}

export function DatabaseObjectTree({
  connectionId,
  selectedDatabase,
  refreshKey = 0,
  onDatabaseChange,
  onOpenTable,
  onTableContextMenu,
  onTablesChange,
}: DatabaseObjectTreeProps) {
  const { t } = useI18n();
  const [databases, setDatabases] = useState<DatabaseTreeNode[]>([]);
  const [tables, setTables] = useState<DatabaseTreeNode[]>([]);
  const [tableFilter, setTableFilter] = useState("");
  const [databaseListError, setDatabaseListError] = useState("");
  const [tableListError, setTableListError] = useState("");
  const [isLoadingTables, setIsLoadingTables] = useState(false);
  const [retryKey, setRetryKey] = useState(0);
  const hasLoadedDatabaseListRef = useRef(false);
  const pendingObjectRequestsRef = useRef(new Map<string, Promise<DatabaseTreeNode[]>>());

  useEffect(() => {
    let canceled = false;
    hasLoadedDatabaseListRef.current = false;
    setDatabaseListError("");
    setDatabases(selectedDatabase ? [{
      id: `database:${selectedDatabase}`,
      name: selectedDatabase,
      kind: "database",
      has_children: true,
    }] : []);
    setTables([]);
    setTableFilter("");
    void loadDatabaseList().then((nodes) => {
      if (canceled) return;
      if (!selectedDatabase && nodes[0]?.name) {
        onDatabaseChange(nodes[0].name);
      }
    });
    return () => {
      canceled = true;
    };
  }, [connectionId, retryKey]);

  useEffect(() => {
    let canceled = false;
    setTables([]);
    setTableListError("");
    setIsLoadingTables(Boolean(selectedDatabase));
    if (!selectedDatabase) return () => {
      canceled = true;
      setIsLoadingTables(false);
    };
    void loadNodes({ id: `database:${selectedDatabase}`, name: selectedDatabase, kind: "database", has_children: true }).then((nodes) => {
      if (!canceled) {
        setTables(nodes);
        onTablesChange?.(nodes);
        setIsLoadingTables(false);
      }
    });
    return () => {
      canceled = true;
      setIsLoadingTables(false);
    };
  }, [connectionId, onTablesChange, selectedDatabase, refreshKey, retryKey]);

  async function loadNodes(parent?: DatabaseTreeNode) {
    try {
      const nodes = await listDatabaseObjectsOnce(childRequest(connectionId, parent), pendingObjectRequestsRef.current);
      if (parent?.kind === "database" || parent?.kind === "schema") {
        setTableListError("");
      } else {
        setDatabaseListError("");
      }
      return Array.isArray(nodes) ? nodes : [];
    } catch (loadError) {
      const message = loadError instanceof Error ? loadError.message : String(loadError);
      if (parent?.kind === "database" || parent?.kind === "schema") {
        setTableListError(message);
      } else {
        setDatabaseListError(message);
      }
      void logFrontendError("frontend.database", "list_database_objects", loadError, connectionId, {
        database: parent?.kind === "database" ? parent.name : selectedDatabase || null,
        parent_kind: parent?.kind ?? null,
      });
      return [];
    }
  }

  async function loadDatabaseList() {
    const nodes = await loadNodes();
    hasLoadedDatabaseListRef.current = true;
    setDatabases(mergeSelectedDatabaseNode(selectedDatabase, nodes));
    return nodes;
  }

  function handleDatabaseSelectorFocus() {
    if (hasLoadedDatabaseListRef.current) return;
    void loadDatabaseList();
  }

  const normalizedFilter = normalizeTableFilterText(tableFilter);
  const visibleTables = normalizedFilter
    ? tables.filter((table) => normalizeTableFilterText(table.name).includes(normalizedFilter))
    : tables;
  const visibleError = tableListError || (!selectedDatabase ? databaseListError : "");

  return (
    <aside className="database-object-tree" aria-label={t("database.object_tree")}>
      <header className="database-object-tree__header">
        <label>
          <span>{t("database.current_database")}</span>
          <select
            aria-label={t("database.current_database")}
            value={selectedDatabase}
            disabled={databases.length === 0}
            onFocus={handleDatabaseSelectorFocus}
            onMouseDown={handleDatabaseSelectorFocus}
            onChange={(event) => onDatabaseChange(event.target.value)}
          >
            {!selectedDatabase ? <option value="">{t("database.no_database")}</option> : null}
            {selectedDatabase && !databases.some((database) => database.name === selectedDatabase) ? (
              <option value={selectedDatabase}>{selectedDatabase}</option>
            ) : null}
            {databases.map((database) => (
              <option key={database.id} value={database.name}>{database.name}</option>
            ))}
          </select>
        </label>
        <label>
          <span>{t("database.table_filter")}</span>
          <input
            aria-label={t("database.table_filter")}
            value={tableFilter}
            placeholder={t("database.table_filter_placeholder")}
            onChange={(event) => setTableFilter(event.target.value)}
          />
        </label>
      </header>
      {visibleError ? (
        <section className="workspace-error-panel workspace-error-panel--compact">
          <div>
            <strong>{t("database.object_load_failed")}</strong>
            <p role="alert">{visibleError}</p>
          </div>
          <button
            type="button"
            onClick={() => {
              setTableListError("");
              setDatabaseListError("");
              setRetryKey((key) => key + 1);
            }}
          >
            {t("database.retry")}
          </button>
        </section>
      ) : null}
      <ul aria-label={t("database.table_list")}>
        {visibleTables.map((node) => (
          <li
            key={node.id}
            className="database-object-tree__item"
            onContextMenu={(event) => {
              if (node.kind === "table" || node.kind === "view") {
                onTableContextMenu?.(event, node);
              }
            }}
            onDoubleClick={() => {
              if (node.kind === "table" || node.kind === "view") {
                onOpenTable?.(node);
              }
            }}
          >
            <button
              type="button"
              className="database-object-tree__item-button"
            >
              <AppIcon icon={TableIcon} decorative className="database-object-tree__icon" />
              <span>{node.name}</span>
            </button>
          </li>
        ))}
        {selectedDatabase && isLoadingTables && !visibleError ? (
          <li className="database-object-tree__empty">
            <strong>{t("database.loading")}</strong>
          </li>
        ) : null}
        {selectedDatabase && visibleTables.length === 0 && !isLoadingTables && !visibleError ? (
          <li className="database-object-tree__empty">
            <strong>{t("database.no_tables")}</strong>
            <span>{t("database.no_tables_hint")}</span>
          </li>
        ) : null}
      </ul>
    </aside>
  );
}

function normalizeTableFilterText(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function mergeSelectedDatabaseNode(selectedDatabase: string, nodes: DatabaseTreeNode[]) {
  if (!selectedDatabase || nodes.some((node) => node.name === selectedDatabase)) {
    return nodes;
  }
  return [{
    id: `database:${selectedDatabase}`,
    name: selectedDatabase,
    kind: "database",
    has_children: true,
  }, ...nodes];
}
