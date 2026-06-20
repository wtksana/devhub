import type { DatabaseWorkspaceProps } from "./databaseTypes";
import { useI18n } from "../../i18n/useI18n";

export function DatabaseWorkspace({ connectionId }: DatabaseWorkspaceProps) {
  const { t } = useI18n();

  return (
    <section className="database-workspace" aria-label={t("database.workspace")}>
      <div className="database-workspace__empty">{connectionId}</div>
    </section>
  );
}
