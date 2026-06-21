use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::{params, Connection};

use crate::models::database::DatabaseSqlFile;

#[derive(Clone)]
pub struct DatabaseSqlFileStore {
    db_path: Arc<PathBuf>,
    lock: Arc<Mutex<()>>,
}

impl DatabaseSqlFileStore {
    pub fn new_for_dir(app_dir: PathBuf) -> Self {
        Self {
            db_path: Arc::new(app_dir.join("devhub.db")),
            lock: Arc::new(Mutex::new(())),
        }
    }

    pub fn list(&self, connection_id: &str, database: &str) -> Result<Vec<DatabaseSqlFile>, String> {
        let _guard = self.lock.lock().map_err(|error| error.to_string())?;
        let connection = self.open()?;
        self.ensure_default(&connection, connection_id, database)?;

        let mut statement = connection
            .prepare(
                "SELECT name, content
                 FROM database_sql_files
                 WHERE connection_id = ?1 AND database_name = ?2
                 ORDER BY CASE WHEN name = 'default' THEN 0 ELSE 1 END, name ASC;",
            )
            .map_err(|error| error.to_string())?;

        let rows = statement
            .query_map(params![connection_id, database], |row| {
                Ok(DatabaseSqlFile {
                    name: row.get(0)?,
                    content: row.get(1)?,
                })
            })
            .map_err(|error| error.to_string())?;

        let mut files = Vec::new();
        for row in rows {
            files.push(row.map_err(|error| error.to_string())?);
        }
        Ok(files)
    }

    pub fn save(
        &self,
        connection_id: &str,
        database: &str,
        name: &str,
        content: &str,
    ) -> Result<(), String> {
        let _guard = self.lock.lock().map_err(|error| error.to_string())?;
        let connection = self.open()?;
        self.upsert(&connection, connection_id, database, name, content)
    }

    fn open(&self) -> Result<Connection, String> {
        let connection = Connection::open(self.db_path.as_ref()).map_err(|error| error.to_string())?;
        connection
            .execute_batch(
                "CREATE TABLE IF NOT EXISTS database_sql_files (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    connection_id TEXT NOT NULL,
                    database_name TEXT NOT NULL,
                    name TEXT NOT NULL,
                    content TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    UNIQUE(connection_id, database_name, name)
                );",
            )
            .map_err(|error| error.to_string())?;
        Ok(connection)
    }

    fn ensure_default(
        &self,
        connection: &Connection,
        connection_id: &str,
        database: &str,
    ) -> Result<(), String> {
        self.upsert_if_missing(connection, connection_id, database, "default", "")
    }

    fn upsert_if_missing(
        &self,
        connection: &Connection,
        connection_id: &str,
        database: &str,
        name: &str,
        content: &str,
    ) -> Result<(), String> {
        connection
            .execute(
                "INSERT OR IGNORE INTO database_sql_files (
                    connection_id, database_name, name, content, updated_at
                 ) VALUES (?1, ?2, ?3, ?4, ?5);",
                params![connection_id, database, name, content, now_timestamp()],
            )
            .map_err(|error| error.to_string())?;
        Ok(())
    }

    fn upsert(
        &self,
        connection: &Connection,
        connection_id: &str,
        database: &str,
        name: &str,
        content: &str,
    ) -> Result<(), String> {
        connection
            .execute(
                "INSERT INTO database_sql_files (
                    connection_id, database_name, name, content, updated_at
                 ) VALUES (?1, ?2, ?3, ?4, ?5)
                 ON CONFLICT(connection_id, database_name, name)
                 DO UPDATE SET content = excluded.content, updated_at = excluded.updated_at;",
                params![connection_id, database, name, content, now_timestamp()],
            )
            .map_err(|error| error.to_string())?;
        Ok(())
    }
}

fn now_timestamp() -> String {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs().to_string())
        .unwrap_or_else(|_| "0".to_string())
}
