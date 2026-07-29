use crate::{
    database::{
        connection::{ConnectionTestRequest, ConnectionTestResult, open, test},
        session::{ConnectionRegistry, SessionHealth},
    },
    error::CommandError,
    profiles::{ConnectionProfileService, ProfileIdRequest, ProfileWriteRequest},
};

use serde::{Deserialize, Serialize};
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
    let result = connection.result.clone();
    let session_id = registry.insert(connection).await;

    Ok(ConnectedDatabaseResult {
        session_id,
        connection: result,
    })
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionIdRequest {
    pub session_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReconnectSavedRequest {
    pub profile_id: String,
    pub session_id: String,
}

#[tauri::command]
pub async fn check_database_session(
    registry: State<'_, ConnectionRegistry>,
    request: SessionIdRequest,
) -> Result<SessionHealth, CommandError> {
    registry
        .health(&request.session_id)
        .await
        .map_err(CommandError::from)
}

#[tauri::command]
pub async fn disconnect_database(
    registry: State<'_, ConnectionRegistry>,
    request: SessionIdRequest,
) -> Result<(), CommandError> {
    registry
        .remove(&request.session_id)
        .await
        .map_err(CommandError::from)
}

#[tauri::command]
pub async fn reconnect_saved_database(
    profiles: State<'_, ConnectionProfileService>,
    registry: State<'_, ConnectionRegistry>,
    request: ReconnectSavedRequest,
) -> Result<ConnectedDatabaseResult, CommandError> {
    let settings = profiles
        .connection_request(&request.profile_id)
        .map_err(CommandError::from)?;
    let connection = open(&settings).await.map_err(CommandError::from)?;
    let result = connection.result.clone();
    let session_id = registry.insert(connection).await;

    // The replacement is already usable before the old session is removed.
    // No database operation from the old session is replayed.
    let _ = registry.remove(&request.session_id).await;

    Ok(ConnectedDatabaseResult {
        session_id,
        connection: result,
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
    let result = connection.result.clone();
    let session_id = registry.insert(connection).await;

    Ok(ConnectedDatabaseResult {
        session_id,
        connection: result,
    })
}
