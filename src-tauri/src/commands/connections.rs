use crate::{
    database::{
        connection::{ConnectionTestRequest, ConnectionTestResult, open, test},
        session::ConnectionRegistry,
    },
    error::CommandError,
    profiles::{ConnectionProfileService, ProfileIdRequest, ProfileWriteRequest},
};

use serde::Serialize;
use tauri::State;

#[tauri::command]
pub async fn test_connection(
    request: ConnectionTestRequest,
) -> Result<ConnectionTestResult, CommandError> {
    test(&request).await.map_err(CommandError::from)
}

#[tauri::command]
pub async fn test_connection_profile(
    profiles: State<'_, ConnectionProfileService>,
    request: ProfileWriteRequest,
) -> Result<ConnectionTestResult, CommandError> {
    let settings = profiles
        .test_request(&request)
        .map_err(CommandError::from)?;
    test(&settings).await.map_err(CommandError::from)
}

#[tauri::command]
pub async fn connect_saved_database(
    profiles: State<'_, ConnectionProfileService>,
    registry: State<'_, ConnectionRegistry>,
    request: ProfileIdRequest,
) -> Result<ConnectedDatabaseResult, CommandError> {
    let settings = profiles
        .connection_request(&request.id)
        .map_err(CommandError::from)?;
    let connection = open(&settings).await.map_err(CommandError::from)?;
    let session_id = registry.insert(settings, connection.client).await;

    Ok(ConnectedDatabaseResult {
        session_id,
        connection: connection.result,
    })
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
