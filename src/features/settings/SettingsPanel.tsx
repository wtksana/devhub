import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { SettingsJsonEditor } from "./SettingsJsonEditor";
import { KeymapEditor } from "./KeymapEditor";
import { useSettings } from "./useSettings";
import type { DevHubSettings, LanguageSetting, LogLevel, SftpFileSizeUnit, ThemeName } from "./settingsTypes";
import { callBackend } from "../../lib/tauri";
import { useI18n } from "../../i18n/useI18n";

const navItems = ["通用", "外观", "布局", "连接", "SFTP", "日志", "快捷键", "settings.json"] as const;
type SettingsCategory = (typeof navItems)[number];
type SettingsState = ReturnType<typeof useSettings>;
const fallbackFonts = ["Inter", "Segoe UI", "Zed Sans", "JetBrains Mono", "Consolas"];
const defaultLogHighlightRule = { pattern: "", color: "#56b6c2" };

function SettingsRow({
  title,
  description,
  children,
  isStacked = false,
}: {
  title: string;
  description: string;
  children: ReactNode;
  isStacked?: boolean;
}) {
  return (
    <div className={isStacked ? "settings-row settings-row--stacked" : "settings-row"}>
      <div className="settings-row__meta">
        <h3>{title}</h3>
        <p>{description}</p>
      </div>
      <div className="settings-row__control">{children}</div>
    </div>
  );
}

function commitOnEnter(event: KeyboardEvent<HTMLInputElement>) {
  if (event.key === "Enter") {
    event.currentTarget.blur();
  }
}

function uniqueFonts(fonts: string[]) {
  return Array.from(new Set(fonts.map((font) => font.trim()).filter(Boolean))).sort((left, right) =>
    left.localeCompare(right),
  );
}

function FontSelect({
  label,
  value,
  fonts,
  onChange,
}: {
  label: string;
  value: string;
  fonts: string[];
  onChange: (font: string) => void;
}) {
  const options = uniqueFonts([...fonts, value]);

  return (
    <select aria-label={label} value={value} onChange={(event) => onChange(event.target.value)}>
      {options.map((font) => (
        <option key={font} value={font}>
          {font}
        </option>
      ))}
    </select>
  );
}

interface SettingsPanelProps {
  settingsState?: SettingsState;
  onOpenLogs?: () => void;
  resolvedTheme?: "dark" | "light";
}

export function SettingsPanel({ settingsState: providedSettingsState, onOpenLogs, resolvedTheme }: SettingsPanelProps) {
  if (providedSettingsState) {
    return <SettingsPanelView settingsState={providedSettingsState} onOpenLogs={onOpenLogs} resolvedTheme={resolvedTheme} />;
  }

  return <SettingsPanelWithLocalSettings onOpenLogs={onOpenLogs} resolvedTheme={resolvedTheme} />;
}

function SettingsPanelWithLocalSettings({ onOpenLogs, resolvedTheme }: { onOpenLogs?: () => void; resolvedTheme?: "dark" | "light" }) {
  const settingsState = useSettings();
  return <SettingsPanelView settingsState={settingsState} onOpenLogs={onOpenLogs} resolvedTheme={resolvedTheme} />;
}

