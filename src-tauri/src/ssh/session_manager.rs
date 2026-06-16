use std::collections::HashMap;
use std::sync::Arc;

use tokio::sync::Mutex;
use uuid::Uuid;

#[derive(Clone, Default)]
pub struct SessionManager {
    sessions: Arc<Mutex<HashMap<String, ManagedSession>>>,
}

#[derive(Debug)]
pub struct ManagedSession {
    pub connection_id: String,
}

impl SessionManager {
    pub async fn create_placeholder(&self, connection_id: String) -> String {
        let session_id = Uuid::new_v4().to_string();
        self.sessions
            .lock()
            .await
            .insert(session_id.clone(), ManagedSession { connection_id });
        session_id
    }

    pub async fn has_session(&self, session_id: &str) -> bool {
        self.sessions.lock().await.contains_key(session_id)
    }

    pub async fn close(&self, session_id: &str) {
        self.sessions.lock().await.remove(session_id);
    }
}
