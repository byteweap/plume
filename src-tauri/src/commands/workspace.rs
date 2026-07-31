use tauri::State;

use crate::{
    error::CommandError,
    workspace::{SaveWorkspaceSnapshotRequest, WorkspaceSnapshot, WorkspaceSnapshotService},
};

#[tauri::command]
pub fn save_workspace_snapshot(
    service: State<'_, WorkspaceSnapshotService>,
    request: SaveWorkspaceSnapshotRequest,
) -> Result<WorkspaceSnapshot, CommandError> {
    service.save(request).map_err(CommandError::from)
}

#[tauri::command]
pub fn load_workspace_snapshot(
    service: State<'_, WorkspaceSnapshotService>,
) -> Result<Option<WorkspaceSnapshot>, CommandError> {
    service.load().map_err(CommandError::from)
}
