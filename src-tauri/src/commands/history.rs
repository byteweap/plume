use tauri::State;

use crate::{
    error::CommandError,
    history::{
        ListQueryHistoryRequest, QueryHistory, QueryHistoryService, RecordQueryHistoryRequest,
    },
};

#[tauri::command]
pub fn record_query_history(
    service: State<'_, QueryHistoryService>,
    request: RecordQueryHistoryRequest,
) -> Result<QueryHistory, CommandError> {
    service.record(request).map_err(CommandError::from)
}

#[tauri::command]
pub fn list_query_history(
    service: State<'_, QueryHistoryService>,
    request: ListQueryHistoryRequest,
) -> Result<Vec<QueryHistory>, CommandError> {
    service.list(request).map_err(CommandError::from)
}

#[tauri::command]
pub fn clear_query_history(service: State<'_, QueryHistoryService>) -> Result<(), CommandError> {
    service.clear().map_err(CommandError::from)
}
