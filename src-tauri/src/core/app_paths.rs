use std::path::PathBuf;

use tauri::{AppHandle, Manager};

pub fn app_config_dir(app: &AppHandle) -> Result<PathBuf, tauri::Error> {
    app.path().app_config_dir()
}
