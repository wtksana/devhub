use crate::core::credential_store::CredentialStore;
use crate::models::settings::{ConnectionAuthSettings, ConnectionSettings};
use crate::ssh::client::{resolve_auth, ResolvedAuth};

#[test]
fn resolves_password_auth_from_plain_settings_password() {
    let credential_store = CredentialStore::new("devhub-test");
    let connection = ConnectionSettings {
        id: "dev".to_string(),
        name: "Dev".to_string(),
        group: None,
        host: "127.0.0.1".to_string(),
        port: 22,
        username: "root".to_string(),
        auth: ConnectionAuthSettings::Password {
            password: "plain-password".to_string(),
        },
    };

    let auth = resolve_auth(&credential_store, &connection).unwrap();

    assert!(matches!(auth, ResolvedAuth::Password(password) if password == "plain-password"));
}
