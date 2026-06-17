use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct AppearanceSettings {
    pub theme: String,
    pub ui_font_family: String,
    #[serde(default = "default_ui_font_size")]
    pub ui_font_size: u16,
    pub terminal_font_family: String,
    pub terminal_font_size: u16,
}

fn default_ui_font_size() -> u16 {
    13
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
#[serde(tag = "type")]
pub enum ConnectionAuthSettings {
    #[serde(rename = "password")]
    Password { password: String },
    #[serde(rename = "private_key")]
    PrivateKey {
        private_key_path: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        passphrase_ref: Option<String>,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ConnectionSettings {
    pub id: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub group: Option<String>,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub auth: ConnectionAuthSettings,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct DevHubSettings {
    pub appearance: AppearanceSettings,
    pub layout: LayoutSettings,
    #[serde(default)]
    pub sftp: SftpSettings,
    pub connections: Vec<ConnectionSettings>,
}

impl Default for SftpSettings {
    fn default() -> Self {
        Self {
            file_size_unit: default_sftp_file_size_unit(),
        }
    }
}

impl Default for DevHubSettings {
    fn default() -> Self {
        Self {
            appearance: AppearanceSettings {
                theme: "dark".to_string(),
                ui_font_family: "Inter".to_string(),
                ui_font_size: 13,
                terminal_font_family: "JetBrains Mono".to_string(),
                terminal_font_size: 14,
            },
            layout: LayoutSettings {
                connection_sidebar_width: 280,
            },
            sftp: SftpSettings::default(),
            connections: Vec::new(),
        }
    }
}
