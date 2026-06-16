import type { ConnectionSettings } from "../settings/settingsTypes";

interface ConnectionListProps {
  connections: ConnectionSettings[];
  onOpenTerminal: (connectionId: string) => void;
  onOpenSftp: (connectionId: string) => void;
}

export function ConnectionList({ connections, onOpenTerminal, onOpenSftp }: ConnectionListProps) {
  return (
    <section className="connection-list">
      <header>
        <h2>连接</h2>
      </header>
      {connections.length === 0 ? (
        <div className="empty-state">
          <p>暂无连接</p>
          <span>请在设置中添加 SSH 连接。</span>
        </div>
      ) : null}
      <ul>
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
