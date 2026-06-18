use tempfile::tempdir;

use crate::core::window_state::{WindowState, WindowStateStore};

#[test]
fn saves_and_loads_window_size() {
    let dir = tempdir().unwrap();
    let store = WindowStateStore::new_for_dir(dir.path().to_path_buf());

    store.save(&WindowState::new(1440, 900).unwrap()).unwrap();
    let loaded = store.load().unwrap().unwrap();

    assert_eq!(loaded, WindowState::new(1440, 900).unwrap());
    assert!(store.window_state_path().exists());
}

#[test]
fn returns_none_when_window_state_is_missing() {
    let dir = tempdir().unwrap();
    let store = WindowStateStore::new_for_dir(dir.path().to_path_buf());

    assert_eq!(store.load().unwrap(), None);
}

#[test]
fn ignores_too_small_window_state() {
    let dir = tempdir().unwrap();
    let store = WindowStateStore::new_for_dir(dir.path().to_path_buf());
    std::fs::write(store.window_state_path(), r#"{"width":640,"height":360}"#).unwrap();

    assert_eq!(store.load().unwrap(), None);
}

#[test]
fn reports_invalid_window_state_json() {
    let dir = tempdir().unwrap();
    let store = WindowStateStore::new_for_dir(dir.path().to_path_buf());
    std::fs::write(store.window_state_path(), "{").unwrap();

    let error = store.load().unwrap_err().to_string();

    assert!(error.contains("json"));
}
