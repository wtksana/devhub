import { useEffect, useState } from "react";
import { useI18n } from "../../i18n/useI18n";
import { callBackend } from "../../lib/tauri";
import type { DatabaseTreeNode } from "./databaseTypes";

interface DatabaseObjectTreeProps {
  connectionId: string;
  onOpenTable?: (node: DatabaseTreeNode) => void;
}

interface DatabaseTreeRow {
  node: DatabaseTreeNode;
  depth: number;
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

function flattenRows(nodes: DatabaseTreeNode[], childrenByNode: Map<string, DatabaseTreeNode[]>, expandedNodes: Set<string>) {
  const rows: DatabaseTreeRow[] = [];
  function append(node: DatabaseTreeNode, depth: number) {
    rows.push({ node, depth });
    if (!expandedNodes.has(node.id)) return;
    for (const child of childrenByNode.get(node.id) ?? []) {
      append(child, depth + 1);
    }
  }
  for (const node of nodes) append(node, 0);
  return rows;
}

export function DatabaseObjectTree({ connectionId, onOpenTable }: DatabaseObjectTreeProps) {
  const { t } = useI18n();
  const [rootNodes, setRootNodes] = useState<DatabaseTreeNode[]>([]);
  const [childrenByNode, setChildrenByNode] = useState<Map<string, DatabaseTreeNode[]>>(new Map());
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set());
  const [error, setError] = useState("");

  useEffect(() => {
    let canceled = false;
    setError("");
    setRootNodes([]);
    setChildrenByNode(new Map());
    setExpandedNodes(new Set());
    void loadNodes().then((nodes) => {
      if (!canceled) setRootNodes(nodes);
    });
    return () => {
      canceled = true;
    };
  }, [connectionId]);

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

  async function toggleNode(node: DatabaseTreeNode) {
    if (!node.has_children) return;
    if (expandedNodes.has(node.id)) {
      setExpandedNodes((current) => {
        const next = new Set(current);
        next.delete(node.id);
        return next;
      });
      return;
    }

    if (!childrenByNode.has(node.id)) {
      const children = await loadNodes(node);
      setChildrenByNode((current) => {
        const next = new Map(current);
        next.set(node.id, children);
        return next;
      });
    }
    setExpandedNodes((current) => new Set(current).add(node.id));
  }

  const rows = flattenRows(rootNodes, childrenByNode, expandedNodes);

  return (
    <aside className="database-object-tree" aria-label={t("database.object_tree")}>
      {error ? <p role="alert">{error}</p> : null}
      <ul>
        {rows.map(({ node, depth }) => (
          <li key={node.id} style={{ paddingLeft: `${depth * 16}px` }}>
            {node.has_children ? (
              <button type="button" onClick={() => void toggleNode(node)}>
                {expandedNodes.has(node.id) ? t("database.collapse_node", { name: node.name }) : t("database.expand_node", { name: node.name })}
              </button>
            ) : (
              <span className="database-object-tree__leaf" />
            )}
            <span onDoubleClick={() => {
              if (node.kind === "table" || node.kind === "view") {
                onOpenTable?.(node);
              }
            }}>
              {node.name}
            </span>
            {node.detail ? <small>{node.detail}</small> : null}
          </li>
        ))}
      </ul>
    </aside>
  );
}
