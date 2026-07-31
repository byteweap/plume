use tauri::State;

use crate::{
    database::{
        session::ConnectionRegistry,
        table_data::{self, CommitTableDataRequest, CommitTableDataResult},
    },
    error::CommandError,
    replay::OperationReplayGuard,
};

#[tauri::command]
pub async fn commit_table_data_changes(
    connections: State<'_, ConnectionRegistry>,
    replay_guard: State<'_, OperationReplayGuard>,
    request: CommitTableDataRequest,
) -> Result<CommitTableDataResult, CommandError> {
    request.validate().map_err(CommandError::from)?;
    replay_guard
        .claim(&request.request_id)
        .await
        .map_err(CommandError::from)?;
    let mut client = connections
        .dedicated_client(&request.session_id, &request.database)
        .await
        .map_err(CommandError::from)?;
    table_data::commit(&mut client, &request)
        .await
        .map_err(CommandError::from)
}
