use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct AppearanceSettings {
    pub theme: String,
    pub font_family: String,
    pub editor_font_family: String,
    pub editor_font_size: u16,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct LayoutSettings {
    pub ai_panel: String,
    pub ai_panel_width: u16,
    pub open_ai_panel_by_default: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "type")]
pub enum ConnectionAuthSettings {
    #[serde(rename = "password")]
    Password { credential_ref: String },
    #[serde(rename = "private_key")]
    PrivateKey {
        key_ref: String,
        passphrase_ref: Option<String>,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ConnectionSettings {
    pub id: String,
    pub name: String,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub auth: ConnectionAuthSettings,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct AiSettings {
    pub provider: String,
    pub base_url: String,
    pub model: String,
    pub api_key_ref: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct DevHubSettings {
    pub appearance: AppearanceSettings,
    pub layout: LayoutSettings,
    pub connections: Vec<ConnectionSettings>,
    pub ai: AiSettings,
}

impl Default for DevHubSettings {
    fn default() -> Self {
        Self {
            appearance: AppearanceSettings {
                theme: "dark".to_string(),
                font_family: "Inter".to_string(),
                editor_font_family: "JetBrains Mono".to_string(),
                editor_font_size: 14,
            },
            layout: LayoutSettings {
                ai_panel: "right".to_string(),
                ai_panel_width: 280,
                open_ai_panel_by_default: true,
            },
            connections: Vec::new(),
            ai: AiSettings {
                provider: "openai_compatible".to_string(),
                base_url: "https://api.openai.com/v1".to_string(),
                model: "gpt-4.1".to_string(),
                api_key_ref: "ai:default".to_string(),
            },
        }
    }
}
