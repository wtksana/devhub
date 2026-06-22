use percent_encoding::{utf8_percent_encode, NON_ALPHANUMERIC};
use sqlx::mysql::{MySqlPool, MySqlPoolOptions};
use sqlx::postgres::{PgPool, PgPoolOptions};
use std::collections::HashMap;
use std::sync::Mutex;
use std::time::Duration;

use crate::models::settings::DatabaseConnectionSettings;

const MAX_POOL_CONNECTIONS: u32 = 5;
const MIN_POOL_CONNECTIONS: u32 = 0;
const POOL_ACQUIRE_TIMEOUT_SECONDS: u64 = 10;
const POOL_IDLE_TIMEOUT_SECONDS: u64 = 300;

pub enum DatabasePool {
    Mysql(MySqlPool),
    Postgresql(PgPool),
}

impl Clone for DatabasePool {
    fn clone(&self) -> Self {
        match self {
            Self::Mysql(pool) => Self::Mysql(pool.clone()),
            Self::Postgresql(pool) => Self::Postgresql(pool.clone()),
        }
    }
}

#[derive(Default)]
pub struct DatabaseConnectionManager {
    pools: Mutex<HashMap<String, DatabasePool>>,
}

impl DatabaseConnectionManager {
    pub async fn test_connection(
        &self,
        connection: &DatabaseConnectionSettings,
    ) -> Result<(), String> {
        let pool = self.pool(connection, None).await?;
        match connection.kind.as_str() {
            "mysql" => {
                let DatabasePool::Mysql(pool) = pool else {
                    return Err("database pool kind mismatch".to_string());
                };
                pool.acquire().await.map_err(|error| error.to_string())?;
                Ok(())
            }
            "postgresql" => {
                let DatabasePool::Postgresql(pool) = pool else {
                    return Err("database pool kind mismatch".to_string());
                };
                pool.acquire().await.map_err(|error| error.to_string())?;
                Ok(())
            }
            kind => Err(format!("unsupported database connection kind: {kind}")),
        }
    }

    pub async fn pool(
        &self,
        connection: &DatabaseConnectionSettings,
        database_override: Option<&str>,
    ) -> Result<DatabasePool, String> {
        let key = database_pool_key(connection, database_override)?;
        if let Some(pool) = self
            .pools
            .lock()
            .map_err(|error| error.to_string())?
            .get(&key)
            .cloned()
        {
            return Ok(pool);
        }

        let url = database_connection_url(&connection_with_database_override(
            connection,
            database_override,
        ))?;
        let pool = match connection.kind.as_str() {
            "mysql" => DatabasePool::Mysql(
                MySqlPoolOptions::new()
                    .max_connections(MAX_POOL_CONNECTIONS)
                    .min_connections(MIN_POOL_CONNECTIONS)
                    .acquire_timeout(Duration::from_secs(POOL_ACQUIRE_TIMEOUT_SECONDS))
                    .idle_timeout(Duration::from_secs(POOL_IDLE_TIMEOUT_SECONDS))
                    .connect(&url)
                    .await
                    .map_err(|error| error.to_string())?,
            ),
            "postgresql" => DatabasePool::Postgresql(
                PgPoolOptions::new()
                    .max_connections(MAX_POOL_CONNECTIONS)
                    .min_connections(MIN_POOL_CONNECTIONS)
                    .acquire_timeout(Duration::from_secs(POOL_ACQUIRE_TIMEOUT_SECONDS))
                    .idle_timeout(Duration::from_secs(POOL_IDLE_TIMEOUT_SECONDS))
                    .connect(&url)
                    .await
                    .map_err(|error| error.to_string())?,
            ),
            kind => return Err(format!("unsupported database connection kind: {kind}")),
        };

        self.pools
            .lock()
            .map_err(|error| error.to_string())?
            .insert(key, pool.clone());
        Ok(pool)
    }
}

pub fn database_connection_url(connection: &DatabaseConnectionSettings) -> Result<String, String> {
    let scheme = match connection.kind.as_str() {
        "mysql" => "mysql",
        "postgresql" => "postgresql",
        kind => return Err(format!("unsupported database connection kind: {kind}")),
    };
    let username = encode_url_part(&connection.username);
    let password = encode_url_part(&connection.password);
    let database = connection
        .database
        .as_ref()
        .map(|database| database.trim())
        .filter(|database| !database.is_empty())
        .map(encode_url_part);

    Ok(match database {
        Some(database) => format!(
            "{scheme}://{username}:{password}@{}:{}/{}",
            connection.host, connection.port, database
        ),
        None => format!(
            "{scheme}://{username}:{password}@{}:{}",
            connection.host, connection.port
        ),
    })
}

pub fn database_pool_key(
    connection: &DatabaseConnectionSettings,
    database_override: Option<&str>,
) -> Result<String, String> {
    database_connection_url(&connection_with_database_override(
        connection,
        database_override,
    ))
}

pub fn connection_with_database_override(
    connection: &DatabaseConnectionSettings,
    database_override: Option<&str>,
) -> DatabaseConnectionSettings {
    let database = database_override
        .map(str::trim)
        .filter(|database| !database.is_empty())
        .map(str::to_string)
        .or_else(|| connection.database.clone());

    DatabaseConnectionSettings {
        database,
        ..connection.clone()
    }
}

fn encode_url_part(value: &str) -> String {
    utf8_percent_encode(value, NON_ALPHANUMERIC).to_string()
}
