use tauri::State;

use crate::core::settings_store::SettingsStore;
use crate::models::settings::DevHubSettings;

#[tauri::command]
pub async fn load_settings(
    settings_store: State<'_, SettingsStore>,
) -> Result<DevHubSettings, String> {
    settings_store
        .load_or_create()
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn save_settings(
    settings_store: State<'_, SettingsStore>,
    settings: DevHubSettings,
) -> Result<(), String> {
    settings_store
        .save(&settings)
        .map_err(|error| error.to_string())
}
