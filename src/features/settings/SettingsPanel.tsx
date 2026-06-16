import { SettingsJsonEditor } from "./SettingsJsonEditor";
import { KeymapEditor } from "./KeymapEditor";
import { useSettings } from "./useSettings";

export function SettingsPanel() {
  const settingsState = useSettings();
  const { settings, error } = settingsState;

  return (
    <section className="settings-panel" aria-label="Settings">
      <header className="settings-panel__header">
        <h1>设置</h1>
        {error ? <p className="settings-panel__error">{error}</p> : null}
      </header>

      <div className="settings-panel__grid">
        <section>
          <h2>外观</h2>
          <p>主题：{settings.appearance.theme}</p>
          <p>界面字体：{settings.appearance.ui_font_family}</p>
          <p>终端字体：{settings.appearance.terminal_font_family}</p>
        </section>
        <section>
          <h2>布局</h2>
          <p>AI 面板：{settings.layout.ai_panel}</p>
          <p>连接栏宽度：{settings.layout.connection_sidebar_width}px</p>
        </section>
        <section>
          <h2>连接</h2>
          <p>{settings.connections.length} 个连接</p>
        </section>
        <section>
          <h2>AI</h2>
          <p>{settings.ai.provider}</p>
          <p>{settings.ai.model}</p>
        </section>
      </div>

      <SettingsJsonEditor {...settingsState} />
      <KeymapEditor />
    </section>
  );
}
