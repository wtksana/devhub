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

const MAX_LOG_FIELD_LEN: usize = 2000;
const REDACTED: &str = "[REDACTED]";
const SENSITIVE_KEYS: &[&str] = &[
    "password",
    "passphrase",
    "private_key",
    "privateKey",
    "secret",
    "token",
    "authorization",
    "api_key",
    "apiKey",
];

pub struct AppLogger {
    app_dir: PathBuf,
    lock: Mutex<()>,
}

#[derive(Debug, Clone, Serialize)]
pub struct AppLogRecord {
    file_name: String,
    line_number: usize,
    raw: String,
    ts: Option<String>,
    level: Option<String>,
    module: Option<String>,
    action: Option<String>,
    target: Option<String>,
    result: Option<String>,
    duration_ms: Option<u64>,
    message: Option<String>,
    error: Option<String>,
    metadata: Option<Value>,
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

    fn sanitized(mut self) -> Self {
        self.target = self.target.map(|value| sanitize_string(&value));
        self.result = self.result.map(|value| sanitize_string(&value));
        self.message = self.message.map(|value| sanitize_string(&value));
        self.error = self.error.map(|value| sanitize_string(&value));
        self.metadata = self.metadata.map(sanitize_metadata);
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

        let entry = entry.sanitized();
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

    pub fn read_recent(&self, limit: usize) -> Result<Vec<AppLogRecord>, String> {
        let limit = limit.clamp(1, 2000);
        let log_dir = self.log_dir();
        if !log_dir.exists() {
            return Ok(Vec::new());
        }

        let mut log_files = fs::read_dir(log_dir)
            .map_err(|error| error.to_string())?
            .filter_map(|entry| entry.ok().map(|entry| entry.path()))
            .filter(|path| is_log_file(path))
            .collect::<Vec<_>>();
        log_files.sort_by(|left, right| right.file_name().cmp(&left.file_name()));

        let mut records = Vec::new();
        for path in log_files {
            let content = fs::read_to_string(&path).map_err(|error| error.to_string())?;
            let file_name = path
                .file_name()
                .and_then(|name| name.to_str())
                .unwrap_or_default()
                .to_string();
            let lines = content.lines().enumerate().collect::<Vec<_>>();
            for (line_index, line) in lines.into_iter().rev() {
                if records.len() >= limit {
                    return Ok(records);
                }
                if let Some(record) = parse_log_record(&file_name, line_index + 1, line) {
                    records.push(record);
                }
            }
        }

        Ok(records)
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

fn parse_log_record(file_name: &str, line_number: usize, line: &str) -> Option<AppLogRecord> {
    let value = serde_json::from_str::<Value>(line).ok()?;
    Some(AppLogRecord {
        file_name: file_name.to_string(),
        line_number,
        raw: line.to_string(),
        ts: string_field(&value, "ts"),
        level: string_field(&value, "level"),
        module: string_field(&value, "module"),
        action: string_field(&value, "action"),
        target: string_field(&value, "target"),
        result: string_field(&value, "result"),
        duration_ms: value.get("duration_ms").and_then(Value::as_u64),
        message: string_field(&value, "message"),
        error: string_field(&value, "error"),
        metadata: value.get("metadata").cloned(),
    })
}

fn string_field(value: &Value, key: &str) -> Option<String> {
    value.get(key).and_then(Value::as_str).map(str::to_string)
}

fn should_log(configured: &str, entry: &str) -> bool {
    level_rank(entry) >= level_rank(configured)
}

fn sanitize_metadata(metadata: Map<String, Value>) -> Map<String, Value> {
    metadata
        .into_iter()
        .map(|(key, value)| {
            if is_sensitive_key(&key) {
                (key, Value::String(REDACTED.to_string()))
            } else {
                (key, sanitize_value(value))
            }
        })
        .collect()
}

fn sanitize_value(value: Value) -> Value {
    match value {
        Value::String(value) => Value::String(sanitize_string(&value)),
        Value::Array(values) => Value::Array(values.into_iter().map(sanitize_value).collect()),
        Value::Object(values) => Value::Object(sanitize_metadata(values)),
        other => other,
    }
}

fn sanitize_string(value: &str) -> String {
    let sanitized = redact_url_passwords(value);
    let sanitized = redact_authorization(&sanitized);
    truncate_string(&sanitized)
}

fn redact_url_passwords(value: &str) -> String {
    let mut result = String::with_capacity(value.len());
    let mut rest = value;

    while let Some(scheme_index) = rest.find("://") {
        let (prefix, after_scheme) = rest.split_at(scheme_index + 3);
        result.push_str(prefix);
        rest = after_scheme;

        let next_separator = rest.find(['/', '?', '#'].as_ref()).unwrap_or(rest.len());
        let authority = &rest[..next_separator];
        if let Some(at_index) = authority.rfind('@') {
            let credentials = &authority[..at_index];
            if let Some(colon_index) = credentials.rfind(':') {
                result.push_str(&credentials[..=colon_index]);
                result.push_str(REDACTED);
                result.push_str(&authority[at_index..]);
                rest = &rest[next_separator..];
                continue;
            }
        }
    }

    result.push_str(rest);
    result
}

fn redact_authorization(value: &str) -> String {
    let lower = value.to_lowercase();
    if lower.contains("authorization") || lower.contains("bearer ") {
        return REDACTED.to_string();
    }
    value.to_string()
}

fn truncate_string(value: &str) -> String {
    if value.chars().count() <= MAX_LOG_FIELD_LEN {
        return value.to_string();
    }

    let truncated = value.chars().take(MAX_LOG_FIELD_LEN).collect::<String>();
    format!("{truncated}...[truncated]")
}

fn is_sensitive_key(key: &str) -> bool {
    SENSITIVE_KEYS
        .iter()
        .any(|sensitive| key.eq_ignore_ascii_case(sensitive))
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
    if !is_log_file(path) {
        return false;
    }
    let Some(file_name) = path.file_name().and_then(|name| name.to_str()) else {
        return false;
    };

    NaiveDate::parse_from_str(&file_name[7..17], "%Y-%m-%d")
        .map(|date| date < cutoff)
        .unwrap_or(false)
}

fn is_log_file(path: &Path) -> bool {
    let Some(file_name) = path.file_name().and_then(|name| name.to_str()) else {
        return false;
    };
    if !file_name.starts_with("devhub-") || !file_name.ends_with(".log") {
        return false;
    }

    NaiveDate::parse_from_str(&file_name[7..17], "%Y-%m-%d").is_ok()
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

    fn read_first_log_line(app_dir: &std::path::Path) -> String {
        let log_dir = app_dir.join("logs");
        let file = fs::read_dir(&log_dir)
            .unwrap()
            .next()
            .unwrap()
            .unwrap()
            .path();
        fs::read_to_string(file).unwrap().trim().to_string()
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

    #[test]
    fn reads_recent_log_records_from_newest_lines_first() {
        let temp_dir = tempfile::tempdir().unwrap();
        let logger = AppLogger::new_for_dir(temp_dir.path().to_path_buf());
        let log_dir = logger.log_dir();
        fs::create_dir_all(&log_dir).unwrap();
        fs::write(
            log_dir.join("devhub-2026-06-26.log"),
            r#"{"ts":"2026-06-26T10:00:00+08:00","level":"info","module":"sftp","action":"list_directory","result":"success"}"#,
        )
        .unwrap();
        fs::write(
            log_dir.join("devhub-2026-06-27.log"),
            [
                r#"{"ts":"2026-06-27T10:00:00+08:00","level":"warn","module":"redis","action":"list_keys","duration_ms":12}"#,
                r#"{"ts":"2026-06-27T10:01:00+08:00","level":"error","module":"database","action":"execute_query","error":"table missing","metadata":{"database":"app"}}"#,
            ]
            .join("\n"),
        )
        .unwrap();

        let records = logger.read_recent(2).unwrap();

        assert_eq!(records.len(), 2);
        assert_eq!(records[0].file_name, "devhub-2026-06-27.log");
        assert_eq!(records[0].line_number, 2);
        assert_eq!(records[0].level.as_deref(), Some("error"));
        assert_eq!(records[0].module.as_deref(), Some("database"));
        assert_eq!(records[0].error.as_deref(), Some("table missing"));
        assert_eq!(
            records[0].metadata.as_ref().unwrap()["database"].as_str(),
            Some("app"),
        );
        assert_eq!(records[1].line_number, 1);
        assert_eq!(records[1].duration_ms, Some(12));
    }

    #[test]
    fn redacts_sensitive_strings_before_writing() {
        let temp_dir = tempfile::tempdir().unwrap();
        let logger = AppLogger::new_for_dir(temp_dir.path().to_path_buf());
        let entry = AppLogEntry::new("error", "database", "execute_database_query")
            .target("mysql://root:secret-password@127.0.0.1/app")
            .message("authorization: Bearer abc123")
            .error("redis://:redis-password@127.0.0.1/0");

        logger.write(&settings(), entry).unwrap();

        let content = read_first_log_line(temp_dir.path());
        assert!(!content.contains("secret-password"));
        assert!(!content.contains("abc123"));
        assert!(!content.contains("redis-password"));
        assert!(content.contains("[REDACTED]"));
    }

    #[test]
    fn redacts_sensitive_metadata_and_truncates_long_values() {
        let temp_dir = tempfile::tempdir().unwrap();
        let logger = AppLogger::new_for_dir(temp_dir.path().to_path_buf());
        let mut metadata = serde_json::Map::new();
        metadata.insert(
            "password".to_string(),
            serde_json::Value::String("plain".to_string()),
        );
        metadata.insert(
            "sql_kind".to_string(),
            serde_json::Value::String("select".to_string()),
        );
        metadata.insert(
            "long".to_string(),
            serde_json::Value::String("x".repeat(3000)),
        );
        let entry = AppLogEntry::new("info", "frontend.database", "load")
            .result("failed")
            .metadata(metadata);

        logger.write(&settings(), entry).unwrap();

        let content = read_first_log_line(temp_dir.path());
        let value: Value = serde_json::from_str(&content).unwrap();
        assert_eq!(value["metadata"]["password"], "[REDACTED]");
        assert_eq!(value["metadata"]["sql_kind"], "select");
        assert!(value["metadata"]["long"].as_str().unwrap().len() <= 2015);
    }
}
