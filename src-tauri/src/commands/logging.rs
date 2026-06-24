use crate::core::app_logger::{AppLogEntry, AppLogger};
use crate::core::settings_store::SettingsStore;
use serde::Deserialize;
use serde_json::{Map, Value};
use std::time::Instant;
use tauri::{AppHandle, State};
use tauri_plugin_opener::OpenerExt;

#[derive(Debug, Deserialize)]
pub struct FrontendLogEntry {
    level: String,
    module: String,
    action: String,
    target: Option<String>,
    result: Option<String>,
    message: Option<String>,
    error: Option<String>,
    metadata: Option<Map<String, Value>>,
}

#[tauri::command]
pub fn get_log_directory(logger: State<'_, AppLogger>) -> Result<String, String> {
    Ok(logger.log_dir().to_string_lossy().to_string())
}

#[tauri::command]
pub fn open_log_directory(app: AppHandle, logger: State<'_, AppLogger>) -> Result<(), String> {
    let log_dir = logger.log_dir();
    std::fs::create_dir_all(&log_dir).map_err(|error| error.to_string())?;
    app.opener()
        .open_path(log_dir.to_string_lossy().to_string(), None::<&str>)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn write_app_log(
    settings_store: State<'_, SettingsStore>,
    logger: State<'_, AppLogger>,
    entry: FrontendLogEntry,
) -> Result<(), String> {
    let settings = settings_store
        .load_or_create()
        .map_err(|error| error.to_string())?;
    let mut log_entry = AppLogEntry::new(entry.level, entry.module, entry.action);

    if let Some(target) = entry.target {
        log_entry = log_entry.target(target);
    }
    if let Some(result) = entry.result {
        log_entry = log_entry.result(result);
    }
    if let Some(message) = entry.message {
        log_entry = log_entry.message(message);
    }
    if let Some(error) = entry.error {
        log_entry = log_entry.error(error);
    }
    if let Some(metadata) = entry.metadata {
        log_entry = log_entry.metadata(metadata);
    }

    logger.write(&settings.logging, log_entry)
}

pub fn log_operation(
    settings_store: &SettingsStore,
    logger: &AppLogger,
    level: &str,
    module: &str,
    action: &str,
    target: Option<String>,
    result: &str,
    started_at: Option<Instant>,
    error: Option<String>,
    metadata: Option<Map<String, Value>>,
) {
    let Ok(settings) = settings_store.load_or_create() else {
        return;
    };

    let mut entry = AppLogEntry::new(level, module, action).result(result);
    if let Some(target) = target {
        entry = entry.target(target);
    }
    if let Some(started_at) = started_at {
        entry = entry.duration_ms(started_at.elapsed().as_millis());
    }
    if let Some(error) = error {
        entry = entry.error(error);
    }
    if let Some(metadata) = metadata {
        entry = entry.metadata(metadata);
    }

    let _ = logger.write(&settings.logging, entry);
}

pub fn metadata(items: impl IntoIterator<Item = (&'static str, Value)>) -> Map<String, Value> {
    items
        .into_iter()
        .map(|(key, value)| (key.to_string(), value))
        .collect()
}

pub fn metadata_string(value: impl Into<String>) -> Value {
    Value::String(value.into())
}

pub fn metadata_number(value: impl Into<i64>) -> Value {
    Value::Number(value.into().into())
}

pub fn metadata_bool(value: bool) -> Value {
    Value::Bool(value)
}