function SettingsPanelView({
  settingsState,
  onOpenLogs,
  resolvedTheme,
}: {
  settingsState: SettingsState;
  onOpenLogs?: () => void;
  resolvedTheme?: "dark" | "light";
}) {
  const { settings, error, saveSettings } = settingsState;
  const { t } = useI18n();
  const [draftSettings, setDraftSettings] = useState(settings);
  const [activeCategory, setActiveCategory] = useState<SettingsCategory>("外观");
  const [searchQuery, setSearchQuery] = useState("");
  const [systemFonts, setSystemFonts] = useState<string[]>(fallbackFonts);
  const sectionRefs = useRef<Record<SettingsCategory, HTMLElement | null>>({
    通用: null,
    外观: null,
    布局: null,
    连接: null,
    SFTP: null,
    日志: null,
    快捷键: null,
    "settings.json": null,
  });

  useEffect(() => {
    setDraftSettings(settings);
  }, [settings]);

  useEffect(() => {
    let cancelled = false;

    async function loadFonts() {
      try {
        const fonts = await callBackend<string[]>("list_system_fonts");
        if (!cancelled && fonts.length > 0) {
          setSystemFonts(uniqueFonts(fonts));
        }
      } catch {
        if (!cancelled) {
          setSystemFonts(fallbackFonts);
        }
      }
    }

    void loadFonts();

    return () => {
      cancelled = true;
    };
  }, []);

  const connectionSummary = useMemo(() => {
    if (draftSettings.connections.length === 0) return t("settings.no_connections");
    return t("settings.connection_count", { count: draftSettings.connections.length });
  }, [draftSettings.connections.length, t]);

  function updateSettings(nextSettings: DevHubSettings) {
    setDraftSettings(nextSettings);
    void saveSettings(nextSettings);
  }

  function updateAppearance(nextAppearance: Partial<DevHubSettings["appearance"]>) {
    updateSettings({
      ...draftSettings,
      appearance: {
        ...draftSettings.appearance,
        ...nextAppearance,
      },
    });
  }

  function updateLayout(nextLayout: Partial<DevHubSettings["layout"]>) {
    updateSettings({
      ...draftSettings,
      layout: {
        ...draftSettings.layout,
        ...nextLayout,
      },
    });
  }

  function updateSftp(nextSftp: Partial<DevHubSettings["sftp"]>) {
    updateSettings({
      ...draftSettings,
      sftp: {
        ...draftSettings.sftp,
        ...nextSftp,
      },
    });
  }

  function updateTerminal(nextTerminal: Partial<DevHubSettings["terminal"]>) {
    updateSettings({
      ...draftSettings,
      terminal: {
        ...draftSettings.terminal,
        ...nextTerminal,
      },
    });
  }

  function updateLogging(nextLogging: Partial<DevHubSettings["logging"]>) {
    updateSettings({
      ...draftSettings,
      logging: {
        ...draftSettings.logging,
        ...nextLogging,
      },
    });
  }

  function updateLogHighlight(nextLogHighlight: Partial<DevHubSettings["terminal"]["log_highlight"]>) {
    updateTerminal({
      log_highlight: {
        ...draftSettings.terminal.log_highlight,
        ...nextLogHighlight,
      },
    });
  }

  function updateLogHighlightRule(
    index: number,
    nextRule: Partial<DevHubSettings["terminal"]["log_highlight"]["rules"][number]>,
    shouldSave: boolean,
  ) {
    const nextRules = draftSettings.terminal.log_highlight.rules.map((rule, ruleIndex) =>
      ruleIndex === index ? { ...rule, ...nextRule } : rule,
    );
    if (shouldSave) {
      updateLogHighlight({ rules: nextRules });
      return;
    }
    setDraftSettings({
      ...draftSettings,
      terminal: {
        ...draftSettings.terminal,
        log_highlight: {
          ...draftSettings.terminal.log_highlight,
          rules: nextRules,
        },
      },
    });
  }

  function addLogHighlightRule() {
    updateLogHighlight({
      rules: [...draftSettings.terminal.log_highlight.rules, defaultLogHighlightRule],
    });
  }

  function removeLogHighlightRule(index: number) {
    updateLogHighlight({
      rules: draftSettings.terminal.log_highlight.rules.filter((_, ruleIndex) => ruleIndex !== index),
    });
  }

  function selectCategory(category: SettingsCategory) {
    setActiveCategory(category);
    sectionRefs.current[category]?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function categoryLabel(category: SettingsCategory) {
    const labels: Record<SettingsCategory, string> = {
      通用: t("settings.general"),
      外观: t("settings.appearance"),
      布局: t("settings.layout"),
      连接: t("settings.connections"),
      SFTP: "SFTP",
      日志: t("settings.logging"),
      快捷键: t("settings.shortcuts"),
      "settings.json": "settings.json",
    };
    return labels[category];
  }

  function categorySearchText(category: SettingsCategory) {
    const keywords: Record<SettingsCategory, string[]> = {
      通用: [
        t("settings.general"),
        t("settings.config_file"),
        t("settings.config_file_desc"),
        t("settings.edit_in_json"),
        "settings.json",
      ],
      外观: [
        t("settings.appearance"),
        t("settings.theme"),
        t("settings.language"),
        t("settings.ui_font"),
        t("settings.ui_font_size"),
        t("settings.terminal_font"),
        t("settings.terminal_font_size"),
        t("settings.terminal_log_highlight_auto"),
        t("settings.terminal_log_highlight_case"),
        t("settings.terminal_log_highlight_rules"),
      ],
      布局: [t("settings.layout"), t("settings.connection_panel_width")],
      连接: [t("settings.connections"), t("settings.connection_config"), t("settings.connection_config_desc")],
      SFTP: ["SFTP", t("settings.sftp_size_unit"), t("settings.sftp_size_unit_desc")],
      日志: [
        t("settings.logging"),
        t("settings.logging_enabled"),
        t("settings.logging_level"),
        t("settings.logging_retention_days"),
        t("settings.logging_include_sql"),
        t("settings.logging_directory"),
      ],
      快捷键: [t("settings.shortcuts"), t("settings.keymap_desc")],
      "settings.json": ["settings.json", t("settings.save")],
    };
    return keywords[category].join(" ").toLowerCase();
  }

  function isCategoryVisible(category: SettingsCategory) {
    const query = searchQuery.trim().toLowerCase();
    return !query || categorySearchText(category).includes(query);
  }

  const visibleNavItems = navItems.filter(isCategoryVisible);

  async function openLogDirectory() {
    await callBackend<void>("open_log_directory");
  }

  return (
    <section className="settings-panel" aria-label={t("settings.title")}>
      <aside className="settings-sidebar" aria-label={t("settings.categories")}>
        <input
          className="settings-search"
          type="search"
          placeholder={t("settings.search_placeholder")}
          aria-label={t("settings.search")}
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
        />
        <nav className="settings-nav">
          {visibleNavItems.map((item) => (
            <button key={item} type="button" aria-pressed={item === activeCategory} onClick={() => selectCategory(item)}>
              {categoryLabel(item)}
            </button>
          ))}
        </nav>
      </aside>

      <div className="settings-content">
        <header className="settings-panel__header">
          <div>
            <h1>{t("settings.title")}</h1>
            <p>{t("settings.description")}</p>
          </div>
          {error ? <p className="settings-panel__error">{error}</p> : null}
        </header>

        {isCategoryVisible("通用") ? (
        <section
          className="settings-section"
          aria-labelledby="settings-general-heading"
          ref={(element) => {
            sectionRefs.current["通用"] = element;
          }}
        >
          <header>
            <h2 id="settings-general-heading">{t("settings.general")}</h2>
          </header>
          <SettingsRow title={t("settings.config_file")} description={t("settings.config_file_desc")}>
            <button type="button" onClick={() => selectCategory("settings.json")}>
              {t("settings.edit_in_json")}
            </button>
          </SettingsRow>
        </section>
        ) : null}

        {isCategoryVisible("外观") ? (
        <section
          className="settings-section"
          aria-labelledby="settings-appearance-heading"
          ref={(element) => {
            sectionRefs.current["外观"] = element;
          }}
        >
          <header>
            <h2 id="settings-appearance-heading">{t("settings.appearance")}</h2>
          </header>
          <SettingsRow title={t("settings.theme")} description={t("settings.theme_desc")}>
            <select
              aria-label={t("settings.theme")}
              value={draftSettings.appearance.theme}
              onChange={(event) => updateAppearance({ theme: event.target.value as ThemeName })}
            >
              <option value="dark">Dark</option>
              <option value="light">Light</option>
              <option value="system">System</option>
            </select>
          </SettingsRow>
          <SettingsRow title={t("settings.language")} description={t("settings.language_desc")}>
            <select
              aria-label={t("settings.language")}
              value={draftSettings.appearance.language}
              onChange={(event) => updateAppearance({ language: event.target.value as LanguageSetting })}
            >
              <option value="system">{t("settings.language_system")}</option>
              <option value="zh-CN">{t("settings.language_zh")}</option>
              <option value="en-US">{t("settings.language_en")}</option>
            </select>
          </SettingsRow>
          <SettingsRow title={t("settings.ui_font")} description={t("settings.ui_font_desc")}>
            <FontSelect
              label={t("settings.ui_font")}
              value={draftSettings.appearance.ui_font_family}
              fonts={systemFonts}
              onChange={(font) => updateAppearance({ ui_font_family: font })}
            />
          </SettingsRow>
          <SettingsRow title={t("settings.ui_font_size")} description={t("settings.ui_font_size_desc")}>
            <input
              aria-label={t("settings.ui_font_size")}
              type="number"
              min={10}
              max={24}
              value={draftSettings.appearance.ui_font_size}
              onChange={(event) =>
                setDraftSettings({
                  ...draftSettings,
                  appearance: { ...draftSettings.appearance, ui_font_size: Number(event.target.value) },
                })
              }
              onBlur={(event) => updateAppearance({ ui_font_size: Number(event.target.value) })}
              onKeyDown={commitOnEnter}
            />
          </SettingsRow>
          <SettingsRow title={t("settings.terminal_font")} description={t("settings.terminal_font_desc")}>
            <FontSelect
              label={t("settings.terminal_font")}
              value={draftSettings.appearance.terminal_font_family}
              fonts={systemFonts}
              onChange={(font) => updateAppearance({ terminal_font_family: font })}
            />
          </SettingsRow>
          <SettingsRow title={t("settings.terminal_font_size")} description={t("settings.terminal_font_size_desc")}>
            <input
              aria-label={t("settings.terminal_font_size")}
              type="number"
              min={8}
              max={40}
              value={draftSettings.appearance.terminal_font_size}
              onChange={(event) =>
                setDraftSettings({
                  ...draftSettings,
                  appearance: { ...draftSettings.appearance, terminal_font_size: Number(event.target.value) },
                })
              }
              onBlur={(event) => updateAppearance({ terminal_font_size: Number(event.target.value) })}
              onKeyDown={commitOnEnter}
            />
          </SettingsRow>
          <SettingsRow title={t("settings.terminal_log_highlight_auto")} description={t("settings.terminal_log_highlight_auto_desc")}>
            <input
              aria-label={t("settings.terminal_log_highlight_auto")}
              type="checkbox"
              checked={draftSettings.terminal.log_highlight.auto_detect_tail}
              onChange={(event) => updateLogHighlight({ auto_detect_tail: event.target.checked })}
            />
          </SettingsRow>
          <SettingsRow title={t("settings.terminal_log_highlight_case")} description={t("settings.terminal_log_highlight_case_desc")}>
            <input
              aria-label={t("settings.terminal_log_highlight_case")}
              type="checkbox"
              checked={draftSettings.terminal.log_highlight.case_sensitive}
              onChange={(event) => updateLogHighlight({ case_sensitive: event.target.checked })}
            />
          </SettingsRow>
          <SettingsRow
            title={t("settings.terminal_log_highlight_rules")}
            description={t("settings.terminal_log_highlight_rules_desc")}
            isStacked
          >
            <div className="settings-log-rules">
              <button type="button" onClick={addLogHighlightRule}>
                {t("settings.terminal_log_highlight_add_rule")}
              </button>
              <div className="settings-log-rules__list">
                {draftSettings.terminal.log_highlight.rules.map((rule, index) => (
                  <div className="settings-log-rules__row" key={index}>
                    <input
                      aria-label={t("settings.terminal_log_highlight_rule_label", { index: index + 1 })}
                      value={rule.pattern}
                      onChange={(event) => updateLogHighlightRule(index, { pattern: event.target.value }, false)}
                      onBlur={(event) => updateLogHighlightRule(index, { pattern: event.target.value }, true)}
                      onKeyDown={commitOnEnter}
                    />
                    <input
                      aria-label={t("settings.terminal_log_highlight_color_label", { index: index + 1 })}
                      type="color"
                      value={rule.color}
                      onChange={(event) => updateLogHighlightRule(index, { color: event.target.value }, true)}
                    />
                    <button
                      type="button"
                      aria-label={t("settings.terminal_log_highlight_delete_rule", { index: index + 1 })}
                      onClick={() => removeLogHighlightRule(index)}
                    >
                      -
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </SettingsRow>
        </section>
        ) : null}

        {isCategoryVisible("布局") ? (
        <section
          className="settings-section"
          aria-labelledby="settings-layout-heading"
          ref={(element) => {
            sectionRefs.current["布局"] = element;
          }}
        >
          <header>
            <h2 id="settings-layout-heading">{t("settings.layout")}</h2>
          </header>
          <SettingsRow title={t("settings.connection_panel_width")} description={t("settings.connection_panel_width_desc")}>
            <input
              aria-label={t("settings.connection_panel_width")}
              type="number"
              min={220}
              max={520}
              value={draftSettings.layout.connection_sidebar_width}
              onChange={(event) =>
                setDraftSettings({
                  ...draftSettings,
                  layout: { ...draftSettings.layout, connection_sidebar_width: Number(event.target.value) },
                })
              }
              onBlur={(event) => updateLayout({ connection_sidebar_width: Number(event.target.value) })}
              onKeyDown={commitOnEnter}
            />
          </SettingsRow>
        </section>
        ) : null}

        {isCategoryVisible("连接") ? (
        <section
          className="settings-section"
          aria-labelledby="settings-connections-heading"
          ref={(element) => {
            sectionRefs.current["连接"] = element;
          }}
        >
          <header>
            <h2 id="settings-connections-heading">{t("settings.connections")}</h2>
          </header>
          <SettingsRow title={t("settings.connection_config")} description={t("settings.connection_config_desc")}>
            <span className="settings-value">{connectionSummary}</span>
          </SettingsRow>
        </section>
        ) : null}

        {isCategoryVisible("SFTP") ? (
        <section
          className="settings-section"
          aria-labelledby="settings-sftp-heading"
          ref={(element) => {
            sectionRefs.current["SFTP"] = element;
          }}
        >
          <header>
            <h2 id="settings-sftp-heading">SFTP</h2>
          </header>
          <SettingsRow title={t("settings.sftp_size_unit")} description={t("settings.sftp_size_unit_desc")}>
            <select
              aria-label={t("settings.sftp_size_unit_label")}
              value={draftSettings.sftp.file_size_unit}
              onChange={(event) => updateSftp({ file_size_unit: event.target.value as SftpFileSizeUnit })}
            >
              <option value="bytes">B</option>
              <option value="auto">B / KB / MB</option>
            </select>
          </SettingsRow>
        </section>
        ) : null}

        {isCategoryVisible("日志") ? (
        <section
          className="settings-section"
          aria-labelledby="settings-logging-heading"
          ref={(element) => {
            sectionRefs.current["日志"] = element;
          }}
        >
          <header>
            <h2 id="settings-logging-heading">{t("settings.logging")}</h2>
          </header>
          <SettingsRow title={t("settings.logging_enabled")} description={t("settings.logging_enabled_desc")}>
            <input
              aria-label={t("settings.logging_enabled")}
              type="checkbox"
              checked={draftSettings.logging.enabled}
              onChange={(event) => updateLogging({ enabled: event.target.checked })}
            />
          </SettingsRow>
          <SettingsRow title={t("settings.logging_level")} description={t("settings.logging_level_desc")}>
            <select
              aria-label={t("settings.logging_level")}
              value={draftSettings.logging.level}
              onChange={(event) => updateLogging({ level: event.target.value as LogLevel })}
            >
              <option value="debug">debug</option>
              <option value="info">info</option>
              <option value="warn">warn</option>
              <option value="error">error</option>
            </select>
          </SettingsRow>
          <SettingsRow title={t("settings.logging_retention_days")} description={t("settings.logging_retention_days_desc")}>
            <input
              aria-label={t("settings.logging_retention_days")}
              type="number"
              min={1}
              max={365}
              value={draftSettings.logging.retention_days}
              onChange={(event) =>
                setDraftSettings({
                  ...draftSettings,
                  logging: { ...draftSettings.logging, retention_days: Number(event.target.value) },
                })
              }
              onBlur={(event) => updateLogging({ retention_days: Number(event.target.value) })}
              onKeyDown={commitOnEnter}
            />
          </SettingsRow>
          <SettingsRow title={t("settings.logging_include_sql")} description={t("settings.logging_include_sql_desc")}>
            <input
              aria-label={t("settings.logging_include_sql")}
              type="checkbox"
              checked={draftSettings.logging.include_sql}
              onChange={(event) => updateLogging({ include_sql: event.target.checked })}
            />
          </SettingsRow>
          <SettingsRow title={t("settings.logging_directory")} description={t("settings.logging_directory_desc")}>
            <div className="settings-action-row">
              {onOpenLogs ? (
                <button type="button" onClick={onOpenLogs}>
                  {t("settings.view_logs")}
                </button>
              ) : null}
              <button type="button" onClick={openLogDirectory}>
                {t("settings.open_log_directory")}
              </button>
            </div>
          </SettingsRow>
        </section>
        ) : null}

        {isCategoryVisible("快捷键") ? (
        <div
          ref={(element) => {
            sectionRefs.current["快捷键"] = element;
          }}
        >
          <KeymapEditor />
        </div>
        ) : null}
        {isCategoryVisible("settings.json") ? (
        <div
          ref={(element) => {
            sectionRefs.current["settings.json"] = element;
          }}
        >
          <SettingsJsonEditor {...settingsState} resolvedTheme={resolvedTheme} />
        </div>
        ) : null}
      </div>
    </section>
  );
}
