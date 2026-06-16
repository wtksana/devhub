import { useCallback, useEffect, useMemo, useState } from "react";
import { callBackend } from "../../lib/tauri";
import { parseSettings } from "./settingsSchema";
import type { DevHubSettings } from "./settingsTypes";

const defaultSettings: DevHubSettings = {
  appearance: {
    theme: "dark",
    ui_font_family: "Inter",
    terminal_font_family: "JetBrains Mono",
    terminal_font_size: 14,
  },
  layout: {
    ai_panel: "right",
    connection_sidebar_width: 280,
    open_ai_panel_by_default: true,
  },
  connections: [],
  ai: {
    provider: "openai_compatible",
    base_url: "https://api.openai.com/v1",
    model: "gpt-4.1",
    api_key_ref: "ai:default",
  },
};

function getErrorMessage(caught: unknown): string {
  return caught instanceof Error ? caught.message : String(caught);
}

export function useSettings() {
  const [settings, setSettings] = useState<DevHubSettings>(defaultSettings);
  const [rawJson, setRawJson] = useState(() => JSON.stringify(defaultSettings, null, 2));
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const nextSettings = await callBackend<DevHubSettings>("load_settings");
      setSettings(nextSettings);
      setRawJson(JSON.stringify(nextSettings, null, 2));
      setError(null);
    } catch (caught) {
      setError(getErrorMessage(caught));
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const saveRawJson = useCallback(async (value: string) => {
    try {
      const parsed = parseSettings(JSON.parse(value));
      await callBackend<void>("save_settings", { settings: parsed });
      setSettings(parsed);
      setRawJson(JSON.stringify(parsed, null, 2));
      setError(null);
    } catch (caught) {
      setError(getErrorMessage(caught));
    }
  }, []);

  return useMemo(
    () => ({ settings, rawJson, error, saveRawJson, reload }),
    [settings, rawJson, error, saveRawJson, reload],
  );
}
