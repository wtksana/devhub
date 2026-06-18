import type { TranslationKey } from "../../i18n/I18nProvider";
import { useI18n } from "../../i18n/useI18n";

export interface TransferTask {
  id: string;
  name: string;
  direction: "upload" | "download";
  status: "running" | "completed" | "failed" | "canceled";
  progress?: number;
  error?: string;
}

function transferStatusText(task: TransferTask, t: (key: TranslationKey, params?: Record<string, string | number>) => string) {
  const direction = task.direction === "upload" ? t("transfer.upload") : t("transfer.download");
  if (task.status === "running") {
    const progress = typeof task.progress === "number" ? `${task.progress}%` : "";
    return t("transfer.running", { progress });
  }
  if (task.status === "failed") return t("transfer.failed", { direction, error: task.error ? ` ${task.error}` : "" });
  if (task.status === "canceled") return t("transfer.canceled");
  return task.direction === "upload" ? t("transfer.upload_completed") : t("transfer.download_completed");
}

function transferTaskText(task: TransferTask, t: (key: TranslationKey, params?: Record<string, string | number>) => string) {
  return `${task.name} ${transferStatusText(task, t)}`;
}

export function TransferQueue({
  tasks = [],
  onCancel,
}: {
  tasks?: TransferTask[];
  onCancel?: (taskId: string) => void;
}) {
  const { t } = useI18n();

  return (
    <section aria-label={t("transfer.queue")} className="transfer-queue">
      <h3>{t("transfer.queue")}</h3>
      {tasks.length ? (
        <ul>
          {tasks.map((task) => (
            <li key={task.id}>
              <span>{transferTaskText(task, t)}</span>
              {task.status === "running" ? (
                <button
                  type="button"
                  onClick={() => onCancel?.(task.id)}
                  aria-label={t("transfer.cancel_label", { name: task.name })}
                >
                  {t("transfer.cancel")}
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p>{t("transfer.empty")}</p>
      )}
    </section>
  );
}
