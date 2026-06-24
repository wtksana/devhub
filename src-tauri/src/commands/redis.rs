use percent_encoding::{utf8_percent_encode, NON_ALPHANUMERIC};
use redis::Client;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use tauri::State;

use crate::commands::logging::log_operation;
use crate::core::app_logger::AppLogger;
use crate::core::settings_store::SettingsStore;
use crate::models::settings::{ConnectionSettings, RedisConnectionSettings};

#[derive(Debug, Clone, Deserialize)]
pub struct ListRedisKeysRequest {
    pub connection_id: String,
    pub database: u16,
    pub pattern: Option<String>,
    pub count: Option<u32>,
    pub cursor: Option<u64>,
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
pub struct RedisKeysRequest {
    pub connection_id: String,
    pub database: u16,
    pub keys: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct SetRedisStringValueRequest {
    pub connection_id: String,
    pub database: u16,
    pub key: String,
    pub value: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct SetRedisHashFieldRequest {
    pub connection_id: String,
    pub database: u16,
    pub key: String,
    pub field: String,
    pub value: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct DeleteRedisHashFieldRequest {
    pub connection_id: String,
    pub database: u16,
    pub key: String,
    pub field: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct SetRedisListItemRequest {
    pub connection_id: String,
    pub database: u16,
    pub key: String,
    pub index: u32,
    pub value: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct DeleteRedisListItemRequest {
    pub connection_id: String,
    pub database: u16,
    pub key: String,
    pub index: u32,
}

#[derive(Debug, Clone, Deserialize)]
pub struct RedisSetMemberRequest {
    pub connection_id: String,
    pub database: u16,
    pub key: String,
    pub member: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct SetRedisZsetMemberRequest {
    pub connection_id: String,
    pub database: u16,
    pub key: String,
    pub member: String,
    pub score: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct DeleteRedisZsetMemberRequest {
    pub connection_id: String,
    pub database: u16,
    pub key: String,
    pub member: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct SetRedisKeyTtlRequest {
    pub connection_id: String,
    pub database: u16,
    pub key: String,
    pub ttl_seconds: u32,
}

#[derive(Debug, Clone, Deserialize)]
pub struct SetRedisKeysTtlRequest {
    pub connection_id: String,
    pub database: u16,
    pub keys: Vec<String>,
    pub ttl_seconds: u32,
}

#[derive(Debug, Clone, Deserialize)]
pub struct RenameRedisKeyRequest {
    pub connection_id: String,
    pub database: u16,
    pub key: String,
    pub new_key: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct RedisHashEntryRequest {
    pub field: String,
    pub value: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct RedisZsetEntryRequest {
    pub member: String,
    pub score: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct CreateRedisKeyRequest {
    pub connection_id: String,
    pub database: u16,
    pub key: String,
    pub key_type: String,
    pub ttl_seconds: Option<u32>,
    pub string_value: Option<String>,
    pub hash_entries: Option<Vec<RedisHashEntryRequest>>,
    pub list_items: Option<Vec<String>>,
    pub set_members: Option<Vec<String>>,
    pub zset_entries: Option<Vec<RedisZsetEntryRequest>>,
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
    pub next_cursor: u64,
}

#[derive(Clone, Default)]
pub struct RedisConnectionManager {
    connections: Arc<Mutex<HashMap<String, Arc<Mutex<redis::Connection>>>>>,
}

impl RedisConnectionManager {
    fn get_or_connect(&self, url: &str) -> Result<Arc<Mutex<redis::Connection>>, String> {
        let mut connections = self
            .connections
            .lock()
            .map_err(|_| "redis connection manager lock poisoned".to_string())?;
        if let Some(connection) = connections.get(url) {
            return Ok(Arc::clone(connection));
        }

        let client = Client::open(url).map_err(|error| error.to_string())?;
        let connection = client.get_connection().map_err(|error| error.to_string())?;
        let connection = Arc::new(Mutex::new(connection));
        connections.insert(url.to_string(), Arc::clone(&connection));
        Ok(connection)
    }

    fn remove(&self, url: &str) {
        if let Ok(mut connections) = self.connections.lock() {
            connections.remove(url);
        }
    }
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
    cursor: u64,
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
struct NormalizedRedisKeysRequest {
    database: u16,
    keys: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct NormalizedSetRedisStringValueRequest {
    database: u16,
    key: String,
    value: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct NormalizedSetRedisHashFieldRequest {
    database: u16,
    key: String,
    field: String,
    value: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct NormalizedDeleteRedisHashFieldRequest {
    database: u16,
    key: String,
    field: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct NormalizedSetRedisListItemRequest {
    database: u16,
    key: String,
    index: u32,
    value: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct NormalizedDeleteRedisListItemRequest {
    database: u16,
    key: String,
    index: u32,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct NormalizedRedisSetMemberRequest {
    database: u16,
    key: String,
    member: String,
}

#[derive(Debug, Clone, PartialEq)]
struct NormalizedSetRedisZsetMemberRequest {
    database: u16,
    key: String,
    member: String,
    score: f64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct NormalizedDeleteRedisZsetMemberRequest {
    database: u16,
    key: String,
    member: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct NormalizedSetRedisKeyTtlRequest {
    database: u16,
    key: String,
    ttl_seconds: u32,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct NormalizedSetRedisKeysTtlRequest {
    database: u16,
    keys: Vec<String>,
    ttl_seconds: u32,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct NormalizedRenameRedisKeyRequest {
    database: u16,
    key: String,
    new_key: String,
}

struct RedisKeyScanResult {
    keys: Vec<String>,
    next_cursor: u64,
}

#[derive(Debug, Clone, PartialEq)]
struct NormalizedCreateRedisKeyRequest {
    database: u16,
    key: String,
    value: NormalizedCreateRedisKeyValue,
    ttl_seconds: Option<u32>,
}

#[derive(Debug, Clone, PartialEq)]
enum NormalizedCreateRedisKeyValue {
    String(String),
    Hash(Vec<(String, String)>),
    List(Vec<String>),
    Set(Vec<String>),
    Zset(Vec<(String, f64)>),
}

#[tauri::command]
pub async fn test_redis_connection(
    settings_store: State<'_, SettingsStore>,
    logger: State<'_, AppLogger>,
    connection_id: String,
) -> Result<String, String> {
    let started_at = std::time::Instant::now();
    let connection = load_redis_connection(settings_store.inner(), &connection_id)?;
    let result = test_redis_connection_value(connection).await;
    match &result {
        Ok(_) => log_operation(
            settings_store.inner(),
            logger.inner(),
            "info",
            "redis",
            "test_redis_connection",
            Some(connection_id),
            "success",
            Some(started_at),
            None,
        ),
        Err(error) => log_operation(
            settings_store.inner(),
            logger.inner(),
            "error",
            "redis",
            "test_redis_connection",
            Some(connection_id),
            "failed",
            Some(started_at),
            Some(error.clone()),
        ),
    }
    result
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
    redis_manager: State<'_, RedisConnectionManager>,
    logger: State<'_, AppLogger>,
    request: ListRedisKeysRequest,
) -> Result<RedisKeyListResponse, String> {
    let started_at = std::time::Instant::now();
    let target = format!("{}:{}", request.connection_id, request.database);
    let mut connection = load_redis_connection(settings_store.inner(), &request.connection_id)?;
    let normalized = normalize_list_redis_keys_request(&request);
    connection.database = normalized.database;
    let redis_manager = redis_manager.inner().clone();

    let result = tokio::task::spawn_blocking(move || {
        with_redis_connection(&redis_manager, &connection, |redis_connection| {
            let total_count = redis::cmd("DBSIZE")
                .query::<u64>(redis_connection)
                .map_err(|error| error.to_string())?;
            let scan_result = scan_redis_keys(
                redis_connection,
                &normalized.pattern,
                normalized.count as usize,
                normalized.cursor,
            )?;
            let metadata = load_redis_key_metadata(redis_connection, &scan_result.keys)?;
            let entries = scan_result
                .keys
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
                next_cursor: scan_result.next_cursor,
            })
        })
    })
    .await
    .map_err(|error| error.to_string())?;
    match &result {
        Ok(_) => log_operation(
            settings_store.inner(),
            logger.inner(),
            "info",
            "redis",
            "list_redis_keys",
            Some(target),
            "success",
            Some(started_at),
            None,
        ),
        Err(error) => log_operation(
            settings_store.inner(),
            logger.inner(),
            "error",
            "redis",
            "list_redis_keys",
            Some(target),
            "failed",
            Some(started_at),
            Some(error.clone()),
        ),
    }
    result
}

#[tauri::command]
pub async fn get_redis_key_value(
    settings_store: State<'_, SettingsStore>,
    redis_manager: State<'_, RedisConnectionManager>,
    request: GetRedisKeyValueRequest,
) -> Result<RedisKeyValueResponse, String> {
    let mut connection = load_redis_connection(settings_store.inner(), &request.connection_id)?;
    let normalized = normalize_get_redis_key_value_request(&request)?;
    connection.database = normalized.database;
    let redis_manager = redis_manager.inner().clone();

    tokio::task::spawn_blocking(move || {
        with_redis_connection(&redis_manager, &connection, |redis_connection| {
            load_redis_key_value(redis_connection, &normalized)
        })
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn set_redis_string_value(
    settings_store: State<'_, SettingsStore>,
    redis_manager: State<'_, RedisConnectionManager>,
    request: SetRedisStringValueRequest,
) -> Result<(), String> {
    let mut connection = load_redis_connection(settings_store.inner(), &request.connection_id)?;
    let normalized = normalize_set_redis_string_value_request(&request)?;
    connection.database = normalized.database;
    let redis_manager = redis_manager.inner().clone();

    tokio::task::spawn_blocking(move || {
        with_redis_connection(&redis_manager, &connection, |redis_connection| {
            redis::cmd("SET")
                .arg(&normalized.key)
                .arg(&normalized.value)
                .query::<()>(redis_connection)
                .map_err(|error| error.to_string())
        })
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn set_redis_hash_field(
    settings_store: State<'_, SettingsStore>,
    redis_manager: State<'_, RedisConnectionManager>,
    request: SetRedisHashFieldRequest,
) -> Result<(), String> {
    let mut connection = load_redis_connection(settings_store.inner(), &request.connection_id)?;
    let normalized = normalize_set_redis_hash_field_request(&request)?;
    connection.database = normalized.database;
    let redis_manager = redis_manager.inner().clone();

    tokio::task::spawn_blocking(move || {
        with_redis_connection(&redis_manager, &connection, |redis_connection| {
            redis::cmd("HSET")
                .arg(&normalized.key)
                .arg(&normalized.field)
                .arg(&normalized.value)
                .query::<u64>(redis_connection)
                .map(|_| ())
                .map_err(|error| error.to_string())
        })
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn delete_redis_hash_field(
    settings_store: State<'_, SettingsStore>,
    redis_manager: State<'_, RedisConnectionManager>,
    request: DeleteRedisHashFieldRequest,
) -> Result<(), String> {
    let mut connection = load_redis_connection(settings_store.inner(), &request.connection_id)?;
    let normalized = normalize_delete_redis_hash_field_request(&request)?;
    connection.database = normalized.database;
    let redis_manager = redis_manager.inner().clone();

    tokio::task::spawn_blocking(move || {
        with_redis_connection(&redis_manager, &connection, |redis_connection| {
            redis::cmd("HDEL")
                .arg(&normalized.key)
                .arg(&normalized.field)
                .query::<u64>(redis_connection)
                .map(|_| ())
                .map_err(|error| error.to_string())
        })
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn set_redis_list_item(
    settings_store: State<'_, SettingsStore>,
    redis_manager: State<'_, RedisConnectionManager>,
    request: SetRedisListItemRequest,
) -> Result<(), String> {
    let mut connection = load_redis_connection(settings_store.inner(), &request.connection_id)?;
    let normalized = normalize_set_redis_list_item_request(&request)?;
    connection.database = normalized.database;
    let redis_manager = redis_manager.inner().clone();

    tokio::task::spawn_blocking(move || {
        with_redis_connection(&redis_manager, &connection, |redis_connection| {
            redis::cmd("LSET")
                .arg(&normalized.key)
                .arg(normalized.index)
                .arg(&normalized.value)
                .query::<()>(redis_connection)
                .map_err(|error| error.to_string())
        })
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn append_redis_list_item(
    settings_store: State<'_, SettingsStore>,
    redis_manager: State<'_, RedisConnectionManager>,
    request: SetRedisStringValueRequest,
) -> Result<(), String> {
    let mut connection = load_redis_connection(settings_store.inner(), &request.connection_id)?;
    let normalized = normalize_set_redis_string_value_request(&request)?;
    connection.database = normalized.database;
    let redis_manager = redis_manager.inner().clone();

    tokio::task::spawn_blocking(move || {
        with_redis_connection(&redis_manager, &connection, |redis_connection| {
            redis::cmd("RPUSH")
                .arg(&normalized.key)
                .arg(&normalized.value)
                .query::<u64>(redis_connection)
                .map(|_| ())
                .map_err(|error| error.to_string())
        })
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn delete_redis_list_item(
    settings_store: State<'_, SettingsStore>,
    redis_manager: State<'_, RedisConnectionManager>,
    request: DeleteRedisListItemRequest,
) -> Result<(), String> {
    let mut connection = load_redis_connection(settings_store.inner(), &request.connection_id)?;
    let normalized = normalize_delete_redis_list_item_request(&request)?;
    connection.database = normalized.database;
    let redis_manager = redis_manager.inner().clone();

    tokio::task::spawn_blocking(move || {
        with_redis_connection(&redis_manager, &connection, |redis_connection| {
            let marker = format!("__devhub_deleted_list_item__{}__", uuid::Uuid::new_v4());
            redis::cmd("LSET")
                .arg(&normalized.key)
                .arg(normalized.index)
                .arg(&marker)
                .query::<()>(redis_connection)
                .map_err(|error| error.to_string())?;
            redis::cmd("LREM")
                .arg(&normalized.key)
                .arg(1)
                .arg(&marker)
                .query::<i64>(redis_connection)
                .map(|_| ())
                .map_err(|error| error.to_string())
        })
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn add_redis_set_member(
    settings_store: State<'_, SettingsStore>,
    redis_manager: State<'_, RedisConnectionManager>,
    request: RedisSetMemberRequest,
) -> Result<(), String> {
    let mut connection = load_redis_connection(settings_store.inner(), &request.connection_id)?;
    let normalized = normalize_redis_set_member_request(&request)?;
    connection.database = normalized.database;
    let redis_manager = redis_manager.inner().clone();

    tokio::task::spawn_blocking(move || {
        with_redis_connection(&redis_manager, &connection, |redis_connection| {
            redis::cmd("SADD")
                .arg(&normalized.key)
                .arg(&normalized.member)
                .query::<u64>(redis_connection)
                .map(|_| ())
                .map_err(|error| error.to_string())
        })
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn delete_redis_set_member(
    settings_store: State<'_, SettingsStore>,
    redis_manager: State<'_, RedisConnectionManager>,
    request: RedisSetMemberRequest,
) -> Result<(), String> {
    let mut connection = load_redis_connection(settings_store.inner(), &request.connection_id)?;
    let normalized = normalize_redis_set_member_request(&request)?;
    connection.database = normalized.database;
    let redis_manager = redis_manager.inner().clone();

    tokio::task::spawn_blocking(move || {
        with_redis_connection(&redis_manager, &connection, |redis_connection| {
            redis::cmd("SREM")
                .arg(&normalized.key)
                .arg(&normalized.member)
                .query::<u64>(redis_connection)
                .map(|_| ())
                .map_err(|error| error.to_string())
        })
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn set_redis_zset_member(
    settings_store: State<'_, SettingsStore>,
    redis_manager: State<'_, RedisConnectionManager>,
    request: SetRedisZsetMemberRequest,
) -> Result<(), String> {
    let mut connection = load_redis_connection(settings_store.inner(), &request.connection_id)?;
    let normalized = normalize_set_redis_zset_member_request(&request)?;
    connection.database = normalized.database;
    let redis_manager = redis_manager.inner().clone();

    tokio::task::spawn_blocking(move || {
        with_redis_connection(&redis_manager, &connection, |redis_connection| {
            redis::cmd("ZADD")
                .arg(&normalized.key)
                .arg(normalized.score)
                .arg(&normalized.member)
                .query::<u64>(redis_connection)
                .map(|_| ())
                .map_err(|error| error.to_string())
        })
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn delete_redis_zset_member(
    settings_store: State<'_, SettingsStore>,
    redis_manager: State<'_, RedisConnectionManager>,
    request: DeleteRedisZsetMemberRequest,
) -> Result<(), String> {
    let mut connection = load_redis_connection(settings_store.inner(), &request.connection_id)?;
    let normalized = normalize_delete_redis_zset_member_request(&request)?;
    connection.database = normalized.database;
    let redis_manager = redis_manager.inner().clone();

    tokio::task::spawn_blocking(move || {
        with_redis_connection(&redis_manager, &connection, |redis_connection| {
            redis::cmd("ZREM")
                .arg(&normalized.key)
                .arg(&normalized.member)
                .query::<u64>(redis_connection)
                .map(|_| ())
                .map_err(|error| error.to_string())
        })
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn create_redis_key(
    settings_store: State<'_, SettingsStore>,
    redis_manager: State<'_, RedisConnectionManager>,
    request: CreateRedisKeyRequest,
) -> Result<(), String> {
    let mut connection = load_redis_connection(settings_store.inner(), &request.connection_id)?;
    let normalized = normalize_create_redis_key_request(&request)?;
    connection.database = normalized.database;
    let redis_manager = redis_manager.inner().clone();

    tokio::task::spawn_blocking(move || {
        with_redis_connection(&redis_manager, &connection, |redis_connection| {
            let exists = redis::cmd("EXISTS")
                .arg(&normalized.key)
                .query::<bool>(redis_connection)
                .map_err(|error| error.to_string())?;
            if exists {
                return Err("redis key already exists".to_string());
            }

            create_redis_key_value(redis_connection, &normalized)?;
            if let Some(ttl_seconds) = normalized.ttl_seconds {
                redis::cmd("EXPIRE")
                    .arg(&normalized.key)
                    .arg(ttl_seconds)
                    .query::<bool>(redis_connection)
                    .map_err(|error| error.to_string())?;
            }
            Ok(())
        })
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn delete_redis_key(
    settings_store: State<'_, SettingsStore>,
    redis_manager: State<'_, RedisConnectionManager>,
    request: RedisKeyRequest,
) -> Result<(), String> {
    let mut connection = load_redis_connection(settings_store.inner(), &request.connection_id)?;
    let normalized = normalize_redis_key_request(&request)?;
    connection.database = normalized.database;
    let redis_manager = redis_manager.inner().clone();

    tokio::task::spawn_blocking(move || {
        with_redis_connection(&redis_manager, &connection, |redis_connection| {
            redis::cmd("DEL")
                .arg(&normalized.key)
                .query::<u64>(redis_connection)
                .map(|_| ())
                .map_err(|error| error.to_string())
        })
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn delete_redis_keys(
    settings_store: State<'_, SettingsStore>,
    redis_manager: State<'_, RedisConnectionManager>,
    request: RedisKeysRequest,
) -> Result<(), String> {
    let mut connection = load_redis_connection(settings_store.inner(), &request.connection_id)?;
    let normalized = normalize_redis_keys_request(&request)?;
    connection.database = normalized.database;
    let redis_manager = redis_manager.inner().clone();

    tokio::task::spawn_blocking(move || {
        with_redis_connection(&redis_manager, &connection, |redis_connection| {
            let mut command = redis::cmd("DEL");
            for key in &normalized.keys {
                command.arg(key);
            }
            command
                .query::<u64>(redis_connection)
                .map(|_| ())
                .map_err(|error| error.to_string())
        })
    })
    .await
    .map_err(|error| error.to_string())?
}

fn create_redis_key_value(
    redis_connection: &mut redis::Connection,
    request: &NormalizedCreateRedisKeyRequest,
) -> Result<(), String> {
    match &request.value {
        NormalizedCreateRedisKeyValue::String(value) => redis::cmd("SET")
            .arg(&request.key)
            .arg(value)
            .query::<()>(redis_connection),
        NormalizedCreateRedisKeyValue::Hash(entries) => {
            let mut command = redis::cmd("HSET");
            command.arg(&request.key);
            for (field, value) in entries {
                command.arg(field).arg(value);
            }
            command.query::<()>(redis_connection)
        }
        NormalizedCreateRedisKeyValue::List(items) => {
            let mut command = redis::cmd("RPUSH");
            command.arg(&request.key);
            for item in items {
                command.arg(item);
            }
            command.query::<()>(redis_connection)
        }
        NormalizedCreateRedisKeyValue::Set(members) => {
            let mut command = redis::cmd("SADD");
            command.arg(&request.key);
            for member in members {
                command.arg(member);
            }
            command.query::<()>(redis_connection)
        }
        NormalizedCreateRedisKeyValue::Zset(entries) => {
            let mut command = redis::cmd("ZADD");
            command.arg(&request.key);
            for (member, score) in entries {
                command.arg(score).arg(member);
            }
            command.query::<()>(redis_connection)
        }
    }
    .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn set_redis_key_ttl(
    settings_store: State<'_, SettingsStore>,
    redis_manager: State<'_, RedisConnectionManager>,
    request: SetRedisKeyTtlRequest,
) -> Result<(), String> {
    let mut connection = load_redis_connection(settings_store.inner(), &request.connection_id)?;
    let normalized = normalize_set_redis_key_ttl_request(&request)?;
    connection.database = normalized.database;
    let redis_manager = redis_manager.inner().clone();

    tokio::task::spawn_blocking(move || {
        with_redis_connection(&redis_manager, &connection, |redis_connection| {
            redis::cmd("EXPIRE")
                .arg(&normalized.key)
                .arg(normalized.ttl_seconds)
                .query::<bool>(redis_connection)
                .map(|_| ())
                .map_err(|error| error.to_string())
        })
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn set_redis_keys_ttl(
    settings_store: State<'_, SettingsStore>,
    redis_manager: State<'_, RedisConnectionManager>,
    request: SetRedisKeysTtlRequest,
) -> Result<(), String> {
    let mut connection = load_redis_connection(settings_store.inner(), &request.connection_id)?;
    let normalized = normalize_set_redis_keys_ttl_request(&request)?;
    connection.database = normalized.database;
    let redis_manager = redis_manager.inner().clone();

    tokio::task::spawn_blocking(move || {
        with_redis_connection(&redis_manager, &connection, |redis_connection| {
            let mut pipeline = redis::pipe();
            for key in &normalized.keys {
                pipeline.cmd("EXPIRE").arg(key).arg(normalized.ttl_seconds);
            }
            pipeline
                .query::<Vec<bool>>(redis_connection)
                .map(|_| ())
                .map_err(|error| error.to_string())
        })
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn persist_redis_key(
    settings_store: State<'_, SettingsStore>,
    redis_manager: State<'_, RedisConnectionManager>,
    request: RedisKeyRequest,
) -> Result<(), String> {
    let mut connection = load_redis_connection(settings_store.inner(), &request.connection_id)?;
    let normalized = normalize_redis_key_request(&request)?;
    connection.database = normalized.database;
    let redis_manager = redis_manager.inner().clone();

    tokio::task::spawn_blocking(move || {
        with_redis_connection(&redis_manager, &connection, |redis_connection| {
            redis::cmd("PERSIST")
                .arg(&normalized.key)
                .query::<bool>(redis_connection)
                .map(|_| ())
                .map_err(|error| error.to_string())
        })
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn persist_redis_keys(
    settings_store: State<'_, SettingsStore>,
    redis_manager: State<'_, RedisConnectionManager>,
    request: RedisKeysRequest,
) -> Result<(), String> {
    let mut connection = load_redis_connection(settings_store.inner(), &request.connection_id)?;
    let normalized = normalize_redis_keys_request(&request)?;
    connection.database = normalized.database;
    let redis_manager = redis_manager.inner().clone();

    tokio::task::spawn_blocking(move || {
        with_redis_connection(&redis_manager, &connection, |redis_connection| {
            let mut pipeline = redis::pipe();
            for key in &normalized.keys {
                pipeline.cmd("PERSIST").arg(key);
            }
            pipeline
                .query::<Vec<bool>>(redis_connection)
                .map(|_| ())
                .map_err(|error| error.to_string())
        })
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn rename_redis_key(
    settings_store: State<'_, SettingsStore>,
    redis_manager: State<'_, RedisConnectionManager>,
    request: RenameRedisKeyRequest,
) -> Result<(), String> {
    let mut connection = load_redis_connection(settings_store.inner(), &request.connection_id)?;
    let normalized = normalize_rename_redis_key_request(&request)?;
    connection.database = normalized.database;
    let redis_manager = redis_manager.inner().clone();

    tokio::task::spawn_blocking(move || {
        with_redis_connection(&redis_manager, &connection, |redis_connection| {
            let renamed = redis::cmd("RENAMENX")
                .arg(&normalized.key)
                .arg(&normalized.new_key)
                .query::<bool>(redis_connection)
                .map_err(|error| error.to_string())?;
            if renamed {
                Ok(())
            } else {
                Err("redis target key already exists".to_string())
            }
        })
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
    start_cursor: u64,
) -> Result<RedisKeyScanResult, String> {
    scan_redis_keys_from_cursor(redis_connection, pattern, limit, start_cursor, 20)
}

fn scan_redis_keys_from_cursor(
    redis_connection: &mut redis::Connection,
    pattern: &str,
    limit: usize,
    start_cursor: u64,
    max_rounds: usize,
) -> Result<RedisKeyScanResult, String> {
    let mut cursor = start_cursor;
    let mut keys = Vec::new();
    let mut rounds = 0;

    loop {
        let remaining = limit.saturating_sub(keys.len());
        if remaining == 0 || rounds >= max_rounds {
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
        rounds += 1;
        if next_cursor == 0 {
            cursor = 0;
            break;
        }
        cursor = next_cursor;
    }

    keys.truncate(limit);
    Ok(RedisKeyScanResult {
        keys,
        next_cursor: cursor,
    })
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

fn with_redis_connection<T>(
    manager: &RedisConnectionManager,
    connection: &RedisConnectionSettings,
    action: impl FnOnce(&mut redis::Connection) -> Result<T, String>,
) -> Result<T, String> {
    let url = redis_connection_url(connection);
    let connection = manager.get_or_connect(&url)?;
    let result = {
        let mut redis_connection = connection
            .lock()
            .map_err(|_| "redis connection lock poisoned".to_string())?;
        action(&mut redis_connection)
    };
    if result.is_err() {
        manager.remove(&url);
    }
    result
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
        ConnectionSettings::Ssh(_)
        | ConnectionSettings::Mysql(_)
        | ConnectionSettings::Postgresql(_) => Err(format!(
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
        cursor: request.cursor.unwrap_or(0),
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

fn normalize_redis_keys_request(
    request: &RedisKeysRequest,
) -> Result<NormalizedRedisKeysRequest, String> {
    let mut keys = Vec::new();
    for key in &request.keys {
        let key = key.trim();
        if key.is_empty() || keys.iter().any(|existing| existing == key) {
            continue;
        }
        keys.push(key.to_string());
    }
    if keys.is_empty() {
        return Err("redis key is required".to_string());
    }
    if keys.len() > 5_000 {
        return Err("redis key count must be <= 5000".to_string());
    }

    Ok(NormalizedRedisKeysRequest {
        database: request.database,
        keys,
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

fn normalize_set_redis_hash_field_request(
    request: &SetRedisHashFieldRequest,
) -> Result<NormalizedSetRedisHashFieldRequest, String> {
    let key = request.key.trim();
    let field = request.field.trim();
    if key.is_empty() || field.is_empty() {
        return Err("redis key and field are required".to_string());
    }

    Ok(NormalizedSetRedisHashFieldRequest {
        database: request.database,
        key: key.to_string(),
        field: field.to_string(),
        value: request.value.clone(),
    })
}

fn normalize_delete_redis_hash_field_request(
    request: &DeleteRedisHashFieldRequest,
) -> Result<NormalizedDeleteRedisHashFieldRequest, String> {
    let key = request.key.trim();
    let field = request.field.trim();
    if key.is_empty() || field.is_empty() {
        return Err("redis key and field are required".to_string());
    }

    Ok(NormalizedDeleteRedisHashFieldRequest {
        database: request.database,
        key: key.to_string(),
        field: field.to_string(),
    })
}

fn normalize_set_redis_list_item_request(
    request: &SetRedisListItemRequest,
) -> Result<NormalizedSetRedisListItemRequest, String> {
    let key = request.key.trim();
    if key.is_empty() {
        return Err("redis key is required".to_string());
    }

    Ok(NormalizedSetRedisListItemRequest {
        database: request.database,
        key: key.to_string(),
        index: request.index,
        value: request.value.clone(),
    })
}

fn normalize_delete_redis_list_item_request(
    request: &DeleteRedisListItemRequest,
) -> Result<NormalizedDeleteRedisListItemRequest, String> {
    let key = request.key.trim();
    if key.is_empty() {
        return Err("redis key is required".to_string());
    }

    Ok(NormalizedDeleteRedisListItemRequest {
        database: request.database,
        key: key.to_string(),
        index: request.index,
    })
}

fn normalize_redis_set_member_request(
    request: &RedisSetMemberRequest,
) -> Result<NormalizedRedisSetMemberRequest, String> {
    let key = request.key.trim();
    let member = request.member.trim();
    if key.is_empty() || member.is_empty() {
        return Err("redis key and member are required".to_string());
    }

    Ok(NormalizedRedisSetMemberRequest {
        database: request.database,
        key: key.to_string(),
        member: member.to_string(),
    })
}

fn normalize_set_redis_zset_member_request(
    request: &SetRedisZsetMemberRequest,
) -> Result<NormalizedSetRedisZsetMemberRequest, String> {
    let key = request.key.trim();
    let member = request.member.trim();
    if key.is_empty() || member.is_empty() {
        return Err("redis key and member are required".to_string());
    }
    let score = request
        .score
        .trim()
        .parse::<f64>()
        .map_err(|_| "redis zset score must be a number".to_string())?;

    Ok(NormalizedSetRedisZsetMemberRequest {
        database: request.database,
        key: key.to_string(),
        member: member.to_string(),
        score,
    })
}

fn normalize_delete_redis_zset_member_request(
    request: &DeleteRedisZsetMemberRequest,
) -> Result<NormalizedDeleteRedisZsetMemberRequest, String> {
    let key = request.key.trim();
    let member = request.member.trim();
    if key.is_empty() || member.is_empty() {
        return Err("redis key and member are required".to_string());
    }

    Ok(NormalizedDeleteRedisZsetMemberRequest {
        database: request.database,
        key: key.to_string(),
        member: member.to_string(),
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

fn normalize_set_redis_keys_ttl_request(
    request: &SetRedisKeysTtlRequest,
) -> Result<NormalizedSetRedisKeysTtlRequest, String> {
    let normalized = normalize_redis_keys_request(&RedisKeysRequest {
        connection_id: request.connection_id.clone(),
        database: request.database,
        keys: request.keys.clone(),
    })?;
    if request.ttl_seconds == 0 {
        return Err("redis ttl must be greater than 0".to_string());
    }

    Ok(NormalizedSetRedisKeysTtlRequest {
        database: normalized.database,
        keys: normalized.keys,
        ttl_seconds: request.ttl_seconds,
    })
}

fn normalize_rename_redis_key_request(
    request: &RenameRedisKeyRequest,
) -> Result<NormalizedRenameRedisKeyRequest, String> {
    let key = request.key.trim();
    let new_key = request.new_key.trim();
    if key.is_empty() || new_key.is_empty() {
        return Err("redis key is required".to_string());
    }
    if key == new_key {
        return Err("redis new key must be different".to_string());
    }

    Ok(NormalizedRenameRedisKeyRequest {
        database: request.database,
        key: key.to_string(),
        new_key: new_key.to_string(),
    })
}

fn normalize_create_redis_key_request(
    request: &CreateRedisKeyRequest,
) -> Result<NormalizedCreateRedisKeyRequest, String> {
    let key = request.key.trim();
    if key.is_empty() {
        return Err("redis key is required".to_string());
    }
    let ttl_seconds = request.ttl_seconds;
    if ttl_seconds == Some(0) {
        return Err("redis ttl must be greater than 0".to_string());
    }

    let key_type = request.key_type.trim().to_ascii_lowercase();
    let value = match key_type.as_str() {
        "string" => {
            NormalizedCreateRedisKeyValue::String(request.string_value.clone().unwrap_or_default())
        }
        "hash" => NormalizedCreateRedisKeyValue::Hash(normalize_hash_entries(
            request.hash_entries.as_deref(),
        )),
        "list" => NormalizedCreateRedisKeyValue::List(normalize_string_items(
            request.list_items.as_deref(),
        )),
        "set" => NormalizedCreateRedisKeyValue::Set(normalize_string_items(
            request.set_members.as_deref(),
        )),
        "zset" => NormalizedCreateRedisKeyValue::Zset(normalize_zset_entries(
            request.zset_entries.as_deref(),
        )?),
        _ => return Err(format!("unsupported redis key type: {key_type}")),
    };

    Ok(NormalizedCreateRedisKeyRequest {
        database: request.database,
        key: key.to_string(),
        value,
        ttl_seconds,
    })
}

fn normalize_hash_entries(entries: Option<&[RedisHashEntryRequest]>) -> Vec<(String, String)> {
    let normalized: Vec<(String, String)> = entries
        .unwrap_or_default()
        .iter()
        .filter_map(|entry| {
            let field = entry.field.trim();
            if field.is_empty() {
                None
            } else {
                Some((field.to_string(), entry.value.clone()))
            }
        })
        .collect();

    if normalized.is_empty() {
        vec![("field".to_string(), String::new())]
    } else {
        normalized
    }
}

fn normalize_string_items(items: Option<&[String]>) -> Vec<String> {
    let normalized: Vec<String> = items
        .unwrap_or_default()
        .iter()
        .filter(|item| !item.is_empty())
        .cloned()
        .collect();

    if normalized.is_empty() {
        vec![String::new()]
    } else {
        normalized
    }
}

fn normalize_zset_entries(
    entries: Option<&[RedisZsetEntryRequest]>,
) -> Result<Vec<(String, f64)>, String> {
    let mut normalized = Vec::new();
    for entry in entries.unwrap_or_default() {
        if entry.member.is_empty() {
            continue;
        }
        let score = entry
            .score
            .trim()
            .parse::<f64>()
            .map_err(|_| "redis zset score must be a number".to_string())?;
        normalized.push((entry.member.clone(), score));
    }

    if normalized.is_empty() {
        Ok(vec![(String::new(), 0.0)])
    } else {
        Ok(normalized)
    }
}

#[cfg(test)]
mod tests {
    use super::{
        normalize_create_redis_key_request, normalize_delete_redis_hash_field_request,
        normalize_delete_redis_list_item_request, normalize_delete_redis_zset_member_request,
        normalize_get_redis_key_value_request, normalize_list_redis_keys_request,
        normalize_redis_key_request, normalize_redis_keys_request,
        normalize_redis_set_member_request, normalize_rename_redis_key_request,
        normalize_set_redis_hash_field_request, normalize_set_redis_key_ttl_request,
        normalize_set_redis_keys_ttl_request, normalize_set_redis_list_item_request,
        normalize_set_redis_string_value_request, normalize_set_redis_zset_member_request,
        redis_connection_url, CreateRedisKeyRequest, DeleteRedisHashFieldRequest,
        DeleteRedisListItemRequest, DeleteRedisZsetMemberRequest, GetRedisKeyValueRequest,
        ListRedisKeysRequest, NormalizedCreateRedisKeyValue, RedisHashEntryRequest,
        RedisKeyListResponse, RedisKeyRequest, RedisKeyValue, RedisKeysRequest,
        RedisSetMemberRequest, RedisZsetEntryRequest, RenameRedisKeyRequest,
        SetRedisHashFieldRequest, SetRedisKeyTtlRequest, SetRedisKeysTtlRequest,
        SetRedisListItemRequest, SetRedisStringValueRequest, SetRedisZsetMemberRequest,
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
            cursor: None,
        };

        let normalized = normalize_list_redis_keys_request(&request);

        assert_eq!(normalized.database, 2);
        assert_eq!(normalized.pattern, "*");
        assert_eq!(normalized.count, 5000);
        assert_eq!(normalized.cursor, 0);
    }

    #[test]
    fn normalizes_redis_key_scan_request_count_bounds() {
        let request = ListRedisKeysRequest {
            connection_id: "redis-local".to_string(),
            database: 0,
            pattern: Some("user:*".to_string()),
            count: Some(100_000),
            cursor: Some(42),
        };

        let normalized = normalize_list_redis_keys_request(&request);

        assert_eq!(normalized.pattern, "user:*");
        assert_eq!(normalized.count, 50_000);
        assert_eq!(normalized.cursor, 42);
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
    fn serializes_redis_key_list_next_cursor() {
        let response = RedisKeyListResponse {
            total_count: 10,
            entries: Vec::new(),
            next_cursor: 42,
        };

        let serialized = serde_json::to_string(&response).unwrap();

        assert!(serialized.contains("\"next_cursor\":42"));
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
    fn normalizes_bulk_redis_key_request_with_trim_and_deduplication() {
        let request = RedisKeysRequest {
            connection_id: "redis-local".to_string(),
            database: 1,
            keys: vec![
                " temp:1 ".to_string(),
                "temp:2".to_string(),
                "temp:1".to_string(),
                " ".to_string(),
            ],
        };

        let normalized = normalize_redis_keys_request(&request).unwrap();

        assert_eq!(normalized.database, 1);
        assert_eq!(
            normalized.keys,
            vec!["temp:1".to_string(), "temp:2".to_string()]
        );
    }

    #[test]
    fn rejects_empty_bulk_redis_key_request() {
        let request = RedisKeysRequest {
            connection_id: "redis-local".to_string(),
            database: 0,
            keys: vec![" ".to_string()],
        };

        assert_eq!(
            normalize_redis_keys_request(&request).unwrap_err(),
            "redis key is required"
        );
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
    fn normalizes_set_redis_hash_field_request() {
        let request = SetRedisHashFieldRequest {
            connection_id: "redis-local".to_string(),
            database: 1,
            key: " profile:1 ".to_string(),
            field: " name ".to_string(),
            value: "devhub".to_string(),
        };

        let normalized = normalize_set_redis_hash_field_request(&request).unwrap();

        assert_eq!(normalized.database, 1);
        assert_eq!(normalized.key, "profile:1");
        assert_eq!(normalized.field, "name");
        assert_eq!(normalized.value, "devhub");
    }

    #[test]
    fn rejects_empty_redis_hash_field_request() {
        let request = DeleteRedisHashFieldRequest {
            connection_id: "redis-local".to_string(),
            database: 0,
            key: "profile:1".to_string(),
            field: " ".to_string(),
        };

        assert_eq!(
            normalize_delete_redis_hash_field_request(&request).unwrap_err(),
            "redis key and field are required"
        );
    }

    #[test]
    fn normalizes_set_redis_list_item_request() {
        let request = SetRedisListItemRequest {
            connection_id: "redis-local".to_string(),
            database: 2,
            key: " queue ".to_string(),
            index: 3,
            value: "job".to_string(),
        };

        let normalized = normalize_set_redis_list_item_request(&request).unwrap();

        assert_eq!(normalized.database, 2);
        assert_eq!(normalized.key, "queue");
        assert_eq!(normalized.index, 3);
        assert_eq!(normalized.value, "job");
    }

    #[test]
    fn normalizes_delete_redis_list_item_request() {
        let request = DeleteRedisListItemRequest {
            connection_id: "redis-local".to_string(),
            database: 2,
            key: " queue ".to_string(),
            index: 1,
        };

        let normalized = normalize_delete_redis_list_item_request(&request).unwrap();

        assert_eq!(normalized.database, 2);
        assert_eq!(normalized.key, "queue");
        assert_eq!(normalized.index, 1);
    }

    #[test]
    fn normalizes_redis_set_member_request() {
        let request = RedisSetMemberRequest {
            connection_id: "redis-local".to_string(),
            database: 0,
            key: " tags ".to_string(),
            member: " prod ".to_string(),
        };

        let normalized = normalize_redis_set_member_request(&request).unwrap();

        assert_eq!(normalized.database, 0);
        assert_eq!(normalized.key, "tags");
        assert_eq!(normalized.member, "prod");
    }

    #[test]
    fn rejects_empty_redis_set_member_request() {
        let request = RedisSetMemberRequest {
            connection_id: "redis-local".to_string(),
            database: 0,
            key: "tags".to_string(),
            member: " ".to_string(),
        };

        assert_eq!(
            normalize_redis_set_member_request(&request).unwrap_err(),
            "redis key and member are required"
        );
    }

    #[test]
    fn normalizes_set_redis_zset_member_request() {
        let request = SetRedisZsetMemberRequest {
            connection_id: "redis-local".to_string(),
            database: 0,
            key: " rank ".to_string(),
            member: " alice ".to_string(),
            score: " 2.5 ".to_string(),
        };

        let normalized = normalize_set_redis_zset_member_request(&request).unwrap();

        assert_eq!(normalized.database, 0);
        assert_eq!(normalized.key, "rank");
        assert_eq!(normalized.member, "alice");
        assert_eq!(normalized.score, 2.5);
    }

    #[test]
    fn rejects_set_redis_zset_member_with_invalid_score() {
        let request = SetRedisZsetMemberRequest {
            connection_id: "redis-local".to_string(),
            database: 0,
            key: "rank".to_string(),
            member: "alice".to_string(),
            score: "bad".to_string(),
        };

        assert_eq!(
            normalize_set_redis_zset_member_request(&request).unwrap_err(),
            "redis zset score must be a number"
        );
    }

    #[test]
    fn normalizes_delete_redis_zset_member_request() {
        let request = DeleteRedisZsetMemberRequest {
            connection_id: "redis-local".to_string(),
            database: 0,
            key: " rank ".to_string(),
            member: " alice ".to_string(),
        };

        let normalized = normalize_delete_redis_zset_member_request(&request).unwrap();

        assert_eq!(normalized.database, 0);
        assert_eq!(normalized.key, "rank");
        assert_eq!(normalized.member, "alice");
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

    #[test]
    fn normalizes_set_redis_keys_ttl_request() {
        let request = SetRedisKeysTtlRequest {
            connection_id: "redis-local".to_string(),
            database: 3,
            keys: vec![" session:1 ".to_string(), "session:2".to_string()],
            ttl_seconds: 60,
        };

        let normalized = normalize_set_redis_keys_ttl_request(&request).unwrap();

        assert_eq!(normalized.database, 3);
        assert_eq!(
            normalized.keys,
            vec!["session:1".to_string(), "session:2".to_string()]
        );
        assert_eq!(normalized.ttl_seconds, 60);
    }

    #[test]
    fn rejects_zero_redis_keys_ttl() {
        let request = SetRedisKeysTtlRequest {
            connection_id: "redis-local".to_string(),
            database: 0,
            keys: vec!["session:1".to_string()],
            ttl_seconds: 0,
        };

        assert_eq!(
            normalize_set_redis_keys_ttl_request(&request).unwrap_err(),
            "redis ttl must be greater than 0"
        );
    }

    #[test]
    fn normalizes_rename_redis_key_request() {
        let request = RenameRedisKeyRequest {
            connection_id: "redis-local".to_string(),
            database: 1,
            key: " temp:1 ".to_string(),
            new_key: " temp:renamed ".to_string(),
        };

        let normalized = normalize_rename_redis_key_request(&request).unwrap();

        assert_eq!(normalized.database, 1);
        assert_eq!(normalized.key, "temp:1");
        assert_eq!(normalized.new_key, "temp:renamed");
    }

    #[test]
    fn rejects_rename_redis_key_to_same_key() {
        let request = RenameRedisKeyRequest {
            connection_id: "redis-local".to_string(),
            database: 1,
            key: "temp:1".to_string(),
            new_key: " temp:1 ".to_string(),
        };

        assert_eq!(
            normalize_rename_redis_key_request(&request).unwrap_err(),
            "redis new key must be different"
        );
    }

    #[test]
    fn normalizes_create_redis_hash_key_request() {
        let request = CreateRedisKeyRequest {
            connection_id: "redis-local".to_string(),
            database: 2,
            key: " user:1 ".to_string(),
            key_type: " hash ".to_string(),
            ttl_seconds: Some(60),
            string_value: None,
            hash_entries: Some(vec![
                RedisHashEntryRequest {
                    field: " name ".to_string(),
                    value: "devhub".to_string(),
                },
                RedisHashEntryRequest {
                    field: " ".to_string(),
                    value: "ignored".to_string(),
                },
            ]),
            list_items: None,
            set_members: None,
            zset_entries: None,
        };

        let normalized = normalize_create_redis_key_request(&request).unwrap();

        assert_eq!(normalized.database, 2);
        assert_eq!(normalized.key, "user:1");
        assert_eq!(normalized.ttl_seconds, Some(60));
        assert_eq!(
            normalized.value,
            NormalizedCreateRedisKeyValue::Hash(vec![("name".to_string(), "devhub".to_string())])
        );
    }

    #[test]
    fn rejects_create_redis_key_with_invalid_type() {
        let request = CreateRedisKeyRequest {
            connection_id: "redis-local".to_string(),
            database: 0,
            key: "user:1".to_string(),
            key_type: "stream".to_string(),
            ttl_seconds: None,
            string_value: None,
            hash_entries: None,
            list_items: None,
            set_members: None,
            zset_entries: None,
        };

        assert_eq!(
            normalize_create_redis_key_request(&request).unwrap_err(),
            "unsupported redis key type: stream"
        );
    }

    #[test]
    fn rejects_create_redis_key_with_zero_ttl() {
        let request = CreateRedisKeyRequest {
            connection_id: "redis-local".to_string(),
            database: 0,
            key: "user:1".to_string(),
            key_type: "string".to_string(),
            ttl_seconds: Some(0),
            string_value: Some("value".to_string()),
            hash_entries: None,
            list_items: None,
            set_members: None,
            zset_entries: None,
        };

        assert_eq!(
            normalize_create_redis_key_request(&request).unwrap_err(),
            "redis ttl must be greater than 0"
        );
    }

    #[test]
    fn rejects_create_redis_zset_key_with_invalid_score() {
        let request = CreateRedisKeyRequest {
            connection_id: "redis-local".to_string(),
            database: 0,
            key: "rank".to_string(),
            key_type: "zset".to_string(),
            ttl_seconds: None,
            string_value: None,
            hash_entries: None,
            list_items: None,
            set_members: None,
            zset_entries: Some(vec![RedisZsetEntryRequest {
                member: "alice".to_string(),
                score: "bad".to_string(),
            }]),
        };

        assert_eq!(
            normalize_create_redis_key_request(&request).unwrap_err(),
            "redis zset score must be a number"
        );
    }
}
