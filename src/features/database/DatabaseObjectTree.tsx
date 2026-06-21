import { useEffect, useState } from "react";
import { Table2 } from "lucide-react";
import { useI18n } from "../../i18n/useI18n";
import { callBackend } from "../../lib/tauri";
import type { DatabaseTreeNode } from "./databaseTypes";

interface DatabaseObjectTreeProps {
  connectionId: string;
  selectedDatabase: string;
  onDatabaseChange: (database: string) => void;
  onOpenTable?: (node: DatabaseTreeNode) => void;
}

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

export function DatabaseObjectTree({ connectionId, selectedDatabase, onDatabaseChange, onOpenTable }: DatabaseObjectTreeProps) {
  const { t } = useI18n();
  const [databases, setDatabases] = useState<DatabaseTreeNode[]>([]);
  const [tables, setTables] = useState<DatabaseTreeNode[]>([]);
  const [tableFilter, setTableFilter] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let canceled = false;
    setError("");
    setDatabases([]);
    setTables([]);
    setTableFilter("");
    void loadNodes().then((nodes) => {
      if (canceled) return;
      setDatabases(nodes);
      if (!selectedDatabase && nodes[0]?.name) {
        onDatabaseChange(nodes[0].name);
      }
    });
    return () => {
      canceled = true;
    };
  }, [connectionId]);

  useEffect(() => {
    let canceled = false;
    setTables([]);
    if (!selectedDatabase) return () => {
      canceled = true;
    };
    void loadNodes({ id: `database:${selectedDatabase}`, name: selectedDatabase, kind: "database", has_children: true }).then((nodes) => {
      if (!canceled) setTables(nodes);
    });
    return () => {
      canceled = true;
    };
  }, [connectionId, selectedDatabase]);

  async function loadNodes(parent?: DatabaseTreeNode) {
    try {
      const nodes = await callBackend<DatabaseTreeNode[]>("list_database_objects", {
        request: childRequest(connectionId, parent),
      });
      setError("");
      return Array.isArray(nodes) ? nodes : [];
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
      return [];
    }
  }

  const normalizedFilter = normalizeTableFilterText(tableFilter);
  const visibleTables = normalizedFilter
    ? tables.filter((table) => normalizeTableFilterText(table.name).includes(normalizedFilter))
    : tables;

  return (
    <aside className="database-object-tree" aria-label={t("database.object_tree")}>
      <header className="database-object-tree__header">
        <label>
          <span>{t("database.current_database")}</span>
          <select
            aria-label={t("database.current_database")}
            value={selectedDatabase}
            disabled={databases.length === 0}
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
      {error ? <p role="alert">{error}</p> : null}
      <ul aria-label={t("database.table_list")}>
        {visibleTables.map((node) => (
          <li key={node.id}>
            <Table2 aria-hidden="true" className="database-object-tree__icon" size={15} strokeWidth={1.75} />
            <span onDoubleClick={() => {
              if (node.kind === "table" || node.kind === "view") {
                onOpenTable?.(node);
              }
            }}>
              {node.name}
            </span>
          </li>
        ))}
        {selectedDatabase && visibleTables.length === 0 && !error ? (
          <li className="database-object-tree__empty">{t("database.no_tables")}</li>
        ) : null}
      </ul>
    </aside>
  );
}

function normalizeTableFilterText(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}
