use std::fs;

#[test]
fn main_window_can_be_shown_after_hidden_startup() {
    let manifest_dir = env!("CARGO_MANIFEST_DIR");
    let capability_path = format!("{manifest_dir}/capabilities/default.json");
    let capability = fs::read_to_string(capability_path).expect("default capability should exist");
    let capability: serde_json::Value =
        serde_json::from_str(&capability).expect("default capability should be valid json");

    let permissions = capability
        .get("permissions")
        .and_then(serde_json::Value::as_array)
        .expect("default capability should list permissions");

    assert!(
        permissions
            .iter()
            .any(|permission| permission.as_str() == Some("core:window:allow-show")),
        "hidden startup requires core:window:allow-show so frontend can reveal the main window"
    );
}
