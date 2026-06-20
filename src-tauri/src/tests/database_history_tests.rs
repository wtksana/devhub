use crate::db::history::{QueryHistoryRecord, QueryHistoryStore};
use tempfile::tempdir;

#[test]
fn keeps_latest_100_query_history_items_per_connection() {
    let dir = tempdir().unwrap();
    let store = QueryHistoryStore::new_for_dir(dir.path().to_path_buf());

    for index in 0..105 {
        store
            .record(QueryHistoryRecord {
                connection_id: "mysql-dev".to_string(),
                database_kind: "mysql".to_string(),
                database_name: Some("app".to_string()),
                sql_text: format!("select {index}"),
                duration_ms: 1,
                success: true,
                error_message: None,
            })
            .unwrap();
    }

    let items = store.list("mysql-dev", 200).unwrap();

    assert_eq!(items.len(), 100);
    assert_eq!(items[0].sql_text, "select 104");
    assert_eq!(items[99].sql_text, "select 5");
}

#[test]
fn records_failed_query_history_items() {
    let dir = tempdir().unwrap();
    let store = QueryHistoryStore::new_for_dir(dir.path().to_path_buf());

    store
        .record(QueryHistoryRecord {
            connection_id: "pg-dev".to_string(),
            database_kind: "postgresql".to_string(),
            database_name: None,
            sql_text: "select from".to_string(),
            duration_ms: 2,
            success: false,
            error_message: Some("syntax error".to_string()),
        })
        .unwrap();

    let items = store.list("pg-dev", 10).unwrap();

    assert_eq!(items.len(), 1);
    assert_eq!(items[0].database_kind, "postgresql");
    assert!(!items[0].success);
    assert_eq!(items[0].error_message.as_deref(), Some("syntax error"));
}
