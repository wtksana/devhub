use std::fs;
use std::path::Path;
use std::time::Instant;

use crate::db::connection::DatabaseConnectionManager;
use crate::db::query;
use crate::models::database::{DatabaseSqlFileExecutionResult, DatabaseSqlFilePreview};
use crate::models::settings::DatabaseConnectionSettings;

const PREVIEW_MAX_LINES: usize = 200;
const PREVIEW_MAX_BYTES: usize = 64 * 1024;
const DANGEROUS_KEYWORDS: &[&str] = &["drop", "truncate", "delete", "update", "alter"];

pub fn preview_sql_file(path: &str) -> Result<DatabaseSqlFilePreview, String> {
    let metadata = fs::metadata(path).map_err(|error| error.to_string())?;
    let bytes = fs::read(path).map_err(|error| error.to_string())?;
    let preview_text = String::from_utf8_lossy(&bytes[..bytes.len().min(PREVIEW_MAX_BYTES)]);
    let preview = preview_text
        .lines()
        .take(PREVIEW_MAX_LINES)
        .collect::<Vec<_>>()
        .join("\n");
    let full_text = String::from_utf8_lossy(&bytes);
    let statements = split_sql_statements(&full_text)?;
    let dangerous = statements
        .iter()
        .any(|statement| contains_dangerous_keyword(statement));
    let file_name = Path::new(path)
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or(path)
        .to_string();

    Ok(DatabaseSqlFilePreview {
        path: path.to_string(),
        file_name,
        size_bytes: metadata.len(),
        preview,
        estimated_statement_count: statements.len() as u64,
        dangerous,
    })
}

pub async fn execute_sql_file(
    manager: &DatabaseConnectionManager,
    connection: &DatabaseConnectionSettings,
    database: &str,
    path: &str,
) -> Result<DatabaseSqlFileExecutionResult, String> {
    let content = fs::read_to_string(path).map_err(|error| error.to_string())?;
    let statements = split_sql_statements(&content)?;
    let started_at = Instant::now();
    let mut affected_rows = 0;

    for (index, statement) in statements.iter().enumerate() {
        match query::execute_database_statement(manager, connection, database, statement).await {
            Ok(rows) => affected_rows += rows,
            Err(error) => {
                return Err(format!(
                    "statement {} failed: {}: {}",
                    index + 1,
                    statement_preview(statement),
                    error
                ));
            }
        }
    }

    Ok(DatabaseSqlFileExecutionResult {
        executed_statements: statements.len() as u64,
        affected_rows,
        duration_ms: started_at.elapsed().as_millis(),
        failed_statement_index: None,
        failed_statement_preview: None,
    })
}

pub fn split_sql_statements(sql: &str) -> Result<Vec<String>, String> {
    let mut statements = Vec::new();
    let mut current = String::new();
    let mut chars = sql.chars().peekable();
    let mut quote: Option<char> = None;
    let mut in_line_comment = false;
    let mut in_block_comment = false;

    while let Some(ch) = chars.next() {
        if in_line_comment {
            if ch == '\n' {
                in_line_comment = false;
            }
            continue;
        }
        if in_block_comment {
            if ch == '*' && chars.peek() == Some(&'/') {
                let _ = chars.next();
                in_block_comment = false;
            }
            continue;
        }
        if let Some(quote_char) = quote {
            current.push(ch);
            if ch == '\\' {
                if let Some(next) = chars.next() {
                    current.push(next);
                }
                continue;
            }
            if ch == quote_char {
                if chars.peek() == Some(&quote_char) {
                    current.push(quote_char);
                    let _ = chars.next();
                } else {
                    quote = None;
                }
            }
            continue;
        }
        if ch == '-' && chars.peek() == Some(&'-') {
            let _ = chars.next();
            in_line_comment = true;
            continue;
        }
        if ch == '/' && chars.peek() == Some(&'*') {
            let _ = chars.next();
            in_block_comment = true;
            continue;
        }
        if ch == '\'' || ch == '"' || ch == '`' {
            quote = Some(ch);
            current.push(ch);
            continue;
        }
        if ch == ';' {
            push_statement(&mut statements, &mut current);
            continue;
        }
        current.push(ch);
    }

    if quote.is_some() {
        return Err("unterminated SQL string".to_string());
    }
    if in_block_comment {
        return Err("unterminated SQL block comment".to_string());
    }
    push_statement(&mut statements, &mut current);
    Ok(statements)
}

fn push_statement(statements: &mut Vec<String>, current: &mut String) {
    let statement = current.trim();
    if !statement.is_empty() {
        statements.push(statement.to_string());
    }
    current.clear();
}

fn contains_dangerous_keyword(statement: &str) -> bool {
    statement
        .split(|character: char| !character.is_ascii_alphabetic())
        .filter(|token| !token.is_empty())
        .any(|token| {
            DANGEROUS_KEYWORDS
                .iter()
                .any(|keyword| token.eq_ignore_ascii_case(keyword))
        })
}

fn statement_preview(statement: &str) -> String {
    let preview = statement.trim().replace(['\r', '\n'], " ");
    let mut chars = preview.chars();
    let truncated = chars.by_ref().take(120).collect::<String>();
    if chars.next().is_some() {
        format!("{truncated}...")
    } else {
        truncated
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn splits_sql_without_breaking_strings_or_comments() {
        let statements = split_sql_statements(
            "select ';' as semi; -- ignored ;\ninsert into t values ('a; b'); /* ignored ; */ update t set name = \"x;y\";",
        )
        .expect("statements");

        assert_eq!(
            statements,
            vec![
                "select ';' as semi",
                "insert into t values ('a; b')",
                "update t set name = \"x;y\"",
            ]
        );
    }

    #[test]
    fn previews_first_lines_and_detects_dangerous_keywords() {
        let path = std::env::temp_dir().join("devhub-preview-dangerous.sql");
        fs::write(&path, "select 1;\nupdate users set name = 'x';\nselect 2;").expect("write");

        let preview = preview_sql_file(path.to_str().expect("path")).expect("preview");

        assert_eq!(preview.file_name, "devhub-preview-dangerous.sql");
        assert!(preview.preview.contains("select 1;"));
        assert_eq!(preview.estimated_statement_count, 3);
        assert!(preview.dangerous);

        let _ = fs::remove_file(path);
    }
}
