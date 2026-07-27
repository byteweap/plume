use crate::{
    database::{
        connection::{ConnectionTestRequest, ConnectionTestResult, open, test},
        session::ConnectionRegistry,
    },
    error::CommandError,
};

use serde::Serialize;
use tauri::State;

#[tauri::command]
pub async fn test_connection(
    request: ConnectionTestRequest,
) -> Result<ConnectionTestResult, CommandError> {
    test(&request).await.map_err(CommandError::from)
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectedDatabaseResult {
    pub session_id: String,
    #[serde(flatten)]
    pub connection: ConnectionTestResult,
}

#[tauri::command]
pub async fn connect_database(
    registry: State<'_, ConnectionRegistry>,
    request: ConnectionTestRequest,
) -> Result<ConnectedDatabaseResult, CommandError> {
    let connection = open(&request).await.map_err(CommandError::from)?;
    let session_id = registry.insert(request, connection.client).await;

    Ok(ConnectedDatabaseResult {
        session_id,
        connection: connection.result,
    })
}
