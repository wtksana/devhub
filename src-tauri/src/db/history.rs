use std::fs;
use std::path::PathBuf;

use rusqlite::{params, Connection};

use crate::models::database::QueryHistoryItem;

const QUERY_HISTORY_KEEP: usize = 100;

#[derive(Debug, Clone)]
pub struct QueryHistoryStore {
    app_dir: PathBuf,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct QueryHistoryRecord {
    pub connection_id: String,
    pub database_kind: String,
    pub database_name: Option<String>,
    pub sql_text: String,
    pub duration_ms: u128,
    pub success: bool,
    pub error_message: Option<String>,
}

impl QueryHistoryStore {
    pub fn new_for_dir(app_dir: PathBuf) -> Self {
        Self { app_dir }
    }

    pub fn database_path(&self) -> PathBuf {
        self.app_dir.join("devhub.db")
    }

    pub fn record(&self, record: QueryHistoryRecord) -> Result<(), String> {
        let connection = self.open_connection()?;
        connection
            .execute(
                "INSERT INTO query_history (
                    connection_id,
                    database_kind,
                    database_name,
                    sql_text,
                    executed_at,
                    duration_ms,
                    success,
                    error_message
                ) VALUES (?1, ?2, ?3, ?4, datetime('now'), ?5, ?6, ?7)",
                params![
                    record.connection_id,
                    record.database_kind,
                    record.database_name,
                    record.sql_text,
                    u128_to_i64(record.duration_ms),
                    if record.success { 1 } else { 0 },
                    record.error_message,
                ],
            )
            .map_err(|error| error.to_string())?;
        self.trim(&connection, &record.connection_id)?;
        Ok(())
    }

    pub fn list(&self, connection_id: &str, limit: usize) -> Result<Vec<QueryHistoryItem>, String> {
        let connection = self.open_connection()?;
        let limit = limit.clamp(1, QUERY_HISTORY_KEEP);
        let mut statement = connection
            .prepare(
                "SELECT
                    id,
                    connection_id,
                    database_kind,
                    database_name,
                    sql_text,
                    executed_at,
                    duration_ms,
                    success,
                    error_message
                FROM query_history
                WHERE connection_id = ?1
                ORDER BY id DESC
                LIMIT ?2",
            )
            .map_err(|error| error.to_string())?;

        let rows = statement
            .query_map(params![connection_id, limit as i64], |row| {
                Ok(QueryHistoryItem {
                    id: row.get(0)?,
                    connection_id: row.get(1)?,
                    database_kind: row.get(2)?,
                    database_name: row.get(3)?,
                    sql_text: row.get(4)?,
                    executed_at: row.get(5)?,
                    duration_ms: row.get(6)?,
                    success: row.get::<_, i64>(7)? == 1,
                    error_message: row.get(8)?,
                })
            })
            .map_err(|error| error.to_string())?;

        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|error| error.to_string())
    }

    fn open_connection(&self) -> Result<Connection, String> {
        fs::create_dir_all(&self.app_dir).map_err(|error| error.to_string())?;
        let connection =
            Connection::open(self.database_path()).map_err(|error| error.to_string())?;
        init_schema(&connection)?;
        Ok(connection)
    }

    fn trim(&self, connection: &Connection, connection_id: &str) -> Result<(), String> {
        connection
            .execute(
                "DELETE FROM query_history
                WHERE connection_id = ?1
                  AND id NOT IN (
                    SELECT id FROM query_history
                    WHERE connection_id = ?1
                    ORDER BY id DESC
                    LIMIT ?2
                  )",
                params![connection_id, QUERY_HISTORY_KEEP as i64],
            )
            .map_err(|error| error.to_string())?;
        Ok(())
    }
}

fn init_schema(connection: &Connection) -> Result<(), String> {
    connection
        .execute_batch(
            "CREATE TABLE IF NOT EXISTS query_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                connection_id TEXT NOT NULL,
                database_kind TEXT NOT NULL,
                database_name TEXT,
                sql_text TEXT NOT NULL,
                executed_at TEXT NOT NULL,
                duration_ms INTEGER NOT NULL,
                success INTEGER NOT NULL,
                error_message TEXT
            );

            CREATE INDEX IF NOT EXISTS idx_query_history_connection_time
            ON query_history(connection_id, executed_at DESC);",
        )
        .map_err(|error| error.to_string())
}

fn u128_to_i64(value: u128) -> i64 {
    value.min(i64::MAX as u128) as i64
}
