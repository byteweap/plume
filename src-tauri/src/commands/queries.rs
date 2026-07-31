use tauri::State;

use crate::{
    database::{
        query::{
            self, CancelQueryRequest, CancelQueryResult, ExecuteQueryRequest, QueryError,
            QueryExecutionResult, QueryRegistry,
        },
        session::ConnectionRegistry,
    },
    error::CommandError,
    replay::OperationReplayGuard,
};

#[tauri::command]
pub async fn execute_query(
    connections: State<'_, ConnectionRegistry>,
    queries: State<'_, QueryRegistry>,
    replay_guard: State<'_, OperationReplayGuard>,
    request: ExecuteQueryRequest,
) -> Result<QueryExecutionResult, CommandError> {
    request.validate().map_err(CommandError::from)?;
    replay_guard
        .claim(&request.query_id)
        .await
        .map_err(CommandError::from)?;
    let registered = queries
        .register(&request)
        .await
        .map_err(CommandError::from)?;
    let query_client = match connections
        .query_client(&request.session_id, &request.database)
        .await
    {
        Ok(query_client) => query_client,
        Err(error) => {
            registered.abort_preparation().await;
            queries.finish(&request.query_id, false).await;
            return Err(CommandError::from(error));
        }
    };
    registered.activate(query_client.canceller).await;
    let result = async { query::execute_request(&query_client.client, &request).await }.await;
    let cancelled = queries
        .finish(&request.query_id, query::is_postgres_cancellation(&result))
        .await;
    if cancelled {
        Err(CommandError::from(QueryError::Cancelled))
    } else {
        result.map_err(CommandError::from)
    }
}

#[tauri::command]
pub async fn cancel_query(
    queries: State<'_, QueryRegistry>,
    request: CancelQueryRequest,
) -> Result<CancelQueryResult, CommandError> {
    queries.cancel(request).await.map_err(CommandError::from)
}
