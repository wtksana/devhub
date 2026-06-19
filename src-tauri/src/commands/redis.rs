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

#[derive(Debug, Clone, Deserialize)]
pub struct GetRedisKeyValueRequest {
    pub connection_id: String,
    pub database: u16,
    pub key: String,
    pub limit: Option<u32>,
    pub max_string_bytes: Option<u32>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct RedisKeyRequest {
    pub connection_id: String,
    pub database: u16,
    pub key: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct SetRedisStringValueRequest {
    pub connection_id: String,
    pub database: u16,
    pub key: String,
    pub value: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct SetRedisKeyTtlRequest {
    pub connection_id: String,
    pub database: u16,
    pub key: String,
    pub ttl_seconds: u32,
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

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct RedisKeyValueResponse {
    pub key: String,
    pub key_type: String,
    pub ttl: i64,
    pub value: RedisKeyValue,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum RedisKeyValue {
    String {
        value: String,
        truncated: bool,
        size: u64,
    },
    Hash {
        entries: Vec<(String, String)>,
        truncated: bool,
        length: u64,
    },
    List {
        items: Vec<String>,
        truncated: bool,
        length: u64,
    },
    Set {
        members: Vec<String>,
        truncated: bool,
        length: u64,
    },
    Zset {
        entries: Vec<(String, f64)>,
        truncated: bool,
        length: u64,
    },
    None {
        value: Option<String>,
        truncated: bool,
        size: u64,
    },
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct NormalizedListRedisKeysRequest {
    database: u16,
    pattern: String,
    count: u32,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct NormalizedGetRedisKeyValueRequest {
    database: u16,
    key: String,
    limit: u32,
    max_string_bytes: u32,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct NormalizedRedisKeyRequest {
    database: u16,
    key: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct NormalizedSetRedisStringValueRequest {
    database: u16,
    key: String,
    value: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct NormalizedSetRedisKeyTtlRequest {
    database: u16,
    key: String,
    ttl_seconds: u32,
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

#[tauri::command]
pub async fn get_redis_key_value(
    settings_store: State<'_, SettingsStore>,
    request: GetRedisKeyValueRequest,
) -> Result<RedisKeyValueResponse, String> {
    let mut connection = load_redis_connection(settings_store.inner(), &request.connection_id)?;
    let normalized = normalize_get_redis_key_value_request(&request)?;
    connection.database = normalized.database;

    tokio::task::spawn_blocking(move || {
        let client =
            Client::open(redis_connection_url(&connection)).map_err(|error| error.to_string())?;
        let mut redis_connection = client.get_connection().map_err(|error| error.to_string())?;
        load_redis_key_value(&mut redis_connection, &normalized)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn set_redis_string_value(
    settings_store: State<'_, SettingsStore>,
    request: SetRedisStringValueRequest,
) -> Result<(), String> {
    let mut connection = load_redis_connection(settings_store.inner(), &request.connection_id)?;
    let normalized = normalize_set_redis_string_value_request(&request)?;
    connection.database = normalized.database;

    tokio::task::spawn_blocking(move || {
        let client =
            Client::open(redis_connection_url(&connection)).map_err(|error| error.to_string())?;
        let mut redis_connection = client.get_connection().map_err(|error| error.to_string())?;
        redis::cmd("SET")
            .arg(&normalized.key)
            .arg(&normalized.value)
            .query::<()>(&mut redis_connection)
            .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn delete_redis_key(
    settings_store: State<'_, SettingsStore>,
    request: RedisKeyRequest,
) -> Result<(), String> {
    let mut connection = load_redis_connection(settings_store.inner(), &request.connection_id)?;
    let normalized = normalize_redis_key_request(&request)?;
    connection.database = normalized.database;

    tokio::task::spawn_blocking(move || {
        let client =
            Client::open(redis_connection_url(&connection)).map_err(|error| error.to_string())?;
        let mut redis_connection = client.get_connection().map_err(|error| error.to_string())?;
        redis::cmd("DEL")
            .arg(&normalized.key)
            .query::<u64>(&mut redis_connection)
            .map(|_| ())
            .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn set_redis_key_ttl(
    settings_store: State<'_, SettingsStore>,
    request: SetRedisKeyTtlRequest,
) -> Result<(), String> {
    let mut connection = load_redis_connection(settings_store.inner(), &request.connection_id)?;
    let normalized = normalize_set_redis_key_ttl_request(&request)?;
    connection.database = normalized.database;

    tokio::task::spawn_blocking(move || {
        let client =
            Client::open(redis_connection_url(&connection)).map_err(|error| error.to_string())?;
        let mut redis_connection = client.get_connection().map_err(|error| error.to_string())?;
        redis::cmd("EXPIRE")
            .arg(&normalized.key)
            .arg(normalized.ttl_seconds)
            .query::<bool>(&mut redis_connection)
            .map(|_| ())
            .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn persist_redis_key(
    settings_store: State<'_, SettingsStore>,
    request: RedisKeyRequest,
) -> Result<(), String> {
    let mut connection = load_redis_connection(settings_store.inner(), &request.connection_id)?;
    let normalized = normalize_redis_key_request(&request)?;
    connection.database = normalized.database;

    tokio::task::spawn_blocking(move || {
        let client =
            Client::open(redis_connection_url(&connection)).map_err(|error| error.to_string())?;
        let mut redis_connection = client.get_connection().map_err(|error| error.to_string())?;
        redis::cmd("PERSIST")
            .arg(&normalized.key)
            .query::<bool>(&mut redis_connection)
            .map(|_| ())
            .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

fn load_redis_key_value(
    redis_connection: &mut redis::Connection,
    request: &NormalizedGetRedisKeyValueRequest,
) -> Result<RedisKeyValueResponse, String> {
    let key_type = redis::cmd("TYPE")
        .arg(&request.key)
        .query::<String>(redis_connection)
        .map_err(|error| error.to_string())?;
    let ttl = redis::cmd("TTL")
        .arg(&request.key)
        .query::<i64>(redis_connection)
        .map_err(|error| error.to_string())?;
    let value = match key_type.as_str() {
        "string" => {
            load_redis_string_value(redis_connection, &request.key, request.max_string_bytes)?
        }
        "hash" => load_redis_hash_value(redis_connection, &request.key, request.limit)?,
        "list" => load_redis_list_value(redis_connection, &request.key, request.limit)?,
        "set" => load_redis_set_value(redis_connection, &request.key, request.limit)?,
        "zset" => load_redis_zset_value(redis_connection, &request.key, request.limit)?,
        "none" => RedisKeyValue::None {
            value: None,
            truncated: false,
            size: 0,
        },
        other => return Err(format!("unsupported redis key type: {other}")),
    };

    Ok(RedisKeyValueResponse {
        key: request.key.clone(),
        key_type,
        ttl,
        value,
    })
}

fn load_redis_string_value(
    redis_connection: &mut redis::Connection,
    key: &str,
    max_string_bytes: u32,
) -> Result<RedisKeyValue, String> {
    let size = redis::cmd("STRLEN")
        .arg(key)
        .query::<u64>(redis_connection)
        .map_err(|error| error.to_string())?;
    let end = max_string_bytes.saturating_sub(1);
    let bytes = redis::cmd("GETRANGE")
        .arg(key)
        .arg(0)
        .arg(end)
        .query::<Vec<u8>>(redis_connection)
        .map_err(|error| error.to_string())?;

    Ok(RedisKeyValue::String {
        value: String::from_utf8_lossy(&bytes).into_owned(),
        truncated: size > u64::from(max_string_bytes),
        size,
    })
}

fn load_redis_hash_value(
    redis_connection: &mut redis::Connection,
    key: &str,
    limit: u32,
) -> Result<RedisKeyValue, String> {
    let length = redis::cmd("HLEN")
        .arg(key)
        .query::<u64>(redis_connection)
        .map_err(|error| error.to_string())?;
    let mut entries = Vec::new();
    let mut cursor = 0_u64;
    while entries.len() < limit as usize {
        let (next_cursor, mut batch): (u64, Vec<(String, String)>) = redis::cmd("HSCAN")
            .arg(key)
            .cursor_arg(cursor)
            .arg("COUNT")
            .arg(limit)
            .query(redis_connection)
            .map_err(|error| error.to_string())?;
        entries.append(&mut batch);
        if next_cursor == 0 {
            break;
        }
        cursor = next_cursor;
    }
    entries.truncate(limit as usize);

    Ok(RedisKeyValue::Hash {
        truncated: length > entries.len() as u64,
        entries,
        length,
    })
}

fn load_redis_list_value(
    redis_connection: &mut redis::Connection,
    key: &str,
    limit: u32,
) -> Result<RedisKeyValue, String> {
    let length = redis::cmd("LLEN")
        .arg(key)
        .query::<u64>(redis_connection)
        .map_err(|error| error.to_string())?;
    let items = redis::cmd("LRANGE")
        .arg(key)
        .arg(0)
        .arg(limit.saturating_sub(1))
        .query::<Vec<String>>(redis_connection)
        .map_err(|error| error.to_string())?;

    Ok(RedisKeyValue::List {
        truncated: length > items.len() as u64,
        items,
        length,
    })
}

fn load_redis_set_value(
    redis_connection: &mut redis::Connection,
    key: &str,
    limit: u32,
) -> Result<RedisKeyValue, String> {
    let length = redis::cmd("SCARD")
        .arg(key)
        .query::<u64>(redis_connection)
        .map_err(|error| error.to_string())?;
    let mut members = Vec::new();
    let mut cursor = 0_u64;
    while members.len() < limit as usize {
        let (next_cursor, mut batch): (u64, Vec<String>) = redis::cmd("SSCAN")
            .arg(key)
            .cursor_arg(cursor)
            .arg("COUNT")
            .arg(limit)
            .query(redis_connection)
            .map_err(|error| error.to_string())?;
        members.append(&mut batch);
        if next_cursor == 0 {
            break;
        }
        cursor = next_cursor;
    }
    members.truncate(limit as usize);

    Ok(RedisKeyValue::Set {
        truncated: length > members.len() as u64,
        members,
        length,
    })
}

fn load_redis_zset_value(
    redis_connection: &mut redis::Connection,
    key: &str,
    limit: u32,
) -> Result<RedisKeyValue, String> {
    let length = redis::cmd("ZCARD")
        .arg(key)
        .query::<u64>(redis_connection)
        .map_err(|error| error.to_string())?;
    let entries = redis::cmd("ZRANGE")
        .arg(key)
        .arg(0)
        .arg(limit.saturating_sub(1))
        .arg("WITHSCORES")
        .query::<Vec<(String, f64)>>(redis_connection)
        .map_err(|error| error.to_string())?;

    Ok(RedisKeyValue::Zset {
        truncated: length > entries.len() as u64,
        entries,
        length,
    })
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

fn normalize_get_redis_key_value_request(
    request: &GetRedisKeyValueRequest,
) -> Result<NormalizedGetRedisKeyValueRequest, String> {
    let key = request.key.trim();
    if key.is_empty() {
        return Err("redis key is required".to_string());
    }

    Ok(NormalizedGetRedisKeyValueRequest {
        database: request.database,
        key: key.to_string(),
        limit: request.limit.unwrap_or(500).clamp(1, 5_000),
        max_string_bytes: request
            .max_string_bytes
            .unwrap_or(5 * 1024 * 1024)
            .clamp(1, 10 * 1024 * 1024),
    })
}

fn normalize_redis_key_request(
    request: &RedisKeyRequest,
) -> Result<NormalizedRedisKeyRequest, String> {
    let key = request.key.trim();
    if key.is_empty() {
        return Err("redis key is required".to_string());
    }

    Ok(NormalizedRedisKeyRequest {
        database: request.database,
        key: key.to_string(),
    })
}

fn normalize_set_redis_string_value_request(
    request: &SetRedisStringValueRequest,
) -> Result<NormalizedSetRedisStringValueRequest, String> {
    let key = request.key.trim();
    if key.is_empty() {
        return Err("redis key is required".to_string());
    }
    if request.value.len() > 10 * 1024 * 1024 {
        return Err("redis string value is too large".to_string());
    }

    Ok(NormalizedSetRedisStringValueRequest {
        database: request.database,
        key: key.to_string(),
        value: request.value.clone(),
    })
}

fn normalize_set_redis_key_ttl_request(
    request: &SetRedisKeyTtlRequest,
) -> Result<NormalizedSetRedisKeyTtlRequest, String> {
    let key = request.key.trim();
    if key.is_empty() {
        return Err("redis key is required".to_string());
    }
    if request.ttl_seconds == 0 {
        return Err("redis ttl must be greater than 0".to_string());
    }

    Ok(NormalizedSetRedisKeyTtlRequest {
        database: request.database,
        key: key.to_string(),
        ttl_seconds: request.ttl_seconds,
    })
}

#[cfg(test)]
mod tests {
    use super::{
        normalize_get_redis_key_value_request, normalize_list_redis_keys_request,
        normalize_redis_key_request, normalize_set_redis_key_ttl_request,
        normalize_set_redis_string_value_request, redis_connection_url, GetRedisKeyValueRequest,
        ListRedisKeysRequest, RedisKeyRequest, RedisKeyValue, SetRedisKeyTtlRequest,
        SetRedisStringValueRequest,
    };
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

    #[test]
    fn normalizes_redis_key_value_request_defaults() {
        let request = GetRedisKeyValueRequest {
            connection_id: "redis-local".to_string(),
            database: 3,
            key: " user:1 ".to_string(),
            limit: None,
            max_string_bytes: None,
        };

        let normalized = normalize_get_redis_key_value_request(&request).unwrap();

        assert_eq!(normalized.database, 3);
        assert_eq!(normalized.key, "user:1");
        assert_eq!(normalized.limit, 500);
        assert_eq!(normalized.max_string_bytes, 5 * 1024 * 1024);
    }

    #[test]
    fn normalizes_redis_key_value_request_bounds() {
        let request = GetRedisKeyValueRequest {
            connection_id: "redis-local".to_string(),
            database: 0,
            key: "key".to_string(),
            limit: Some(50_000),
            max_string_bytes: Some(50 * 1024 * 1024),
        };

        let normalized = normalize_get_redis_key_value_request(&request).unwrap();

        assert_eq!(normalized.limit, 5_000);
        assert_eq!(normalized.max_string_bytes, 10 * 1024 * 1024);
    }

    #[test]
    fn rejects_empty_redis_key_value_request_key() {
        let request = GetRedisKeyValueRequest {
            connection_id: "redis-local".to_string(),
            database: 0,
            key: "   ".to_string(),
            limit: None,
            max_string_bytes: None,
        };

        assert_eq!(
            normalize_get_redis_key_value_request(&request).unwrap_err(),
            "redis key is required"
        );
    }

    #[test]
    fn serializes_string_key_value_with_lowercase_kind() {
        let value = RedisKeyValue::String {
            value: "hello".to_string(),
            truncated: false,
            size: 5,
        };

        assert_eq!(
            serde_json::to_string(&value).unwrap(),
            r#"{"kind":"string","value":"hello","truncated":false,"size":5}"#
        );
    }

    #[test]
    fn normalizes_generic_redis_key_request() {
        let request = RedisKeyRequest {
            connection_id: "redis-local".to_string(),
            database: 1,
            key: " temp:1 ".to_string(),
        };

        let normalized = normalize_redis_key_request(&request).unwrap();

        assert_eq!(normalized.database, 1);
        assert_eq!(normalized.key, "temp:1");
    }

    #[test]
    fn normalizes_set_redis_string_value_request() {
        let request = SetRedisStringValueRequest {
            connection_id: "redis-local".to_string(),
            database: 2,
            key: " config:theme ".to_string(),
            value: "light".to_string(),
        };

        let normalized = normalize_set_redis_string_value_request(&request).unwrap();

        assert_eq!(normalized.database, 2);
        assert_eq!(normalized.key, "config:theme");
        assert_eq!(normalized.value, "light");
    }

    #[test]
    fn rejects_too_large_redis_string_value() {
        let request = SetRedisStringValueRequest {
            connection_id: "redis-local".to_string(),
            database: 0,
            key: "config:theme".to_string(),
            value: "x".repeat(10 * 1024 * 1024 + 1),
        };

        assert_eq!(
            normalize_set_redis_string_value_request(&request).unwrap_err(),
            "redis string value is too large"
        );
    }

    #[test]
    fn normalizes_set_redis_key_ttl_request() {
        let request = SetRedisKeyTtlRequest {
            connection_id: "redis-local".to_string(),
            database: 3,
            key: " session:1 ".to_string(),
            ttl_seconds: 60,
        };

        let normalized = normalize_set_redis_key_ttl_request(&request).unwrap();

        assert_eq!(normalized.database, 3);
        assert_eq!(normalized.key, "session:1");
        assert_eq!(normalized.ttl_seconds, 60);
    }

    #[test]
    fn rejects_zero_redis_key_ttl() {
        let request = SetRedisKeyTtlRequest {
            connection_id: "redis-local".to_string(),
            database: 0,
            key: "session:1".to_string(),
            ttl_seconds: 0,
        };

        assert_eq!(
            normalize_set_redis_key_ttl_request(&request).unwrap_err(),
            "redis ttl must be greater than 0"
        );
    }
}
