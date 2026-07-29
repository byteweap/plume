use std::collections::HashMap;

use futures_util::{TryStreamExt, pin_mut};
use serde::{Deserialize, Serialize};
use thiserror::Error;
use tokio::sync::RwLock;
use tokio_postgres::{Client, SimpleQueryMessage};
use uuid::Uuid;

use crate::error::DatabaseError;

const MAX_QUERY_ROWS: usize = 10_000;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecuteQueryRequest {
    pub query_id: String,
    pub session_id: String,
    pub database: String,
    pub sql: String,
}

impl ExecuteQueryRequest {
    fn validate(&self) -> Result<(), QueryError> {
        if Uuid::parse_str(&self.query_id).is_err() {
            return Err(QueryError::Invalid(
                "Query ID must be a valid UUID.".to_owned(),
            ));
        }
        if self.session_id.trim().is_empty() {
            return Err(QueryError::Invalid("Session ID is required.".to_owned()));
        }
        if self.database.trim().is_empty() {
            return Err(QueryError::Invalid("Database is required.".to_owned()));
        }
        if self.sql.trim().is_empty() {
            return Err(QueryError::Invalid("SQL is required.".to_owned()));
        }
        Ok(())
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QueryExecutionResult {
    pub query_id: String,
    pub status: QueryExecutionStatus,
    pub results: Vec<QueryStatementResult>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum QueryExecutionStatus {
    Succeeded,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QueryStatementResult {
    pub kind: QueryStatementKind,
    pub columns: Vec<QueryColumn>,
    pub rows: Vec<Vec<Option<String>>>,
    pub row_count: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub affected_rows: Option<u64>,
    pub truncated: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum QueryStatementKind {
    Rows,
    Command,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QueryColumn {
    pub name: String,
    pub ordinal: usize,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct ActiveQuery {
    session_id: String,
    database: String,
}

#[derive(Default)]
pub struct QueryRegistry {
    active: RwLock<HashMap<String, ActiveQuery>>,
}

impl QueryRegistry {
    pub async fn register(&self, request: &ExecuteQueryRequest) -> Result<(), QueryError> {
        request.validate()?;
        let mut active = self.active.write().await;
        if active.contains_key(&request.query_id) {
            return Err(QueryError::AlreadyRunning(request.query_id.clone()));
        }
        active.insert(
            request.query_id.clone(),
            ActiveQuery {
                session_id: request.session_id.clone(),
                database: request.database.clone(),
            },
        );
        Ok(())
    }

    pub async fn finish(&self, query_id: &str) {
        self.active.write().await.remove(query_id);
    }

    #[cfg(test)]
    async fn owner(&self, query_id: &str) -> Option<ActiveQuery> {
        self.active.read().await.get(query_id).cloned()
    }
}

#[derive(Debug, Error)]
pub enum QueryError {
    #[error("The query request is invalid: {0}")]
    Invalid(String),
    #[error("The query '{0}' is already running.")]
    AlreadyRunning(String),
    #[error(transparent)]
    Database(#[from] DatabaseError),
    #[error(transparent)]
    Postgres(#[from] tokio_postgres::Error),
}

pub async fn execute(
    client: &Client,
    query_id: String,
    sql: &str,
) -> Result<QueryExecutionResult, QueryError> {
    execute_with_limit(client, query_id, sql, MAX_QUERY_ROWS).await
}

async fn execute_with_limit(
    client: &Client,
    query_id: String,
    sql: &str,
    row_limit: usize,
) -> Result<QueryExecutionResult, QueryError> {
    let stream = client.simple_query_raw(sql).await?;
    pin_mut!(stream);

    let mut results = Vec::new();
    let mut current_rows: Option<QueryStatementResult> = None;
    let mut remaining_rows = row_limit;

    while let Some(message) = stream.try_next().await? {
        match message {
            SimpleQueryMessage::RowDescription(columns) => {
                if let Some(result) = current_rows.take() {
                    results.push(result);
                }
                current_rows = Some(QueryStatementResult {
                    kind: QueryStatementKind::Rows,
                    columns: columns
                        .iter()
                        .enumerate()
                        .map(|(ordinal, column)| QueryColumn {
                            name: column.name().to_owned(),
                            ordinal,
                        })
                        .collect(),
                    rows: Vec::new(),
                    row_count: 0,
                    affected_rows: None,
                    truncated: false,
                });
            }
            SimpleQueryMessage::Row(row) => {
                let result = current_rows.get_or_insert_with(|| QueryStatementResult {
                    kind: QueryStatementKind::Rows,
                    columns: row
                        .columns()
                        .iter()
                        .enumerate()
                        .map(|(ordinal, column)| QueryColumn {
                            name: column.name().to_owned(),
                            ordinal,
                        })
                        .collect(),
                    rows: Vec::new(),
                    row_count: 0,
                    affected_rows: None,
                    truncated: false,
                });
                result.row_count += 1;
                if remaining_rows > 0 {
                    result.rows.push(
                        (0..row.len())
                            .map(|index| row.get(index).map(str::to_owned))
                            .collect(),
                    );
                    remaining_rows -= 1;
                } else {
                    result.truncated = true;
                }
            }
            SimpleQueryMessage::CommandComplete(count) => {
                if let Some(mut result) = current_rows.take() {
                    result.row_count = count;
                    results.push(result);
                } else {
                    results.push(QueryStatementResult {
                        kind: QueryStatementKind::Command,
                        columns: Vec::new(),
                        rows: Vec::new(),
                        row_count: 0,
                        affected_rows: Some(count),
                        truncated: false,
                    });
                }
            }
            _ => {}
        }
    }

    if let Some(result) = current_rows {
        results.push(result);
    }

    Ok(QueryExecutionResult {
        query_id,
        status: QueryExecutionStatus::Succeeded,
        results,
    })
}

#[cfg(test)]
mod tests {
    use super::{
        ActiveQuery, ExecuteQueryRequest, QueryRegistry, QueryStatementKind, execute_with_limit,
    };
    use crate::database::test_support;

    const QUERY_ID: &str = "1e28f9b1-9cc7-4437-aa43-3f096e36485d";

    fn request() -> ExecuteQueryRequest {
        ExecuteQueryRequest {
            query_id: QUERY_ID.to_owned(),
            session_id: "session-1".to_owned(),
            database: "postgres".to_owned(),
            sql: "SELECT 1".to_owned(),
        }
    }

    #[test]
    fn validates_and_tracks_query_ownership() {
        tauri::async_runtime::block_on(async {
            let registry = QueryRegistry::default();
            let request = request();
            registry.register(&request).await.unwrap();

            assert_eq!(
                registry.owner(QUERY_ID).await,
                Some(ActiveQuery {
                    session_id: "session-1".to_owned(),
                    database: "postgres".to_owned(),
                })
            );
            assert!(registry.register(&request).await.is_err());

            registry.finish(QUERY_ID).await;
            assert!(registry.owner(QUERY_ID).await.is_none());
            registry.register(&request).await.unwrap();
        });
    }

    #[test]
    fn rejects_missing_fields_and_invalid_query_ids() {
        tauri::async_runtime::block_on(async {
            let registry = QueryRegistry::default();
            let mut request = request();
            request.query_id = "not-a-uuid".to_owned();
            assert!(registry.register(&request).await.is_err());

            request.query_id = QUERY_ID.to_owned();
            request.sql = " \n ".to_owned();
            assert!(registry.register(&request).await.is_err());
        });
    }

    #[test]
    #[ignore = "requires the local PostgreSQL integration environment"]
    fn executes_multiple_statements_and_preserves_null_values() {
        tauri::async_runtime::block_on(async {
            let client = test_support::connect().await;
            let result = execute_with_limit(
                &client,
                QUERY_ID.to_owned(),
                "SELECT 7 AS number, NULL::text AS missing, '中文' AS text; \
                 UPDATE plume_fixture.items SET label = label WHERE id = 1",
                10,
            )
            .await
            .unwrap();

            assert_eq!(result.query_id, QUERY_ID);
            assert_eq!(result.results.len(), 2);
            assert!(matches!(result.results[0].kind, QueryStatementKind::Rows));
            assert_eq!(
                result.results[0].rows,
                vec![vec![Some("7".to_owned()), None, Some("中文".to_owned())]]
            );
            assert_eq!(result.results[1].affected_rows, Some(1));
        });
    }

    #[test]
    #[ignore = "requires the local PostgreSQL integration environment"]
    fn drains_rows_beyond_the_result_limit() {
        tauri::async_runtime::block_on(async {
            let client = test_support::connect().await;
            let result = execute_with_limit(
                &client,
                QUERY_ID.to_owned(),
                "SELECT value FROM generate_series(1, 3) AS value",
                1,
            )
            .await
            .unwrap();

            assert_eq!(result.results[0].row_count, 3);
            assert_eq!(result.results[0].rows.len(), 1);
            assert!(result.results[0].truncated);
            client.simple_query("SELECT 1").await.unwrap();
        });
    }
}
