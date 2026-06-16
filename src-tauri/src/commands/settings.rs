use tauri::AppHandle;

use crate::core::app_paths;
use crate::core::settings_store::SettingsStore;
use crate::models::settings::DevHubSettings;

#[tauri::command]
pub async fn load_settings(app: AppHandle) -> Result<DevHubSettings, String> {
    let base_dir = app_paths::app_config_dir(&app).map_err(|error| error.to_string())?;
    SettingsStore::new_for_dir(base_dir)
        .load_or_create()
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn save_settings(app: AppHandle, settings: DevHubSettings) -> Result<(), String> {
    let base_dir = app_paths::app_config_dir(&app).map_err(|error| error.to_string())?;
    SettingsStore::new_for_dir(base_dir)
        .save(&settings)
        .map_err(|error| error.to_string())
}
