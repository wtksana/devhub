// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
pub mod commands;
pub mod core;
pub mod models;

#[cfg(test)]
mod tests;

use crate::core::settings_store::SettingsStore;
use tauri::Manager;

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let app_dir = app.path().app_config_dir()?;
            app.manage(SettingsStore::new_for_dir(app_dir));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            greet,
            commands::settings::load_settings,
            commands::settings::save_settings
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
