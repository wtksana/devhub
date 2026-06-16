import { useEffect, useState } from "react";
import Editor from "@monaco-editor/react";
import type { DevHubSettings } from "./settingsTypes";

interface SettingsJsonEditorProps {
  settings: DevHubSettings;
  rawJson: string;
  saveRawJson: (value: string) => Promise<void>;
}

export function SettingsJsonEditor({ rawJson, saveRawJson }: SettingsJsonEditorProps) {
  const [draft, setDraft] = useState(rawJson);

  useEffect(() => {
    setDraft(rawJson);
  }, [rawJson]);

  return (
    <section className="settings-json">
      <h2>settings.json</h2>
      <Editor
        height="360px"
        defaultLanguage="json"
        value={draft}
        theme="vs-dark"
        onChange={(value) => setDraft(value ?? "")}
        options={{ minimap: { enabled: false }, fontSize: 13 }}
      />
      <button type="button" onClick={() => void saveRawJson(draft)}>
        保存 settings.json
      </button>
    </section>
  );
}
