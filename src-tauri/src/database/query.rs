use std::{collections::HashMap, sync::Arc};

use futures_util::{TryStreamExt, pin_mut};
use serde::{Deserialize, Serialize};
use thiserror::Error;
use tokio::sync::{Mutex, Notify, RwLock};
use tokio_postgres::{Client, SimpleQueryMessage, error::SqlState};
use uuid::Uuid;

use crate::{database::connection::QueryCanceller, error::DatabaseError};

const MAX_QUERY_ROWS: usize = 10_000;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecuteQueryRequest {
    pub query_id: String,
    pub session_id: String,
    pub database: String,
    pub sql: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CancelQueryRequest {
    pub query_id: String,
    pub session_id: String,
    pub database: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CancelQueryResult {
    pub query_id: String,
    pub status: CancelQueryStatus,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum CancelQueryStatus {
    Requested,
    AlreadyFinished,
}

impl ExecuteQueryRequest {
    pub(crate) fn validate(&self) -> Result<(), QueryError> {
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

struct ActiveQuery {
    session_id: String,
    database: String,
    execution: Mutex<ActiveQueryExecution>,
    execution_changed: Notify,
    cancellation: Arc<CancellationAttempt>,
}

#[derive(Default)]
enum ActiveQueryExecution {
    #[default]
    Preparing,
    Ready(Arc<QueryCanceller>),
    Finished,
}

impl ActiveQuery {
    async fn activate(&self, canceller: QueryCanceller) {
        let mut execution = self.execution.lock().await;
        if matches!(*execution, ActiveQueryExecution::Preparing) {
            *execution = ActiveQueryExecution::Ready(Arc::new(canceller));
            self.execution_changed.notify_waiters();
        }
    }

    async fn abort_preparation(&self) {
        let mut execution = self.execution.lock().await;
        *execution = ActiveQueryExecution::Finished;
        self.execution_changed.notify_waiters();
    }

    async fn canceller(&self) -> Option<Arc<QueryCanceller>> {
        loop {
            let changed = self.execution_changed.notified();
            let execution = self.execution.lock().await;
            match &*execution {
                ActiveQueryExecution::Preparing => {
                    drop(execution);
                    changed.await;
                }
                ActiveQueryExecution::Ready(canceller) => return Some(Arc::clone(canceller)),
                ActiveQueryExecution::Finished => return None,
            }
        }
    }

    async fn finish(&self) {
        let mut execution = self.execution.lock().await;
        *execution = ActiveQueryExecution::Finished;
        self.execution_changed.notify_waiters();
    }
}

pub struct RegisteredQuery {
    active: Arc<ActiveQuery>,
}

impl RegisteredQuery {
    pub async fn activate(&self, canceller: QueryCanceller) {
        self.active.activate(canceller).await;
    }

    pub async fn abort_preparation(&self) {
        self.active.abort_preparation().await;
    }
}

#[derive(Default)]
struct CancellationAttempt {
    state: Mutex<CancellationState>,
    changed: Notify,
}

#[derive(Default)]
enum CancellationState {
    #[default]
    Ready,
    Sending,
    Sent,
    Failed(String),
}

impl CancellationAttempt {
    async fn request(&self, canceller: &QueryCanceller) -> Result<(), QueryError> {
        let mut joined_existing_request = false;
        loop {
            let changed = self.changed.notified();
            let mut state = self.state.lock().await;
            match &*state {
                CancellationState::Ready => {
                    *state = CancellationState::Sending;
                    drop(state);
                    break;
                }
                CancellationState::Sending => {
                    joined_existing_request = true;
                    drop(state);
                    changed.await;
                }
                CancellationState::Sent => return Ok(()),
                CancellationState::Failed(message) => {
                    if joined_existing_request {
                        return Err(QueryError::CancellationFailed(message.clone()));
                    }
                    *state = CancellationState::Sending;
                    drop(state);
                    break;
                }
            }
        }

        let result = canceller.cancel().await;
        let mut state = self.state.lock().await;
        match result {
            Ok(()) => {
                *state = CancellationState::Sent;
                self.changed.notify_waiters();
                Ok(())
            }
            Err(error) => {
                let message = error.to_string();
                *state = CancellationState::Failed(message.clone());
                self.changed.notify_waiters();
                Err(QueryError::CancellationFailed(message))
            }
        }
    }

    async fn was_sent(&self) -> bool {
        loop {
            let changed = self.changed.notified();
            let state = self.state.lock().await;
            match &*state {
                CancellationState::Sending => {
                    drop(state);
                    changed.await;
                }
                CancellationState::Sent => return true,
                CancellationState::Ready | CancellationState::Failed(_) => return false,
            }
        }
    }
}

#[derive(Default)]
pub struct QueryRegistry {
    active: RwLock<HashMap<String, Arc<ActiveQuery>>>,
}

impl QueryRegistry {
    pub async fn register(
        &self,
        request: &ExecuteQueryRequest,
    ) -> Result<RegisteredQuery, QueryError> {
        request.validate()?;
        let mut active = self.active.write().await;
        if active.contains_key(&request.query_id) {
            return Err(QueryError::AlreadyRunning(request.query_id.clone()));
        }
        let query = Arc::new(ActiveQuery {
            session_id: request.session_id.clone(),
            database: request.database.clone(),
            execution: Mutex::new(ActiveQueryExecution::Preparing),
            execution_changed: Notify::new(),
            cancellation: Arc::new(CancellationAttempt::default()),
        });
        active.insert(request.query_id.clone(), Arc::clone(&query));
        Ok(RegisteredQuery { active: query })
    }

    pub async fn cancel(
        &self,
        request: CancelQueryRequest,
    ) -> Result<CancelQueryResult, QueryError> {
        if Uuid::parse_str(&request.query_id).is_err() {
            return Err(QueryError::Invalid(
                "Query ID must be a valid UUID.".to_owned(),
            ));
        }
        let active_queries = self.active.read().await;
        let Some(active) = active_queries.get(&request.query_id) else {
            return Ok(CancelQueryResult {
                query_id: request.query_id,
                status: CancelQueryStatus::AlreadyFinished,
            });
        };
        if active.session_id != request.session_id || active.database != request.database {
            return Err(QueryError::Invalid(
                "The query does not belong to the requested database session.".to_owned(),
            ));
        }

        let Some(canceller) = active.canceller().await else {
            return Ok(CancelQueryResult {
                query_id: request.query_id,
                status: CancelQueryStatus::AlreadyFinished,
            });
        };
        active.cancellation.request(&canceller).await?;
        Ok(CancelQueryResult {
            query_id: request.query_id,
            status: CancelQueryStatus::Requested,
        })
    }

    pub async fn finish(&self, query_id: &str, postgres_cancelled: bool) -> bool {
        let active = self.active.write().await.remove(query_id);
        match (active, postgres_cancelled) {
            (Some(active), true) => {
                active.finish().await;
                active.cancellation.was_sent().await
            }
            (Some(active), false) => {
                active.finish().await;
                false
            }
            (None, _) => false,
        }
    }
}

#[derive(Debug, Error)]
pub enum QueryError {
    #[error("The query request is invalid: {0}")]
    Invalid(String),
    #[error("The query '{0}' is already running.")]
    AlreadyRunning(String),
    #[error("The query was cancelled by PostgreSQL.")]
    Cancelled,
    #[error("The cancellation request failed: {0}")]
    CancellationFailed(String),
    #[error(transparent)]
    Database(#[from] DatabaseError),
    #[error(transparent)]
    Postgres(#[from] tokio_postgres::Error),
}

pub fn is_postgres_cancellation(result: &Result<QueryExecutionResult, QueryError>) -> bool {
    matches!(
        result,
        Err(QueryError::Postgres(error))
            if error.code() == Some(&SqlState::QUERY_CANCELED)
    )
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
        CancelQueryRequest, CancelQueryStatus, ExecuteQueryRequest, QueryError, QueryRegistry,
        QueryStatementKind, execute, execute_with_limit, is_postgres_cancellation,
    };
    use crate::database::{
        connection::{ConnectionTestRequest, OpenConnection, QueryCanceller, open},
        test_support,
    };

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
    fn validates_query_ownership_fields() {
        tauri::async_runtime::block_on(async {
            let registry = QueryRegistry::default();
            let request = request();
            let registered = registry.register(&request).await.unwrap();

            let error = registry
                .cancel(CancelQueryRequest {
                    query_id: request.query_id.clone(),
                    session_id: "another-session".to_owned(),
                    database: request.database.clone(),
                })
                .await
                .unwrap_err();
            assert!(matches!(error, QueryError::Invalid(_)));

            registered.abort_preparation().await;
            let result = registry
                .cancel(CancelQueryRequest {
                    query_id: request.query_id.clone(),
                    session_id: request.session_id.clone(),
                    database: request.database.clone(),
                })
                .await
                .unwrap();
            assert!(matches!(result.status, CancelQueryStatus::AlreadyFinished));
            registry.finish(&request.query_id, false).await;
        });
    }

    #[test]
    fn rejects_missing_fields_and_invalid_query_ids() {
        tauri::async_runtime::block_on(async {
            let mut request = request();
            request.query_id = "not-a-uuid".to_owned();
            assert!(request.validate().is_err());

            request.query_id = QUERY_ID.to_owned();
            request.sql = " \n ".to_owned();
            assert!(request.validate().is_err());
        });
    }

    async fn run_registered(
        registry: &QueryRegistry,
        connection: &OpenConnection,
        request: &ExecuteQueryRequest,
    ) -> Result<super::QueryExecutionResult, QueryError> {
        registry
            .register(request)
            .await
            .unwrap()
            .activate(QueryCanceller::new(
                &connection.client,
                connection.settings.clone(),
            ))
            .await;
        let result = execute(&connection.client, request.query_id.clone(), &request.sql).await;
        let cancelled = registry
            .finish(&request.query_id, is_postgres_cancellation(&result))
            .await;
        if cancelled {
            Err(QueryError::Cancelled)
        } else {
            result
        }
    }

    async fn assert_cancels(request_settings: ConnectionTestRequest) {
        let connection = open(&request_settings)
            .await
            .expect("integration test connection should open");
        let registry = QueryRegistry::default();
        let mut request = request();
        request.database = request_settings.database;
        request.sql = "SELECT pg_sleep(10)".to_owned();

        let execution = run_registered(&registry, &connection, &request);
        let cancellation = async {
            tokio::time::sleep(std::time::Duration::from_millis(150)).await;
            registry
                .cancel(CancelQueryRequest {
                    query_id: request.query_id.clone(),
                    session_id: request.session_id.clone(),
                    database: request.database.clone(),
                })
                .await
        };
        let (execution, cancellation) = tokio::join!(execution, cancellation);

        assert!(matches!(execution, Err(QueryError::Cancelled)));
        assert!(matches!(
            cancellation.unwrap().status,
            CancelQueryStatus::Requested
        ));
    }

    #[test]
    #[ignore = "requires the local PostgreSQL integration environment"]
    fn cancels_a_running_plain_query() {
        tauri::async_runtime::block_on(assert_cancels(test_support::connection_request()));
    }

    #[test]
    #[ignore = "requires the local PostgreSQL TLS integration environment"]
    fn cancels_a_running_tls_query() {
        tauri::async_runtime::block_on(assert_cancels(test_support::tls_connection_request()));
    }

    #[test]
    #[ignore = "requires the local SSH and PostgreSQL integration environment"]
    fn cancels_a_running_query_through_ssh() {
        let mut settings = test_support::connection_request();
        settings.host = "postgres".to_owned();
        settings.port = 5432;
        settings.ssh_config = Some(test_support::ssh_password_config());
        tauri::async_runtime::block_on(assert_cancels(settings));
    }

    #[test]
    #[ignore = "requires the local PostgreSQL integration environment"]
    fn coalesces_duplicate_cancellation_requests() {
        tauri::async_runtime::block_on(async {
            let settings = test_support::connection_request();
            let connection = open(&settings).await.unwrap();
            let registry = QueryRegistry::default();
            let mut request = request();
            request.database = settings.database;
            request.sql = "SELECT pg_sleep(10)".to_owned();

            let execution = run_registered(&registry, &connection, &request);
            let cancel = || async {
                tokio::time::sleep(std::time::Duration::from_millis(150)).await;
                registry
                    .cancel(CancelQueryRequest {
                        query_id: request.query_id.clone(),
                        session_id: request.session_id.clone(),
                        database: request.database.clone(),
                    })
                    .await
            };
            let (execution, first, second) = tokio::join!(execution, cancel(), cancel());

            assert!(matches!(execution, Err(QueryError::Cancelled)));
            assert!(matches!(
                first.unwrap().status,
                CancelQueryStatus::Requested
            ));
            assert!(matches!(
                second.unwrap().status,
                CancelQueryStatus::Requested
            ));
        });
    }

    #[test]
    #[ignore = "requires the local PostgreSQL integration environment"]
    fn reports_already_finished_without_overwriting_success() {
        tauri::async_runtime::block_on(async {
            let settings = test_support::connection_request();
            let connection = open(&settings).await.unwrap();
            let registry = QueryRegistry::default();
            let mut request = request();
            request.database = settings.database;

            let execution = run_registered(&registry, &connection, &request);
            let cancellation = async {
                tokio::time::sleep(std::time::Duration::from_millis(150)).await;
                registry
                    .cancel(CancelQueryRequest {
                        query_id: request.query_id.clone(),
                        session_id: request.session_id.clone(),
                        database: request.database.clone(),
                    })
                    .await
            };
            let (execution, cancellation) = tokio::join!(execution, cancellation);

            assert!(execution.is_ok());
            assert!(matches!(
                cancellation.unwrap().status,
                CancelQueryStatus::AlreadyFinished
            ));
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
