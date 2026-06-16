// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
pub mod commands;
pub mod core;
pub mod models;
pub mod ssh;

#[cfg(test)]
mod tests;

use crate::core::credential_store::CredentialStore;
use crate::core::settings_store::SettingsStore;
use crate::ssh::session_manager::SessionManager;
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
            app.manage(CredentialStore::new("devhub"));
            app.manage(SessionManager::default());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            greet,
            commands::credentials::save_credential,
            commands::credentials::delete_credential,
            commands::settings::load_settings,
            commands::settings::save_settings,
            commands::terminal::open_terminal,
            commands::terminal::write_terminal,
            commands::terminal::resize_terminal,
            commands::terminal::close_terminal
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
