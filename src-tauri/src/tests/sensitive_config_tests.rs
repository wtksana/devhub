use crate::core::credential_store::CredentialStore;

#[test]
fn credential_ids_are_namespaced() {
    let id = CredentialStore::credential_id("ssh", "prod-web-01", "password");
    assert_eq!(id, "ssh:prod-web-01:password");
}
