import { useMemo, useState, type FormEvent } from "react";
import type { ConnectionAuthSettings, ConnectionSettings } from "../settings/settingsTypes";
import { ContextMenu, type ContextMenuState } from "../../app/ContextMenu";
import { pickPrivateKeyFile } from "../../lib/fileDialog";
import sshConnectionIcon from "../../assets/icons/devicon--powershell.png";
import { useI18n } from "../../i18n/useI18n";

interface ConnectionListProps {
  connections: ConnectionSettings[];
  onOpenTerminal: (connectionId: string) => void;
  onOpenNewTerminal: (connectionId: string) => void;
  onOpenSftp: (connectionId: string) => void;
  onAddConnection: (connection: ConnectionSettings) => void;
  onUpdateConnection: (connection: ConnectionSettings) => void;
  connectionGroups: string[];
  onUpdateConnectionGroups: (groups: string[]) => void;
}

const localConnectionId = "local";
const ungroupedName = "未分组";
type ConnectionSortMode = "name" | "last_connected_at" | "connection_count";

function createConnectionId(host: string) {
  return `ssh-${host.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "connection"}-${Date.now()}`;
}

type ConnectionDialogMode = "add" | "edit" | "copy";

function getConnectionMetric(connection: ConnectionSettings, field: "last_connected_at" | "connection_count") {
  return (connection as unknown as Record<string, number | string | undefined>)[field];
}

function compareOptionalMetric(left: number | string | undefined, right: number | string | undefined) {
  if (left === undefined && right === undefined) return 0;
  if (left === undefined) return 1;
  if (right === undefined) return -1;
  if (typeof left === "number" && typeof right === "number") return right - left;
  return String(right).localeCompare(String(left));
}

function sortConnections(connections: ConnectionSettings[], mode: ConnectionSortMode) {
  return [...connections].sort((left, right) => {
    if (mode === "name") return left.name.localeCompare(right.name);
    const result = compareOptionalMetric(getConnectionMetric(left, mode), getConnectionMetric(right, mode));
    return result === 0 ? left.name.localeCompare(right.name) : result;
  });
}

function compareGroups(
  leftName: string,
  leftConnections: ConnectionSettings[],
  rightName: string,
  rightConnections: ConnectionSettings[],
  mode: ConnectionSortMode,
) {
  if (mode === "name") return leftName.localeCompare(rightName);
  if (mode === "connection_count") {
    const result = rightConnections.length - leftConnections.length;
    return result === 0 ? leftName.localeCompare(rightName) : result;
  }
  const leftLastConnected = leftConnections
    .map((connection) => getConnectionMetric(connection, "last_connected_at"))
    .filter(Boolean)
    .sort((left, right) => String(right).localeCompare(String(left)))[0];
  const rightLastConnected = rightConnections
    .map((connection) => getConnectionMetric(connection, "last_connected_at"))
    .filter(Boolean)
    .sort((left, right) => String(right).localeCompare(String(left)))[0];
  const result = compareOptionalMetric(leftLastConnected, rightLastConnected);
  return result === 0 ? leftName.localeCompare(rightName) : result;
}

function createSortMenuItems(onSelect: (mode: ConnectionSortMode) => void, t: ReturnType<typeof useI18n>["t"]) {
  return [
    { label: t("connections.sort_name"), onSelect: () => onSelect("name") },
    { label: t("connections.sort_last_connected"), onSelect: () => onSelect("last_connected_at") },
    { label: t("connections.sort_most_used"), onSelect: () => onSelect("connection_count") },
  ];
}

