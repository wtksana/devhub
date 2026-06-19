// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
pub mod commands;
pub mod core;
pub mod models;
pub mod ssh;

#[cfg(test)]
mod tests;

use crate::core::credential_store::CredentialStore;
use crate::core::settings_store::SettingsStore;
use crate::core::window_state::{WindowState, WindowStateStore};
use crate::ssh::session_manager::SessionManager;
use crate::ssh::sftp_manager::SftpSessionManager;
use tauri::image::Image;
use tauri::{LogicalSize, Manager, WindowEvent};

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
            let app_dir = app.path().app_config_dir()?;
            if let Some(window) = app.get_webview_window("main") {
                let icon = Image::from_bytes(include_bytes!("../icons/128x128.png"))?;
                window.set_icon(icon)?;

                let window_state_store = WindowStateStore::new_for_dir(app_dir.clone());
                match window_state_store.load() {
                    Ok(Some(state)) => {
                        window.set_size(LogicalSize::new(
                            f64::from(state.width),
                            f64::from(state.height),
                        ))?;
                        window.center()?;
                    }
                    Ok(None) => {}
                    Err(error) => eprintln!("[devhub] load window state failed: {error}"),
                }

                let window_state_store = window_state_store.clone();
                let window_for_state = window.clone();
                window.on_window_event(move |event| {
                    if matches!(event, WindowEvent::CloseRequested { .. }) {
                        save_current_window_state(&window_for_state, &window_state_store);
                    }
                });
            }

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
            commands::redis::test_redis_connection,
            commands::redis::test_redis_connection_config,
            commands::redis::list_redis_keys,
            commands::redis::get_redis_key_value,
            commands::redis::set_redis_string_value,
            commands::redis::create_redis_key,
            commands::redis::delete_redis_key,
            commands::redis::set_redis_key_ttl,
            commands::redis::persist_redis_key,
            commands::redis::rename_redis_key,
            commands::terminal::open_terminal,
            commands::terminal::write_terminal,
            commands::terminal::resize_terminal,
            commands::terminal::close_terminal,
            commands::sftp::open_sftp_session,
            commands::sftp::get_local_path_kind,
            commands::sftp::close_sftp_session,
            commands::sftp::list_sftp_directory,
            commands::sftp::delete_sftp_path,
            commands::sftp::rename_sftp_path,
            commands::sftp::create_sftp_directory,
            commands::sftp::create_sftp_file,
            commands::sftp::compress_sftp_path,
            commands::sftp::compress_sftp_paths,
            commands::sftp::extract_sftp_archive,
            commands::sftp::read_sftp_text_file,
            commands::sftp::write_sftp_text_file,
            commands::sftp::upload_sftp_file,
            commands::sftp::download_sftp_file,
            commands::sftp::upload_sftp_directory,
            commands::sftp::download_sftp_directory,
            commands::sftp::cancel_sftp_transfer,
            commands::sftp::list_directory,
            commands::sftp::delete_path,
            commands::sftp::rename_path,
            commands::sftp::create_directory
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

fn save_current_window_state(window: &tauri::WebviewWindow, window_state_store: &WindowStateStore) {
    if window.is_minimized().unwrap_or(false) || window.is_maximized().unwrap_or(false) {
        return;
    }

    let Ok(size) = window.inner_size() else {
        return;
    };
    let scale_factor = window.scale_factor().unwrap_or(1.0);
    let logical_size = size.to_logical::<u32>(scale_factor);

    let Some(state) = WindowState::new(logical_size.width, logical_size.height) else {
        return;
    };

    if let Err(error) = window_state_store.save(&state) {
        eprintln!("[devhub] save window state failed: {error}");
    }
}
