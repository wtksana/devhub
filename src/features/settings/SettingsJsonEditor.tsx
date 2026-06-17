import { useEffect, useState } from "react";
import Editor from "@monaco-editor/react";
import type { DevHubSettings } from "./settingsTypes";

interface SettingsJsonEditorProps {
  settings: DevHubSettings;
  rawJson: string;
  saveRawJson: (value: string) => Promise<void>;
}

export function SettingsJsonEditor({ settings, rawJson, saveRawJson }: SettingsJsonEditorProps) {
  const [draft, setDraft] = useState(rawJson);

  useEffect(() => {
    setDraft(rawJson);
  }, [rawJson]);

  return (
    <section className="settings-json">
      <header>
        <h2>settings.json</h2>
        <button type="button" onClick={() => void saveRawJson(draft)}>
          保存
        </button>
      </header>
      <div className="settings-json__editor">
        <Editor
          height="100%"
          defaultLanguage="json"
          value={draft}
          theme="vs-dark"
          onChange={(value) => setDraft(value ?? "")}
          options={{
            minimap: { enabled: false },
            fontFamily: settings.appearance.ui_font_family,
            fontSize: 14,
            scrollBeyondLastLine: false,
            wordWrap: "on",
          }}
        />
      </div>
    </section>
  );
}
