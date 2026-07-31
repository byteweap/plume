use tauri::State;

use crate::{
    error::CommandError,
    history::{QueryHistory, QueryHistoryService, RecordQueryHistoryRequest},
};

#[tauri::command]
pub fn record_query_history(
    service: State<'_, QueryHistoryService>,
    request: RecordQueryHistoryRequest,
) -> Result<QueryHistory, CommandError> {
    service.record(request).map_err(CommandError::from)
}
