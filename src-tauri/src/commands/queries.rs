use tauri::State;

use crate::{
    database::{
        query::{self, ExecuteQueryRequest, QueryExecutionResult, QueryRegistry},
        session::ConnectionRegistry,
    },
    error::CommandError,
};

#[tauri::command]
pub async fn execute_query(
    connections: State<'_, ConnectionRegistry>,
    queries: State<'_, QueryRegistry>,
    request: ExecuteQueryRequest,
) -> Result<QueryExecutionResult, CommandError> {
    queries
        .register(&request)
        .await
        .map_err(CommandError::from)?;
    let result = async {
        let client = connections
            .database_client(&request.session_id, &request.database)
            .await?;
        query::execute(&client, request.query_id.clone(), &request.sql).await
    }
    .await;
    queries.finish(&request.query_id).await;
    result.map_err(CommandError::from)
}
