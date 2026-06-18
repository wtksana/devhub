use percent_encoding::{utf8_percent_encode, NON_ALPHANUMERIC};
use redis::Client;
use serde::{Deserialize, Serialize};
use tauri::State;

use crate::core::settings_store::SettingsStore;
use crate::models::settings::{ConnectionSettings, RedisConnectionSettings};

#[derive(Debug, Clone, Deserialize)]
pub struct ListRedisKeysRequest {
    pub connection_id: String,
    pub database: u16,
    pub pattern: Option<String>,
    pub count: Option<u32>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct RedisKeyEntry {
    pub key: String,
    pub key_type: String,
    pub ttl: i64,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct RedisKeyListResponse {
    pub total_count: u64,
    pub entries: Vec<RedisKeyEntry>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct NormalizedListRedisKeysRequest {
    database: u16,
    pattern: String,
    count: u32,
}

#[tauri::command]
pub async fn test_redis_connection(
    settings_store: State<'_, SettingsStore>,
    connection_id: String,
) -> Result<String, String> {
    let connection = load_redis_connection(settings_store.inner(), &connection_id)?;
    test_redis_connection_value(connection).await
}

#[tauri::command]
pub async fn test_redis_connection_config(
    connection: RedisConnectionSettings,
) -> Result<String, String> {
    test_redis_connection_value(connection).await
}

#[tauri::command]
pub async fn list_redis_keys(
    settings_store: State<'_, SettingsStore>,
    request: ListRedisKeysRequest,
) -> Result<RedisKeyListResponse, String> {
    let mut connection = load_redis_connection(settings_store.inner(), &request.connection_id)?;
    let normalized = normalize_list_redis_keys_request(&request);
    connection.database = normalized.database;

    tokio::task::spawn_blocking(move || {
        let client =
            Client::open(redis_connection_url(&connection)).map_err(|error| error.to_string())?;
        let mut redis_connection = client.get_connection().map_err(|error| error.to_string())?;
        let total_count = redis::cmd("DBSIZE")
            .query::<u64>(&mut redis_connection)
            .map_err(|error| error.to_string())?;
        let keys = scan_redis_keys(
            &mut redis_connection,
            &normalized.pattern,
            normalized.count as usize,
        )?;
        let metadata = load_redis_key_metadata(&mut redis_connection, &keys)?;
        let entries = keys
            .into_iter()
            .zip(metadata.chunks_exact(2))
            .map(|(key, metadata)| RedisKeyEntry {
                key,
                key_type: metadata[0].clone(),
                ttl: metadata[1].parse::<i64>().unwrap_or(-2),
            })
            .collect();

        Ok(RedisKeyListResponse {
            total_count,
            entries,
        })
    })
    .await
    .map_err(|error| error.to_string())?
}

fn scan_redis_keys(
    redis_connection: &mut redis::Connection,
    pattern: &str,
    limit: usize,
) -> Result<Vec<String>, String> {
    let mut cursor = 0_u64;
    let mut keys = Vec::new();

    loop {
        let remaining = limit.saturating_sub(keys.len());
        if remaining == 0 {
            break;
        }

        let count = remaining.min(1000);
        let (next_cursor, mut batch): (u64, Vec<String>) = redis::cmd("SCAN")
            .cursor_arg(cursor)
            .arg("MATCH")
            .arg(pattern)
            .arg("COUNT")
            .arg(count)
            .query(redis_connection)
            .map_err(|error| error.to_string())?;

        keys.append(&mut batch);
        if next_cursor == 0 {
            break;
        }
        cursor = next_cursor;
    }

    keys.truncate(limit);
    Ok(keys)
}

fn load_redis_key_metadata(
    redis_connection: &mut redis::Connection,
    keys: &[String],
) -> Result<Vec<String>, String> {
    if keys.is_empty() {
        return Ok(Vec::new());
    }

    let mut pipeline = redis::pipe();
    for key in keys {
        pipeline.cmd("TYPE").arg(key);
        pipeline.cmd("TTL").arg(key);
    }

    pipeline
        .query::<Vec<String>>(redis_connection)
        .map_err(|error| error.to_string())
}

async fn test_redis_connection_value(
    connection: RedisConnectionSettings,
) -> Result<String, String> {
    let url = redis_connection_url(&connection);

    tokio::task::spawn_blocking(move || {
        let client = Client::open(url).map_err(|error| error.to_string())?;
        let mut connection = client.get_connection().map_err(|error| error.to_string())?;
        redis::cmd("PING")
            .query::<String>(&mut connection)
            .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

fn load_redis_connection(
    settings_store: &SettingsStore,
    connection_id: &str,
) -> Result<RedisConnectionSettings, String> {
    let settings = settings_store
        .load_or_create()
        .map_err(|error| error.to_string())?;
    let connection = settings
        .connections
        .into_iter()
        .find(|connection| connection.id() == connection_id)
        .ok_or_else(|| format!("connection not found: {connection_id}"))?;

    match connection {
        ConnectionSettings::Redis(connection) => Ok(connection),
        ConnectionSettings::Ssh(_) => Err(format!(
            "connection is not a redis connection: {connection_id}"
        )),
    }
}

fn redis_connection_url(connection: &RedisConnectionSettings) -> String {
    let auth = connection
        .password
        .as_ref()
        .filter(|password| !password.is_empty())
        .map(|password| format!(":{}@", utf8_percent_encode(password, NON_ALPHANUMERIC)))
        .unwrap_or_default();

    format!(
        "redis://{auth}{}:{}/{}",
        connection.host, connection.port, connection.database
    )
}

fn normalize_list_redis_keys_request(
    request: &ListRedisKeysRequest,
) -> NormalizedListRedisKeysRequest {
    NormalizedListRedisKeysRequest {
        database: request.database,
        pattern: request
            .pattern
            .as_deref()
            .map(str::trim)
            .filter(|pattern| !pattern.is_empty())
            .unwrap_or("*")
            .to_string(),
        count: request.count.unwrap_or(5000).clamp(1, 50_000),
    }
}

#[cfg(test)]
mod tests {
    use super::{normalize_list_redis_keys_request, redis_connection_url, ListRedisKeysRequest};
    use crate::models::settings::RedisConnectionSettings;

    #[test]
    fn builds_redis_connection_url_with_database_and_encoded_password() {
        let connection = RedisConnectionSettings {
            id: "redis-local".to_string(),
            name: "Local Redis".to_string(),
            group: None,
            host: "127.0.0.1".to_string(),
            port: 6379,
            database: 2,
            password: Some("p@ss word".to_string()),
        };

        assert_eq!(
            redis_connection_url(&connection),
            "redis://:p%40ss%20word@127.0.0.1:6379/2"
        );
    }

    #[test]
    fn builds_redis_connection_url_without_auth_when_password_is_empty() {
        let connection = RedisConnectionSettings {
            id: "redis-local".to_string(),
            name: "Local Redis".to_string(),
            group: None,
            host: "127.0.0.1".to_string(),
            port: 6379,
            database: 0,
            password: Some(String::new()),
        };

        assert_eq!(
            redis_connection_url(&connection),
            "redis://127.0.0.1:6379/0"
        );
    }

    #[test]
    fn normalizes_redis_key_scan_request_defaults() {
        let request = ListRedisKeysRequest {
            connection_id: "redis-local".to_string(),
            database: 2,
            pattern: Some("   ".to_string()),
            count: None,
        };

        let normalized = normalize_list_redis_keys_request(&request);

        assert_eq!(normalized.database, 2);
        assert_eq!(normalized.pattern, "*");
        assert_eq!(normalized.count, 5000);
    }

    #[test]
    fn normalizes_redis_key_scan_request_count_bounds() {
        let request = ListRedisKeysRequest {
            connection_id: "redis-local".to_string(),
            database: 0,
            pattern: Some("user:*".to_string()),
            count: Some(100_000),
        };

        let normalized = normalize_list_redis_keys_request(&request);

        assert_eq!(normalized.pattern, "user:*");
        assert_eq!(normalized.count, 50_000);
    }
}
