import { useState, type FormEvent } from "react";
import type { ConnectionSettings } from "../settings/settingsTypes";

interface ConnectionListProps {
  connections: ConnectionSettings[];
  onOpenTerminal: (connectionId: string) => void;
  onOpenSftp: (connectionId: string) => void;
  onAddConnection: (connection: ConnectionSettings) => void;
}

const localConnectionId = "local";

function createConnectionId(host: string) {
  return `ssh-${host.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "connection"}-${Date.now()}`;
}

export function ConnectionList({ connections, onOpenTerminal, onOpenSftp, onAddConnection }: ConnectionListProps) {
  const [isAddingConnection, setIsAddingConnection] = useState(false);
  const [name, setName] = useState("");
  const [host, setHost] = useState("");
  const [port, setPort] = useState(22);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  function submitConnection(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onAddConnection({
      id: createConnectionId(host),
      name,
      host,
      port,
      username,
      auth: {
        type: "password",
        password,
      },
    });
    setIsAddingConnection(false);
    setName("");
    setHost("");
    setPort(22);
    setUsername("");
    setPassword("");
  }

  return (
    <section className="connection-list">
      <header>
        <h2>连接</h2>
        <button type="button" onClick={() => setIsAddingConnection((value) => !value)}>
          添加连接
        </button>
      </header>
      {isAddingConnection ? (
        <form className="connection-form" aria-label="添加 SSH 连接" onSubmit={submitConnection}>
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
          <button type="submit">保存连接</button>
        </form>
      ) : null}
      <ul>
        <li>
          <strong>本地终端</strong>
          <span>本机 shell</span>
          <button type="button" onClick={() => onOpenTerminal(localConnectionId)}>
            终端
          </button>
        </li>
        {connections.map((connection) => (
          <li key={connection.id}>
            <strong>{connection.name}</strong>
            <span>
              {connection.username}@{connection.host}:{connection.port}
            </span>
            <button type="button" onClick={() => onOpenTerminal(connection.id)}>
              终端
            </button>
            <button type="button" onClick={() => onOpenSftp(connection.id)}>
              SFTP
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
