import { useCallback, useState } from "react";
import { callBackend } from "../../lib/tauri";
import type { SftpEntry } from "./sftpTypes";
import { TransferQueue } from "./TransferQueue";

interface SftpWorkspaceProps {
  connectionId: string | null;
}

export function SftpWorkspace({ connectionId }: SftpWorkspaceProps) {
  const [path, setPath] = useState("/");
  const [entries, setEntries] = useState<SftpEntry[]>([]);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!connectionId) return;
    try {
      const nextEntries = await callBackend<SftpEntry[]>("list_directory", {
        request: { connection_id: connectionId, path },
      });
      setEntries(nextEntries);
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }, [connectionId, path]);

  if (!connectionId) {
    return (
      <section className="workspace-empty">
        <h2>未选择连接</h2>
        <p>请先在左侧连接列表中打开 SFTP。</p>
      </section>
    );
  }

  return (
    <section className="sftp-workspace">
      <header>
        <h2>SFTP</h2>
        <input
          value={path}
          onChange={(event) => setPath(event.target.value)}
          aria-label="远程路径"
        />
        <button type="button" onClick={() => void refresh()}>
          刷新
        </button>
        <button type="button">新建目录</button>
      </header>
      {error ? <p role="alert">{error}</p> : null}
      <table>
        <thead>
          <tr>
            <th>名称</th>
            <th>类型</th>
            <th>大小</th>
            <th>权限</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => (
            <tr key={entry.path}>
              <td>{entry.name}</td>
              <td>{entry.kind}</td>
              <td>{entry.size}</td>
              <td>{entry.permissions ?? ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <TransferQueue />
    </section>
  );
}
