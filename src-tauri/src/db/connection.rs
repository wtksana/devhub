use percent_encoding::{utf8_percent_encode, NON_ALPHANUMERIC};
use sqlx::{Connection, MySqlConnection, PgConnection};

use crate::models::settings::DatabaseConnectionSettings;

#[derive(Clone, Default)]
pub struct DatabaseConnectionManager;

impl DatabaseConnectionManager {
    pub async fn test_connection(
        &self,
        connection: &DatabaseConnectionSettings,
    ) -> Result<(), String> {
        let url = database_connection_url(connection)?;
        match connection.kind.as_str() {
            "mysql" => {
                let connection = MySqlConnection::connect(&url)
                    .await
                    .map_err(|error| error.to_string())?;
                connection.close().await.map_err(|error| error.to_string())
            }
            "postgresql" => {
                let connection = PgConnection::connect(&url)
                    .await
                    .map_err(|error| error.to_string())?;
                connection.close().await.map_err(|error| error.to_string())
            }
            kind => Err(format!("unsupported database connection kind: {kind}")),
        }
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

fn encode_url_part(value: &str) -> String {
    utf8_percent_encode(value, NON_ALPHANUMERIC).to_string()
}
