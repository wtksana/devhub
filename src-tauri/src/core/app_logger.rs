use crate::models::settings::LoggingSettings;
use chrono::{DateTime, Datelike, Duration, Local, NaiveDate};
use serde::Serialize;
use serde_json::{Map, Value};
use std::{
    fs::{self, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
    sync::Mutex,
};

pub struct AppLogger {
    app_dir: PathBuf,
    lock: Mutex<()>,
}

#[derive(Debug, Clone, Serialize)]
pub struct AppLogEntry {
    ts: DateTime<Local>,
    level: String,
    module: String,
    action: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    target: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    result: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    duration_ms: Option<u128>,
    #[serde(skip_serializing_if = "Option::is_none")]
    message: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    metadata: Option<Map<String, Value>>,
}

impl AppLogEntry {
    pub fn new(
        level: impl Into<String>,
        module: impl Into<String>,
        action: impl Into<String>,
    ) -> Self {
        Self {
            ts: Local::now(),
            level: level.into(),
            module: module.into(),
            action: action.into(),
            target: None,
            result: None,
            duration_ms: None,
            message: None,
            error: None,
            metadata: None,
        }
    }

    pub fn target(mut self, target: impl Into<String>) -> Self {
        self.target = Some(target.into());
        self
    }

    pub fn result(mut self, result: impl Into<String>) -> Self {
        self.result = Some(result.into());
        self
    }

    pub fn duration_ms(mut self, duration_ms: u128) -> Self {
        self.duration_ms = Some(duration_ms);
        self
    }

    pub fn message(mut self, message: impl Into<String>) -> Self {
        self.message = Some(message.into());
        self
    }

    pub fn error(mut self, error: impl Into<String>) -> Self {
        self.error = Some(error.into());
        self
    }

    pub fn metadata(mut self, metadata: Map<String, Value>) -> Self {
        self.metadata = Some(metadata);
        self
    }
}

impl AppLogger {
    pub fn new_for_dir(app_dir: PathBuf) -> Self {
        Self {
            app_dir,
            lock: Mutex::new(()),
        }
    }

    pub fn log_dir(&self) -> PathBuf {
        self.app_dir.join("logs")
    }

    pub fn write(&self, settings: &LoggingSettings, entry: AppLogEntry) -> Result<(), String> {
        if !settings.enabled || !should_log(&settings.level, &entry.level) {
            return Ok(());
        }

        let _guard = self.lock.lock().map_err(|error| error.to_string())?;
        fs::create_dir_all(self.log_dir()).map_err(|error| error.to_string())?;
        self.cleanup_old_logs(settings)?;

        let path = self.log_file_path(Local::now());
        let mut file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(path)
            .map_err(|error| error.to_string())?;
        let line = serde_json::to_string(&entry).map_err(|error| error.to_string())?;
        writeln!(file, "{line}").map_err(|error| error.to_string())
    }

    pub fn cleanup_old_logs(&self, settings: &LoggingSettings) -> Result<(), String> {
        let log_dir = self.log_dir();
        if !log_dir.exists() {
            return Ok(());
        }

        let cutoff =
            Local::now().date_naive() - Duration::days(i64::from(settings.retention_days));
        for entry in fs::read_dir(log_dir).map_err(|error| error.to_string())? {
            let entry = entry.map_err(|error| error.to_string())?;
            let path = entry.path();
            if should_remove_log_file(&path, cutoff) {
                let _ = fs::remove_file(path);
            }
        }

        Ok(())
    }

    fn log_file_path(&self, now: DateTime<Local>) -> PathBuf {
        self.log_dir().join(format!(
            "devhub-{:04}-{:02}-{:02}.log",
            now.year(),
            now.month(),
            now.day()
        ))
    }
}

fn should_log(configured: &str, entry: &str) -> bool {
    level_rank(entry) >= level_rank(configured)
}

fn level_rank(level: &str) -> u8 {
    match level {
        "debug" => 10,
        "info" => 20,
        "warn" => 30,
        "error" => 40,
        _ => 20,
    }
}

fn should_remove_log_file(path: &Path, cutoff: NaiveDate) -> bool {
    let Some(file_name) = path.file_name().and_then(|name| name.to_str()) else {
        return false;
    };
    if !file_name.starts_with("devhub-") || !file_name.ends_with(".log") {
        return false;
    }

    NaiveDate::parse_from_str(&file_name[7..17], "%Y-%m-%d")
        .map(|date| date < cutoff)
        .unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::settings::LoggingSettings;
    use serde_json::Value;
    use std::fs;

    fn settings() -> LoggingSettings {
        LoggingSettings {
            enabled: true,
            level: "info".to_string(),
            retention_days: 14,
            include_sql: false,
        }
    }

    #[test]
    fn writes_json_line_to_daily_log_file() {
        let temp_dir = tempfile::tempdir().unwrap();
        let logger = AppLogger::new_for_dir(temp_dir.path().to_path_buf());
        let entry = AppLogEntry::new("info", "sftp", "list_directory")
            .target("prod-web-01:/var/log")
            .result("success")
            .duration_ms(32);

        logger.write(&settings(), entry).unwrap();

        let log_dir = temp_dir.path().join("logs");
        let files: Vec<_> = fs::read_dir(&log_dir).unwrap().collect();
        assert_eq!(files.len(), 1);
        let content = fs::read_to_string(files[0].as_ref().unwrap().path()).unwrap();
        let value: Value = serde_json::from_str(content.trim()).unwrap();
        assert_eq!(value["level"], "info");
        assert_eq!(value["module"], "sftp");
        assert_eq!(value["action"], "list_directory");
        assert_eq!(value["target"], "prod-web-01:/var/log");
        assert_eq!(value["result"], "success");
        assert_eq!(value["duration_ms"], 32);
    }

    #[test]
    fn skips_entries_below_configured_level() {
        let temp_dir = tempfile::tempdir().unwrap();
        let logger = AppLogger::new_for_dir(temp_dir.path().to_path_buf());
        let mut config = settings();
        config.level = "warn".to_string();

        logger
            .write(
                &config,
                AppLogEntry::new("info", "redis", "list_keys").result("success"),
            )
            .unwrap();

        assert!(!temp_dir.path().join("logs").exists());
    }

    #[test]
    fn removes_log_files_older_than_retention_days() {
        let temp_dir = tempfile::tempdir().unwrap();
        let logger = AppLogger::new_for_dir(temp_dir.path().to_path_buf());
        let log_dir = logger.log_dir();
        fs::create_dir_all(&log_dir).unwrap();
        fs::write(log_dir.join("devhub-2000-01-01.log"), "{}\n").unwrap();

        let mut config = settings();
        config.retention_days = 1;
        logger.cleanup_old_logs(&config).unwrap();

        assert!(!log_dir.join("devhub-2000-01-01.log").exists());
    }
}
