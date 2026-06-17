import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { SettingsJsonEditor } from "./SettingsJsonEditor";
import { KeymapEditor } from "./KeymapEditor";
import { useSettings } from "./useSettings";
import type { DevHubSettings, SftpFileSizeUnit, ThemeName } from "./settingsTypes";
import { callBackend } from "../../lib/tauri";

const navItems = ["通用", "外观", "布局", "连接", "SFTP", "快捷键", "settings.json"] as const;
type SettingsCategory = (typeof navItems)[number];
type SettingsState = ReturnType<typeof useSettings>;
const fallbackFonts = ["Inter", "Segoe UI", "Zed Sans", "JetBrains Mono", "Consolas"];

function SettingsRow({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <div className="settings-row">
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
}

export function SettingsPanel({ settingsState: providedSettingsState }: SettingsPanelProps) {
  if (providedSettingsState) {
    return <SettingsPanelView settingsState={providedSettingsState} />;
  }

  return <SettingsPanelWithLocalSettings />;
}

function SettingsPanelWithLocalSettings() {
  const settingsState = useSettings();
  return <SettingsPanelView settingsState={settingsState} />;
}

function SettingsPanelView({ settingsState }: { settingsState: SettingsState }) {
  const { settings, error, saveSettings } = settingsState;
  const [draftSettings, setDraftSettings] = useState(settings);
  const [activeCategory, setActiveCategory] = useState<SettingsCategory>("外观");
  const [systemFonts, setSystemFonts] = useState<string[]>(fallbackFonts);
  const sectionRefs = useRef<Record<SettingsCategory, HTMLElement | null>>({
    通用: null,
    外观: null,
    布局: null,
    连接: null,
    SFTP: null,
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
    if (draftSettings.connections.length === 0) return "还没有保存连接";
    return `${draftSettings.connections.length} 个连接`;
  }, [draftSettings.connections.length]);

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

  function selectCategory(category: SettingsCategory) {
    setActiveCategory(category);
    sectionRefs.current[category]?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <section className="settings-panel" aria-label="设置">
      <aside className="settings-sidebar" aria-label="设置分类">
        <input className="settings-search" type="search" placeholder="Search settings..." aria-label="搜索设置" />
        <nav className="settings-nav">
          {navItems.map((item) => (
            <button key={item} type="button" aria-pressed={item === activeCategory} onClick={() => selectCategory(item)}>
              {item}
            </button>
          ))}
        </nav>
      </aside>

      <div className="settings-content">
        <header className="settings-panel__header">
          <div>
            <h1>设置</h1>
            <p>图形界面和 settings.json 使用同一份配置；复制配置文件即可还原工作环境。</p>
          </div>
          {error ? <p className="settings-panel__error">{error}</p> : null}
        </header>

        <section
          className="settings-section"
          aria-labelledby="settings-general-heading"
          ref={(element) => {
            sectionRefs.current["通用"] = element;
          }}
        >
          <header>
            <h2 id="settings-general-heading">通用</h2>
          </header>
          <SettingsRow title="配置文件" description="可迁移设置写入 settings.json；复制配置文件即可还原工作环境。">
            <button type="button" onClick={() => selectCategory("settings.json")}>
              Edit in settings.json
            </button>
          </SettingsRow>
        </section>

        <section
          className="settings-section"
          aria-labelledby="settings-appearance-heading"
          ref={(element) => {
            sectionRefs.current["外观"] = element;
          }}
        >
          <header>
            <h2 id="settings-appearance-heading">外观</h2>
          </header>
          <SettingsRow title="主题" description="控制应用的颜色模式。">
            <select
              aria-label="主题"
              value={draftSettings.appearance.theme}
              onChange={(event) => updateAppearance({ theme: event.target.value as ThemeName })}
            >
              <option value="dark">Dark</option>
              <option value="light">Light</option>
              <option value="system">System</option>
            </select>
          </SettingsRow>
          <SettingsRow title="界面字体" description="用于工作台、设置页和普通 UI 文本。">
            <FontSelect
              label="界面字体"
              value={draftSettings.appearance.ui_font_family}
              fonts={systemFonts}
              onChange={(font) => updateAppearance({ ui_font_family: font })}
            />
          </SettingsRow>
          <SettingsRow title="界面字号" description="工作台 UI 文本字号，范围 10 到 24。">
            <input
              aria-label="界面字号"
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
          <SettingsRow title="终端字体" description="用于 SSH 终端和数据库查询结果中的等宽内容。">
            <FontSelect
              label="终端字体"
              value={draftSettings.appearance.terminal_font_family}
              fonts={systemFonts}
              onChange={(font) => updateAppearance({ terminal_font_family: font })}
            />
          </SettingsRow>
          <SettingsRow title="终端字号" description="终端文本字号，范围 8 到 40。">
            <input
              aria-label="终端字号"
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
        </section>

        <section
          className="settings-section"
          aria-labelledby="settings-layout-heading"
          ref={(element) => {
            sectionRefs.current["布局"] = element;
          }}
        >
          <header>
            <h2 id="settings-layout-heading">布局</h2>
          </header>
          <SettingsRow title="连接面板宽度" description="左侧连接面板宽度，范围 220 到 520。">
            <input
              aria-label="连接面板宽度"
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

        <section
          className="settings-section"
          aria-labelledby="settings-connections-heading"
          ref={(element) => {
            sectionRefs.current["连接"] = element;
          }}
        >
          <header>
            <h2 id="settings-connections-heading">连接</h2>
          </header>
          <SettingsRow title="连接配置" description="服务器、数据库和 Redis 连接会写入 settings.json。">
            <span className="settings-value">{connectionSummary}</span>
          </SettingsRow>
        </section>

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
          <SettingsRow title="文件大小单位" description="控制 SFTP 文件列表中的大小显示方式。">
            <select
              aria-label="SFTP 文件大小单位"
              value={draftSettings.sftp.file_size_unit}
              onChange={(event) => updateSftp({ file_size_unit: event.target.value as SftpFileSizeUnit })}
            >
              <option value="bytes">B</option>
              <option value="auto">B / KB / MB</option>
            </select>
          </SettingsRow>
        </section>

        <div
          ref={(element) => {
            sectionRefs.current["快捷键"] = element;
          }}
        >
          <KeymapEditor />
        </div>
        <div
          ref={(element) => {
            sectionRefs.current["settings.json"] = element;
          }}
        >
          <SettingsJsonEditor {...settingsState} />
        </div>
      </div>
    </section>
  );
}
