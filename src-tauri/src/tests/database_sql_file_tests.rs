use crate::db::sql_files::DatabaseSqlFileStore;

#[test]
fn creates_default_sql_file_for_new_database() {
    let dir = tempfile::tempdir().unwrap();
    let store = DatabaseSqlFileStore::new_for_dir(dir.path().to_path_buf());

    let files = store.list("mysql-dev", "app").unwrap();

    assert_eq!(files.len(), 1);
    assert_eq!(files[0].name, "default");
    assert_eq!(files[0].content, "");
}

#[test]
fn saves_and_lists_sql_files_per_database() {
    let dir = tempfile::tempdir().unwrap();
    let store = DatabaseSqlFileStore::new_for_dir(dir.path().to_path_buf());

    store
        .save("mysql-dev", "app", "default", "select * from users")
        .unwrap();
    store
        .save("mysql-dev", "app", "report", "select count(*) from users")
        .unwrap();

    let files = store.list("mysql-dev", "app").unwrap();

    assert_eq!(files[0].name, "default");
    assert_eq!(files[0].content, "select * from users");
    assert_eq!(files[1].name, "report");
    assert_eq!(files[1].content, "select count(*) from users");
}

#[test]
fn keeps_sql_files_isolated_by_connection_and_database() {
    let dir = tempfile::tempdir().unwrap();
    let store = DatabaseSqlFileStore::new_for_dir(dir.path().to_path_buf());

    store.save("mysql-dev", "app", "default", "select 1").unwrap();
    store.save("mysql-dev", "ops", "default", "select 2").unwrap();
    store.save("pg-dev", "app", "default", "select 3").unwrap();

    assert_eq!(store.list("mysql-dev", "app").unwrap()[0].content, "select 1");
    assert_eq!(store.list("mysql-dev", "ops").unwrap()[0].content, "select 2");
    assert_eq!(store.list("pg-dev", "app").unwrap()[0].content, "select 3");
}
