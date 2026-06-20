use serde::de::Error as DeError;
use serde::ser::SerializeStruct;
use serde::{Deserialize, Deserializer, Serialize, Serializer};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct AppearanceSettings {
    pub theme: String,
    #[serde(default = "default_language")]
    pub language: String,
    pub ui_font_family: String,
    #[serde(default = "default_ui_font_size")]
    pub ui_font_size: u16,
    pub terminal_font_family: String,
    pub terminal_font_size: u16,
}

fn default_ui_font_size() -> u16 {
    13
}

fn default_language() -> String {
    "system".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct LayoutSettings {
    pub connection_sidebar_width: u16,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SftpSettings {
    #[serde(default = "default_sftp_file_size_unit")]
    pub file_size_unit: String,
}

fn default_sftp_file_size_unit() -> String {
    "bytes".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct TerminalLogHighlightRule {
    pub pattern: String,
    pub color: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct TerminalLogHighlightSettings {
    #[serde(default = "default_true")]
    pub auto_detect_tail: bool,
    #[serde(default)]
    pub case_sensitive: bool,
    #[serde(default = "default_log_highlight_rules")]
    pub rules: Vec<TerminalLogHighlightRule>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct TerminalSettings {
    #[serde(default)]
    pub log_highlight: TerminalLogHighlightSettings,
}

fn default_true() -> bool {
    true
}

fn default_log_highlight_rules() -> Vec<TerminalLogHighlightRule> {
    vec![
        TerminalLogHighlightRule {
            pattern: "\\bERROR\\b|Exception|Traceback".to_string(),
            color: "#e06c75".to_string(),
        },
        TerminalLogHighlightRule {
            pattern: "\\bWARN\\b".to_string(),
            color: "#e5c07b".to_string(),
        },
        TerminalLogHighlightRule {
            pattern: "\\bINFO\\b".to_string(),
            color: "#56b6c2".to_string(),
        },
        TerminalLogHighlightRule {
            pattern: "\\b\\d{4}-\\d{2}-\\d{2}[ T]\\d{2}:\\d{2}:\\d{2}\\b".to_string(),
            color: "#7f848e".to_string(),
        },
    ]
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "type")]
pub enum ConnectionAuthSettings {
    #[serde(rename = "password")]
    Password { password: String },
    #[serde(rename = "private_key")]
    PrivateKey {
        private_key_path: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        passphrase: Option<String>,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SshConnectionSettings {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub kind: Option<String>,
    pub id: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub group: Option<String>,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub auth: ConnectionAuthSettings,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RedisConnectionSettings {
    pub id: String,
    pub name: String,
    pub group: Option<String>,
    pub host: String,
    pub port: u16,
    pub database: u16,
    pub password: Option<String>,
}

impl Serialize for RedisConnectionSettings {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        let mut state = serializer.serialize_struct("RedisConnectionSettings", 8)?;
        state.serialize_field("kind", "redis")?;
        state.serialize_field("id", &self.id)?;
        state.serialize_field("name", &self.name)?;
        if let Some(group) = &self.group {
            state.serialize_field("group", group)?;
        }
        state.serialize_field("host", &self.host)?;
        state.serialize_field("port", &self.port)?;
        state.serialize_field("database", &self.database)?;
        if let Some(password) = &self.password {
            state.serialize_field("password", password)?;
        }
        state.end()
    }
}

impl<'de> Deserialize<'de> for RedisConnectionSettings {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        #[derive(Deserialize)]
        struct RedisConnectionSettingsValue {
            kind: String,
            id: String,
            name: String,
            group: Option<String>,
            host: String,
            port: u16,
            database: u16,
            password: Option<String>,
        }

        let value = RedisConnectionSettingsValue::deserialize(deserializer)?;
        if value.kind != "redis" {
            return Err(D::Error::custom("expected redis connection kind"));
        }
        Ok(Self {
            id: value.id,
            name: value.name,
            group: value.group,
            host: value.host,
            port: value.port,
            database: value.database,
            password: value.password,
        })
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(untagged)]
pub enum ConnectionSettings {
    Redis(RedisConnectionSettings),
    Ssh(SshConnectionSettings),
}

impl ConnectionSettings {
    pub fn id(&self) -> &str {
        match self {
            ConnectionSettings::Redis(connection) => &connection.id,
            ConnectionSettings::Ssh(connection) => &connection.id,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct DevHubSettings {
    pub appearance: AppearanceSettings,
    pub layout: LayoutSettings,
    #[serde(default)]
    pub sftp: SftpSettings,
    #[serde(default)]
    pub terminal: TerminalSettings,
    #[serde(default)]
    pub connection_groups: Vec<String>,
    pub connections: Vec<ConnectionSettings>,
}

impl Default for SftpSettings {
    fn default() -> Self {
        Self {
            file_size_unit: default_sftp_file_size_unit(),
        }
    }
}

impl Default for TerminalLogHighlightSettings {
    fn default() -> Self {
        Self {
            auto_detect_tail: true,
            case_sensitive: false,
            rules: default_log_highlight_rules(),
        }
    }
}

impl Default for TerminalSettings {
    fn default() -> Self {
        Self {
            log_highlight: TerminalLogHighlightSettings::default(),
        }
    }
}

impl Default for DevHubSettings {
    fn default() -> Self {
        Self {
            appearance: AppearanceSettings {
                theme: "dark".to_string(),
                language: default_language(),
                ui_font_family: "Consolas".to_string(),
                ui_font_size: 16,
                terminal_font_family: "Consolas".to_string(),
                terminal_font_size: 14,
            },
            layout: LayoutSettings {
                connection_sidebar_width: 280,
            },
            sftp: SftpSettings::default(),
            terminal: TerminalSettings::default(),
            connection_groups: Vec::new(),
            connections: Vec::new(),
        }
    }
}