export function ConnectionList({
  connections,
  onOpenTerminal,
  onOpenNewTerminal,
  onOpenSftp,
  onAddConnection,
  onUpdateConnection,
  connectionGroups,
  onUpdateConnectionGroups,
}: ConnectionListProps) {
  const { t } = useI18n();
  const [dialogMode, setDialogMode] = useState<ConnectionDialogMode | null>(null);
  const [sourceConnection, setSourceConnection] = useState<ConnectionSettings | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [isGroupDialogOpen, setIsGroupDialogOpen] = useState(false);
  const [name, setName] = useState("");
  const [newGroupName, setNewGroupName] = useState("");
  const [group, setGroup] = useState("");
  const [host, setHost] = useState("");
  const [port, setPort] = useState(22);
  const [username, setUsername] = useState("");
  const [authType, setAuthType] = useState<ConnectionAuthSettings["type"]>("password");
  const [password, setPassword] = useState("");
  const [privateKeyPath, setPrivateKeyPath] = useState("");
  const [privateKeyPassphrase, setPrivateKeyPassphrase] = useState("");
  const [groupSortMode, setGroupSortMode] = useState<ConnectionSortMode>("name");
  const [connectionSortMode, setConnectionSortMode] = useState<ConnectionSortMode>("name");
  const groupNames = useMemo(
    () =>
      Array.from(
        new Set([
          ...connectionGroups.map((item) => item.trim()).filter(Boolean),
          ...(connections.map((connection) => connection.group?.trim()).filter(Boolean) as string[]),
        ]),
      ),
    [connectionGroups, connections],
  );
  const groupedConnections = useMemo(() => {
    const groups = new Map<string, ConnectionSettings[]>();
    for (const groupName of groupNames) {
      groups.set(groupName, []);
    }
    for (const connection of connections) {
      const groupName = connection.group?.trim() || ungroupedName;
      groups.set(groupName, [...(groups.get(groupName) ?? []), connection]);
    }
    for (const [groupName, groupConnections] of groups.entries()) {
      groups.set(groupName, sortConnections(groupConnections, connectionSortMode));
    }
    const sortedGroups = Array.from(groups.entries())
      .filter(([groupName]) => groupName !== ungroupedName)
      .sort(([leftName, leftConnections], [rightName, rightConnections]) =>
        compareGroups(leftName, leftConnections, rightName, rightConnections, groupSortMode),
      );
    const ungroupedConnections = groups.get(ungroupedName) ?? [];
    return ungroupedConnections.length > 0
      ? [[ungroupedName, ungroupedConnections] as const, ...sortedGroups]
      : sortedGroups;
  }, [connectionSortMode, connections, groupNames, groupSortMode]);

  function dialogTitle(mode: ConnectionDialogMode) {
    if (mode === "edit") return t("connections.edit_ssh");
    if (mode === "copy") return t("connections.copy_ssh");
    return t("connections.add_ssh");
  }

  function groupDisplayName(groupName: string) {
    return groupName === ungroupedName ? t("connections.ungrouped") : groupName;
  }

  function submitConnection(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const auth: ConnectionAuthSettings =
      authType === "private_key"
        ? {
            type: "private_key",
            private_key_path: privateKeyPath.trim(),
            ...(privateKeyPassphrase ? { passphrase: privateKeyPassphrase } : {}),
          }
        : {
            type: "password",
            password,
          };
    const nextConnection: ConnectionSettings = {
      ...(group.trim() ? { group: group.trim() } : {}),
      id: dialogMode === "edit" && sourceConnection ? sourceConnection.id : createConnectionId(host),
      name: name.trim(),
      host: host.trim(),
      port,
      username: username.trim(),
      auth,
    };

    if (dialogMode === "edit") {
      onUpdateConnection(nextConnection);
    } else {
      onAddConnection(nextConnection);
    }

    closeConnectionDialog();
  }

  function openConnectionDialog(mode: ConnectionDialogMode, connection?: ConnectionSettings) {
    setDialogMode(mode);
    setSourceConnection(connection ?? null);
    setName(connection?.name ?? "");
    setGroup(connection?.group ?? "");
    setHost(connection?.host ?? "");
    setPort(connection?.port ?? 22);
    setUsername(connection?.username ?? "");
    setAuthType(connection?.auth.type ?? "password");
    setPassword(connection?.auth.type === "password" ? connection.auth.password : "");
    setPrivateKeyPath(connection?.auth.type === "private_key" ? connection.auth.private_key_path : "");
    setPrivateKeyPassphrase(connection?.auth.type === "private_key" ? (connection.auth.passphrase ?? "") : "");
  }

  function closeConnectionDialog() {
    setDialogMode(null);
    setSourceConnection(null);
    setName("");
    setGroup("");
    setHost("");
    setPort(22);
    setUsername("");
    setAuthType("password");
    setPassword("");
    setPrivateKeyPath("");
    setPrivateKeyPassphrase("");
  }

  async function choosePrivateKeyFile() {
    const selected = await pickPrivateKeyFile();
    if (selected) {
      setPrivateKeyPath(selected);
    }
  }

  function moveConnectionToGroup(connection: ConnectionSettings, targetGroup: string) {
    const nextGroup = targetGroup === ungroupedName ? undefined : targetGroup;
    if ((connection.group ?? undefined) === nextGroup) return;
    const connectionWithoutGroup = { ...connection };
    delete connectionWithoutGroup.group;
    onUpdateConnection(nextGroup ? { ...connection, group: nextGroup } : connectionWithoutGroup);
  }

  function submitGroup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextGroup = newGroupName.trim();
    if (!nextGroup || groupNames.includes(nextGroup)) {
      closeGroupDialog();
      return;
    }
    onUpdateConnectionGroups([...connectionGroups, nextGroup]);
    closeGroupDialog();
  }

  function closeGroupDialog() {
    setIsGroupDialogOpen(false);
    setNewGroupName("");
  }

  function openConnectionContextMenu(event: React.MouseEvent, connection: ConnectionSettings) {
    event.preventDefault();
    setContextMenu({
      x: event.clientX,
      y: event.clientY,
      items: [
        { label: t("connections.open"), onSelect: () => onOpenTerminal(connection.id) },
        { label: t("connections.open_new_tab"), onSelect: () => onOpenNewTerminal(connection.id) },
        { label: "SFTP", onSelect: () => onOpenSftp(connection.id) },
        { label: t("connections.edit"), onSelect: () => openConnectionDialog("edit", connection) },
        { label: t("connections.copy"), onSelect: () => openConnectionDialog("copy", connection) },
        { type: "separator" },
        {
          type: "submenu",
          label: t("connections.move_to_group"),
          items: [
            { label: t("connections.ungrouped"), onSelect: () => moveConnectionToGroup(connection, ungroupedName) },
            ...groupNames.map((groupName) => ({
              label: groupName,
              onSelect: () => moveConnectionToGroup(connection, groupName),
            })),
          ],
        },
      ],
    });
  }

  function openBlankContextMenu(event: React.MouseEvent) {
    event.preventDefault();
    const target = event.target as HTMLElement;
    if (target.closest("li")) return;
    setContextMenu({
      x: event.clientX,
      y: event.clientY,
      items: [
        { label: t("connections.add"), onSelect: () => openConnectionDialog("add") },
        { label: t("connections.add_group"), onSelect: () => setIsGroupDialogOpen(true) },
        { type: "separator" },
        {
          type: "submenu",
          label: t("connections.group_sort"),
          items: createSortMenuItems(setGroupSortMode, t),
        },
        {
          type: "submenu",
          label: t("connections.connection_sort"),
          items: createSortMenuItems(setConnectionSortMode, t),
        },
      ],
    });
  }

  return (
    <section className="connection-list">
      <header>
        <h2>{t("connections.title")}</h2>
        <button type="button" onClick={() => openConnectionDialog("add")}>
          {t("connections.add")}
        </button>
      </header>
      {dialogMode ? (
        <div className="connection-dialog__backdrop">
          <div className="connection-dialog" role="dialog" aria-modal="true" aria-labelledby="connection-dialog-title">
            <form className="connection-form" onSubmit={submitConnection}>
              <header className="connection-dialog__header">
                <h3 id="connection-dialog-title">{dialogTitle(dialogMode)}</h3>
                <button type="button" aria-label={t("connections.close_add_dialog")} onClick={closeConnectionDialog}>
                  ×
                </button>
              </header>
              <label>
                <span>{t("connections.name")}</span>
                <input aria-label={t("connections.name")} value={name} onChange={(event) => setName(event.target.value)} required />
              </label>
              <label>
                <span>{t("connections.group")}</span>
                <input
                  aria-label={t("connections.group")}
                  list="connection-group-options"
                  value={group}
                  onChange={(event) => setGroup(event.target.value)}
                />
                <datalist id="connection-group-options">
                  {groupNames.map((groupName) => (
                    <option key={groupName} value={groupName} />
                  ))}
                </datalist>
              </label>
              <label>
                <span>{t("connections.host")}</span>
                <input aria-label={t("connections.host")} value={host} onChange={(event) => setHost(event.target.value)} required />
              </label>
              <label>
                <span>{t("connections.port")}</span>
                <input
                  aria-label={t("connections.port")}
                  type="number"
                  min={1}
                  max={65535}
                  value={port}
                  onChange={(event) => setPort(Number(event.target.value))}
                  required
                />
              </label>
              <label>
                <span>{t("connections.username")}</span>
                <input aria-label={t("connections.username")} value={username} onChange={(event) => setUsername(event.target.value)} required />
              </label>
              <label>
                <span>{t("connections.auth_type")}</span>
                <select
                  aria-label={t("connections.auth_type")}
                  value={authType}
                  onChange={(event) => setAuthType(event.target.value as ConnectionAuthSettings["type"])}
                >
                  <option value="password">{t("connections.password")}</option>
                  <option value="private_key">{t("connections.private_key")}</option>
                </select>
              </label>
              {authType === "password" ? (
                <label>
                  <span>{t("connections.password")}</span>
                  <input
                    aria-label={t("connections.password")}
                    type="password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                  />
                </label>
              ) : (
                <>
                  <label>
                    <span>{t("connections.private_key_path")}</span>
                    <div className="connection-form__inline-field">
                      <input
                        aria-label={t("connections.private_key_path")}
                        value={privateKeyPath}
                        onChange={(event) => setPrivateKeyPath(event.target.value)}
                        required
                      />
                      <button type="button" onClick={() => void choosePrivateKeyFile()}>
                        {t("connections.pick_private_key")}
                      </button>
                    </div>
                  </label>
                  <label>
                    <span>{t("connections.private_key_passphrase")}</span>
                    <input
                      aria-label={t("connections.private_key_passphrase")}
                      type="password"
                      value={privateKeyPassphrase}
                      onChange={(event) => setPrivateKeyPassphrase(event.target.value)}
                    />
                  </label>
                </>
              )}
              <footer>
                <button type="button" onClick={closeConnectionDialog}>
                  {t("connections.cancel")}
                </button>
                <button type="submit">{t("connections.save")}</button>
              </footer>
            </form>
          </div>
        </div>
      ) : null}
      {isGroupDialogOpen ? (
        <div className="connection-dialog__backdrop">
          <div className="connection-dialog" role="dialog" aria-modal="true" aria-labelledby="connection-group-dialog-title">
            <form className="connection-form" onSubmit={submitGroup}>
              <header className="connection-dialog__header">
                <h3 id="connection-group-dialog-title">{t("connections.add_group")}</h3>
                <button type="button" aria-label={t("connections.close_group_dialog")} onClick={closeGroupDialog}>
                  ×
                </button>
              </header>
              <label>
                <span>{t("connections.group_name")}</span>
                <input
                  aria-label={t("connections.group_name")}
                  value={newGroupName}
                  onChange={(event) => setNewGroupName(event.target.value)}
                  required
                />
              </label>
              <footer>
                <button type="button" onClick={closeGroupDialog}>
                  {t("connections.cancel")}
                </button>
                <button type="submit">{t("connections.save_group")}</button>
              </footer>
            </form>
          </div>
        </div>
      ) : null}
      <ul className="connection-local-list">
        <li onDoubleClick={() => onOpenTerminal(localConnectionId)}>
          <strong>
            <img src={sshConnectionIcon} alt={t("connections.ssh_icon")} />
            {t("connections.local_terminal")}
          </strong>
          <span>{t("connections.local_shell")}</span>
        </li>
      </ul>
      <div className="connection-groups" aria-label={t("connections.group_list")} onContextMenu={openBlankContextMenu}>
        {groupedConnections.map(([groupName, groupConnections]) => (
          <section
            key={groupName}
            className="connection-group"
            aria-label={t("connections.group_label", { name: groupDisplayName(groupName) })}
          >
            <h3>{groupDisplayName(groupName)}</h3>
            <ul>
              {groupConnections.map((connection) => (
                <li
                  key={connection.id}
                  onDoubleClick={() => onOpenTerminal(connection.id)}
                  onContextMenu={(event) => openConnectionContextMenu(event, connection)}
                >
                  <strong>
                    <img src={sshConnectionIcon} alt={t("connections.ssh_icon")} />
                    {connection.name}
                  </strong>
                  <span>
                    {connection.username}@{connection.host}:{connection.port}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
      <ContextMenu menu={contextMenu} onClose={() => setContextMenu(null)} />
    </section>
  );
}
