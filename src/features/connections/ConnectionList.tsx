import { useState, type FormEvent } from "react";
import type { ConnectionSettings } from "../settings/settingsTypes";
import { ContextMenu, type ContextMenuState } from "../../app/ContextMenu";
import sshConnectionIcon from "../../assets/icons/devicon--powershell.png";

interface ConnectionListProps {
  connections: ConnectionSettings[];
  onOpenTerminal: (connectionId: string) => void;
  onOpenNewTerminal: (connectionId: string) => void;
  onOpenSftp: (connectionId: string) => void;
  onAddConnection: (connection: ConnectionSettings) => void;
  onUpdateConnection: (connection: ConnectionSettings) => void;
}

const localConnectionId = "local";

function createConnectionId(host: string) {
  return `ssh-${host.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "connection"}-${Date.now()}`;
}

type ConnectionDialogMode = "add" | "edit" | "copy";

function dialogTitle(mode: ConnectionDialogMode) {
  if (mode === "edit") return "编辑 SSH 连接";
  if (mode === "copy") return "复制 SSH 连接";
  return "添加 SSH 连接";
}

export function ConnectionList({
  connections,
  onOpenTerminal,
  onOpenNewTerminal,
  onOpenSftp,
  onAddConnection,
  onUpdateConnection,
}: ConnectionListProps) {
  const [dialogMode, setDialogMode] = useState<ConnectionDialogMode | null>(null);
  const [sourceConnection, setSourceConnection] = useState<ConnectionSettings | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [name, setName] = useState("");
  const [host, setHost] = useState("");
  const [port, setPort] = useState(22);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  function submitConnection(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextConnection: ConnectionSettings = {
      ...(sourceConnection?.group ? { group: sourceConnection.group } : {}),
      id: dialogMode === "edit" && sourceConnection ? sourceConnection.id : createConnectionId(host),
      name,
      host,
      port,
      username,
      auth: {
        type: "password",
        password,
      },
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
    setHost(connection?.host ?? "");
    setPort(connection?.port ?? 22);
    setUsername(connection?.username ?? "");
    setPassword(connection?.auth.type === "password" ? connection.auth.password : "");
  }

  function closeConnectionDialog() {
    setDialogMode(null);
    setSourceConnection(null);
    setName("");
    setHost("");
    setPort(22);
    setUsername("");
    setPassword("");
  }

  function openConnectionContextMenu(event: React.MouseEvent, connection: ConnectionSettings) {
    event.preventDefault();
    setContextMenu({
      x: event.clientX,
      y: event.clientY,
      items: [
        { label: "连接", onSelect: () => onOpenTerminal(connection.id) },
        { label: "新标签连接", onSelect: () => onOpenNewTerminal(connection.id) },
        { label: "SFTP", onSelect: () => onOpenSftp(connection.id) },
        { label: "编辑", onSelect: () => openConnectionDialog("edit", connection) },
        { label: "复制", onSelect: () => openConnectionDialog("copy", connection) },
      ],
    });
  }

  return (
    <section className="connection-list">
      <header>
        <h2>连接</h2>
        <button type="button" onClick={() => openConnectionDialog("add")}>
          添加连接
        </button>
      </header>
      {dialogMode ? (
        <div className="connection-dialog__backdrop">
          <div className="connection-dialog" role="dialog" aria-modal="true" aria-labelledby="connection-dialog-title">
            <form className="connection-form" onSubmit={submitConnection}>
              <header>
                <h3 id="connection-dialog-title">{dialogTitle(dialogMode)}</h3>
                <button type="button" aria-label="关闭添加连接弹窗" onClick={closeConnectionDialog}>
                  ×
                </button>
              </header>
              <label>
                <span>连接名称</span>
                <input aria-label="连接名称" value={name} onChange={(event) => setName(event.target.value)} required />
              </label>
              <label>
                <span>主机</span>
                <input aria-label="主机" value={host} onChange={(event) => setHost(event.target.value)} required />
              </label>
              <label>
                <span>端口</span>
                <input
                  aria-label="端口"
                  type="number"
                  min={1}
                  max={65535}
                  value={port}
                  onChange={(event) => setPort(Number(event.target.value))}
                  required
                />
              </label>
              <label>
                <span>用户名</span>
                <input aria-label="用户名" value={username} onChange={(event) => setUsername(event.target.value)} required />
              </label>
              <label>
                <span>密码</span>
                <input
                  aria-label="密码"
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
              </label>
              <footer>
                <button type="button" onClick={closeConnectionDialog}>
                  取消
                </button>
                <button type="submit">保存连接</button>
              </footer>
            </form>
          </div>
        </div>
      ) : null}
      <ul>
        <li onDoubleClick={() => onOpenTerminal(localConnectionId)}>
          <strong>
            <img src={sshConnectionIcon} alt="SSH 连接" />
            本地终端
          </strong>
          <span>本机 shell</span>
        </li>
        {connections.map((connection) => (
          <li
            key={connection.id}
            onDoubleClick={() => onOpenTerminal(connection.id)}
            onContextMenu={(event) => openConnectionContextMenu(event, connection)}
          >
            <strong>
              <img src={sshConnectionIcon} alt="SSH 连接" />
              {connection.name}
            </strong>
            <span>
              {connection.username}@{connection.host}:{connection.port}
            </span>
          </li>
        ))}
      </ul>
      <ContextMenu menu={contextMenu} onClose={() => setContextMenu(null)} />
    </section>
  );
}
