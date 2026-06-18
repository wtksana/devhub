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
use crate::ssh::sftp_manager::SftpSessionManager;
use tauri::image::Image;
use tauri::Manager;

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            if let Some(window) = app.get_webview_window("main") {
                let icon = Image::from_bytes(include_bytes!("../icons/128x128.png"))?;
                window.set_icon(icon)?;
            }

            let app_dir = app.path().app_config_dir()?;
            app.manage(SettingsStore::new_for_dir(app_dir));
            app.manage(CredentialStore::new("devhub"));
            app.manage(SessionManager::default());
            app.manage(SftpSessionManager::default());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            greet,
            commands::credentials::save_credential,
            commands::credentials::delete_credential,
            commands::settings::load_settings,
            commands::settings::save_settings,
            commands::settings::list_system_fonts,
            commands::terminal::open_terminal,
            commands::terminal::write_terminal,
            commands::terminal::resize_terminal,
            commands::terminal::close_terminal,
            commands::sftp::open_sftp_session,
            commands::sftp::close_sftp_session,
            commands::sftp::list_sftp_directory,
            commands::sftp::delete_sftp_path,
            commands::sftp::rename_sftp_path,
            commands::sftp::create_sftp_directory,
            commands::sftp::create_sftp_file,
            commands::sftp::compress_sftp_path,
            commands::sftp::extract_sftp_archive,
            commands::sftp::read_sftp_text_file,
            commands::sftp::write_sftp_text_file,
            commands::sftp::upload_sftp_file,
            commands::sftp::download_sftp_file,
            commands::sftp::upload_sftp_directory,
            commands::sftp::download_sftp_directory,
            commands::sftp::list_directory,
            commands::sftp::delete_path,
            commands::sftp::rename_path,
            commands::sftp::create_directory
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
