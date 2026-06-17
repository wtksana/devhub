export interface TransferTask {
  id: string;
  name: string;
  direction: "upload" | "download";
  status: "running" | "completed" | "failed";
  progress?: number;
  error?: string;
}

function transferStatusText(task: TransferTask) {
  const direction = task.direction === "upload" ? "上传" : "下载";
  if (task.status === "running") {
    const progress = typeof task.progress === "number" ? `${task.progress}%` : "";
    return `传输中...${progress}`;
  }
  if (task.status === "failed") return `${direction}失败${task.error ? ` ${task.error}` : ""}`;
  return task.direction === "upload" ? "上传完成" : "下载完成";
}

function transferTaskText(task: TransferTask) {
  return `${task.name} ${transferStatusText(task)}`;
}

export function TransferQueue({ tasks = [] }: { tasks?: TransferTask[] }) {
  return (
    <section aria-label="传输队列" className="transfer-queue">
      <h3>传输队列</h3>
      {tasks.length ? (
        <ul>
          {tasks.map((task) => (
            <li key={task.id}>
              {transferTaskText(task)}
            </li>
          ))}
        </ul>
      ) : (
        <p>暂无传输任务</p>
      )}
    </section>
  );
}
