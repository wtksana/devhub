use std::fs;
use std::path::Path;

use crate::db::query::quote_identifier;
use crate::models::database::{
    DatabaseCellValue, DatabaseResultColumn, DatabaseResultExportFormat,
};

const INSERT_BATCH_SIZE: usize = 500;

pub fn export_database_result(
    kind: &str,
    table: Option<&str>,
    path: &str,
    format: &DatabaseResultExportFormat,
    columns: &[DatabaseResultColumn],
    rows: &[Vec<DatabaseCellValue>],
) -> Result<u64, String> {
    let content = match format {
        DatabaseResultExportFormat::Csv => build_csv(columns, rows)?,
        DatabaseResultExportFormat::InsertSql => {
            let table = table
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .ok_or_else(|| "table name is required for INSERT SQL export".to_string())?;
            build_insert_sql(kind, table, columns, rows)?
        }
    };
    write_text_file(path, &content)?;
    Ok(rows.len() as u64)
}

pub fn build_csv(
    columns: &[DatabaseResultColumn],
    rows: &[Vec<DatabaseCellValue>],
) -> Result<String, String> {
    if columns.is_empty() {
        return Err("columns are required".to_string());
    }

    let mut output = String::new();
    output.push_str(
        &columns
            .iter()
            .map(|column| csv_escape(&column.name))
            .collect::<Vec<_>>()
            .join(","),
    );
    output.push('\n');

    for row in rows {
        let values = columns
            .iter()
            .enumerate()
            .map(|(index, _)| csv_escape(&cell_to_csv(row.get(index))))
            .collect::<Vec<_>>();
        output.push_str(&values.join(","));
        output.push('\n');
    }

    Ok(output)
}

pub fn build_insert_sql(
    kind: &str,
    table: &str,
    columns: &[DatabaseResultColumn],
    rows: &[Vec<DatabaseCellValue>],
) -> Result<String, String> {
    if columns.is_empty() {
        return Err("columns are required".to_string());
    }

    let quoted_table = quote_identifier(kind, table)?;
    let quoted_columns = columns
        .iter()
        .map(|column| quote_identifier(kind, &column.name))
        .collect::<Result<Vec<_>, _>>()?
        .join(", ");
    let mut output = String::new();

    for chunk in rows.chunks(INSERT_BATCH_SIZE) {
        output.push_str(&format!(
            "INSERT INTO {quoted_table} ({quoted_columns}) VALUES\n"
        ));
        for (row_index, row) in chunk.iter().enumerate() {
            let values = columns
                .iter()
                .enumerate()
                .map(|(index, _)| cell_to_sql(kind, row.get(index)))
                .collect::<Vec<_>>()
                .join(", ");
            let suffix = if row_index + 1 == chunk.len() {
                ";\n"
            } else {
                ","
            };
            output.push_str(&format!("  ({values}){suffix}"));
            if row_index + 1 != chunk.len() {
                output.push('\n');
            }
        }
    }

    Ok(output)
}

fn write_text_file(path: &str, content: &str) -> Result<(), String> {
    let path = Path::new(path);
    if let Some(parent) = path.parent() {
        if !parent.as_os_str().is_empty() {
            fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        }
    }
    fs::write(path, content).map_err(|error| error.to_string())
}

fn cell_to_csv(cell: Option<&DatabaseCellValue>) -> String {
    match cell {
        Some(DatabaseCellValue::Null) | None => String::new(),
        Some(DatabaseCellValue::Text { value }) | Some(DatabaseCellValue::Number { value }) => {
            value.clone()
        }
        Some(DatabaseCellValue::Bool { value }) => value.to_string(),
    }
}

fn csv_escape(value: &str) -> String {
    if value.contains(',') || value.contains('"') || value.contains('\n') || value.contains('\r') {
        format!("\"{}\"", value.replace('"', "\"\""))
    } else {
        value.to_string()
    }
}

fn cell_to_sql(kind: &str, cell: Option<&DatabaseCellValue>) -> String {
    match cell {
        Some(DatabaseCellValue::Null) | None => "NULL".to_string(),
        Some(DatabaseCellValue::Number { value }) => value.clone(),
        Some(DatabaseCellValue::Text { value }) => format!("'{}'", value.replace('\'', "''")),
        Some(DatabaseCellValue::Bool { value }) => match (kind, value) {
            ("postgresql", true) => "TRUE".to_string(),
            ("postgresql", false) => "FALSE".to_string(),
            (_, true) => "1".to_string(),
            (_, false) => "0".to_string(),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::database::{DatabaseCellValue, DatabaseResultColumn};

    fn columns() -> Vec<DatabaseResultColumn> {
        vec![
            DatabaseResultColumn {
                name: "id".to_string(),
                data_type: "INT".to_string(),
                nullable: None,
                has_default: None,
                generated: None,
            },
            DatabaseResultColumn {
                name: "name".to_string(),
                data_type: "VARCHAR".to_string(),
                nullable: None,
                has_default: None,
                generated: None,
            },
            DatabaseResultColumn {
                name: "active".to_string(),
                data_type: "BOOL".to_string(),
                nullable: None,
                has_default: None,
                generated: None,
            },
        ]
    }

    fn rows() -> Vec<Vec<DatabaseCellValue>> {
        vec![
            vec![
                DatabaseCellValue::Number {
                    value: "1".to_string(),
                },
                DatabaseCellValue::Text {
                    value: "Alice, \"A\"".to_string(),
                },
                DatabaseCellValue::Bool { value: true },
            ],
            vec![
                DatabaseCellValue::Number {
                    value: "2".to_string(),
                },
                DatabaseCellValue::Null,
                DatabaseCellValue::Bool { value: false },
            ],
        ]
    }

    fn sql_rows() -> Vec<Vec<DatabaseCellValue>> {
        vec![
            vec![
                DatabaseCellValue::Number {
                    value: "1".to_string(),
                },
                DatabaseCellValue::Text {
                    value: "Alice, 'A'".to_string(),
                },
                DatabaseCellValue::Bool { value: true },
            ],
            vec![
                DatabaseCellValue::Number {
                    value: "2".to_string(),
                },
                DatabaseCellValue::Null,
                DatabaseCellValue::Bool { value: false },
            ],
        ]
    }

    #[test]
    fn exports_csv_with_header_and_escaped_values() {
        let csv = build_csv(&columns(), &rows()).expect("csv");

        assert_eq!(
            csv,
            "id,name,active\n1,\"Alice, \"\"A\"\"\",true\n2,,false\n"
        );
    }

    #[test]
    fn exports_mysql_insert_sql_with_escaped_values() {
        let sql = build_insert_sql("mysql", "users", &columns(), &sql_rows()).expect("insert sql");

        assert_eq!(
            sql,
            "INSERT INTO `users` (`id`, `name`, `active`) VALUES\n  (1, 'Alice, ''A''', 1),\n  (2, NULL, 0);\n"
        );
    }

    #[test]
    fn exports_postgresql_insert_sql_with_bool_literals() {
        let sql =
            build_insert_sql("postgresql", "users", &columns(), &sql_rows()).expect("insert sql");

        assert_eq!(
            sql,
            "INSERT INTO \"users\" (\"id\", \"name\", \"active\") VALUES\n  (1, 'Alice, ''A''', TRUE),\n  (2, NULL, FALSE);\n"
        );
    }
}
