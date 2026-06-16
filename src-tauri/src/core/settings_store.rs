use std::fs;
use std::path::PathBuf;

use serde_json::Value;
use thiserror::Error;

use crate::models::settings::DevHubSettings;

const SETTINGS_FILE: &str = "settings.json";
const KEYMAP_FILE: &str = "keymap.json";
const DEFAULT_KEYMAP: &str = "{\n  \"bindings\": []\n}\n";
const FORBIDDEN_KEYS: &[&str] = &[
    "password",
    "passphrase",
    "api_key",
    "apiKey",
    "private_key",
    "privateKey",
];

#[derive(Debug, Error)]
pub enum SettingsStoreError {
    #[error("settings contain sensitive field: {0}")]
    SensitiveField(String),
    #[error("settings io error: {0}")]
    Io(#[from] std::io::Error),
    #[error("settings json error: {0}")]
    Json(#[from] serde_json::Error),
}

#[derive(Clone)]
pub struct SettingsStore {
    base_dir: PathBuf,
}

impl SettingsStore {
    pub fn new_for_dir(base_dir: PathBuf) -> Self {
        Self { base_dir }
    }

    pub fn settings_path(&self) -> PathBuf {
        self.base_dir.join(SETTINGS_FILE)
    }

    pub fn keymap_path(&self) -> PathBuf {
        self.base_dir.join(KEYMAP_FILE)
    }

    pub fn load_or_create(&self) -> Result<DevHubSettings, SettingsStoreError> {
        fs::create_dir_all(&self.base_dir)?;
        self.ensure_keymap_exists()?;

        let settings_path = self.settings_path();
        if !settings_path.exists() {
            let settings = DevHubSettings::default();
            self.save(&settings)?;
            return Ok(settings);
        }

        let raw = fs::read_to_string(settings_path)?;
        let value: Value = serde_json::from_str(&raw)?;
        reject_sensitive_fields(&value)?;

        Ok(serde_json::from_value(value)?)
    }

    pub fn save(&self, settings: &DevHubSettings) -> Result<(), SettingsStoreError> {
        fs::create_dir_all(&self.base_dir)?;
        self.ensure_keymap_exists()?;

        let value = serde_json::to_value(settings)?;
        reject_sensitive_fields(&value)?;

        let mut json = serde_json::to_string_pretty(settings)?;
        json.push('\n');
        fs::write(self.settings_path(), json)?;

        Ok(())
    }

    fn ensure_keymap_exists(&self) -> Result<(), SettingsStoreError> {
        let keymap_path = self.keymap_path();
        if !keymap_path.exists() {
            fs::write(keymap_path, DEFAULT_KEYMAP)?;
        }

        Ok(())
    }
}

fn reject_sensitive_fields(value: &Value) -> Result<(), SettingsStoreError> {
    match value {
        Value::Object(object) => {
            for (key, value) in object {
                if FORBIDDEN_KEYS.contains(&key.as_str()) {
                    return Err(SettingsStoreError::SensitiveField(key.clone()));
                }
                reject_sensitive_fields(value)?;
            }
        }
        Value::Array(items) => {
            for item in items {
                reject_sensitive_fields(item)?;
            }
        }
        _ => {}
    }

    Ok(())
}
