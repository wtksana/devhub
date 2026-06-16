use keyring::Entry;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum CredentialStoreError {
    #[error("credential store error: {0}")]
    Keyring(#[from] keyring::Error),
}

pub type Result<T> = std::result::Result<T, CredentialStoreError>;

#[derive(Debug, Clone)]
pub struct CredentialStore {
    service: String,
}

impl CredentialStore {
    pub fn new(service: impl Into<String>) -> Self {
        Self {
            service: service.into(),
        }
    }

    pub fn credential_id(scope: &str, name: &str, kind: &str) -> String {
        format!("{scope}:{name}:{kind}")
    }

    pub fn set_secret(&self, id: &str, secret: &str) -> Result<()> {
        Entry::new(&self.service, id)?.set_password(secret)?;
        Ok(())
    }

    pub fn get_secret(&self, id: &str) -> Result<String> {
        Ok(Entry::new(&self.service, id)?.get_password()?)
    }

    pub fn delete_secret(&self, id: &str) -> Result<()> {
        Entry::new(&self.service, id)?.delete_credential()?;
        Ok(())
    }
}
