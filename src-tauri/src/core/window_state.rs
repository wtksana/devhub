use std::fs;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use thiserror::Error;

const WINDOW_STATE_FILE: &str = "window-state.json";
const MIN_WINDOW_WIDTH: u32 = 720;
const MIN_WINDOW_HEIGHT: u32 = 480;

#[derive(Debug, Error)]
pub enum WindowStateStoreError {
    #[error("window state io error: {0}")]
    Io(#[from] std::io::Error),
    #[error("window state json error: {0}")]
    Json(#[from] serde_json::Error),
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct WindowState {
    pub width: u32,
    pub height: u32,
}

impl WindowState {
    pub fn new(width: u32, height: u32) -> Option<Self> {
        if width < MIN_WINDOW_WIDTH || height < MIN_WINDOW_HEIGHT {
            return None;
        }

        Some(Self { width, height })
    }
}

#[derive(Clone)]
pub struct WindowStateStore {
    base_dir: PathBuf,
}

impl WindowStateStore {
    pub fn new_for_dir(base_dir: PathBuf) -> Self {
        Self { base_dir }
    }

    pub fn window_state_path(&self) -> PathBuf {
        self.base_dir.join(WINDOW_STATE_FILE)
    }

    pub fn load(&self) -> Result<Option<WindowState>, WindowStateStoreError> {
        let path = self.window_state_path();
        if !path.exists() {
            return Ok(None);
        }

        let raw = fs::read_to_string(path)?;
        let state: WindowState = serde_json::from_str(&raw)?;

        Ok(WindowState::new(state.width, state.height))
    }

    pub fn save(&self, state: &WindowState) -> Result<(), WindowStateStoreError> {
        fs::create_dir_all(&self.base_dir)?;

        let mut json = serde_json::to_string_pretty(state)?;
        json.push('\n');
        fs::write(self.window_state_path(), json)?;

        Ok(())
    }
}
