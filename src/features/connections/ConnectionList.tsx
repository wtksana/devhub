import { useState, type FormEvent } from "react";
import type { ConnectionSettings } from "../settings/settingsTypes";
import sshConnectionIcon from "../../assets/icons/devicon--powershell.png";

interface ConnectionListProps {
  connections: ConnectionSettings[];
  onOpenTerminal: (connectionId: string) => void;
  onAddConnection: (connection: ConnectionSettings) => void;
}

const localConnectionId = "local";

function createConnectionId(host: string) {
  return `ssh-${host.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "connection"}-${Date.now()}`;
}

export function ConnectionList({ connections, onOpenTerminal, onAddConnection }: ConnectionListProps) {
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

  function closeAddConnectionDialog() {
    setIsAddingConnection(false);
  }

  return (
    <section className="connection-list">
      <header>
        <h2>连接</h2>
        <button type="button" onClick={() => setIsAddingConnection(true)}>
          添加连接
        </button>
      </header>
      {isAddingConnection ? (
        <div className="connection-dialog__backdrop">
          <div className="connection-dialog" role="dialog" aria-modal="true" aria-labelledby="add-ssh-connection-title">
            <form className="connection-form" onSubmit={submitConnection}>
              <header>
                <h3 id="add-ssh-connection-title">添加 SSH 连接</h3>
                <button type="button" aria-label="关闭添加连接弹窗" onClick={closeAddConnectionDialog}>
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
                <button type="button" onClick={closeAddConnectionDialog}>
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
          <li key={connection.id} onDoubleClick={() => onOpenTerminal(connection.id)}>
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
    </section>
  );
}
