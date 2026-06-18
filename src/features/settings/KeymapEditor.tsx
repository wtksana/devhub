import { useI18n } from "../../i18n/useI18n";

export function KeymapEditor() {
  const { t } = useI18n();

  return (
    <section className="keymap-editor">
      <h2>{t("settings.shortcuts")}</h2>
      <p>{t("settings.keymap_desc")}</p>
    </section>
  );
}
