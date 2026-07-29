use tauri::State;

use crate::{
    drafts::{QueryDraft, QueryDraftIdRequest, QueryDraftService, SaveQueryDraftRequest},
    error::CommandError,
};

#[tauri::command]
pub fn list_query_drafts(
    service: State<'_, QueryDraftService>,
) -> Result<Vec<QueryDraft>, CommandError> {
    service.list().map_err(CommandError::from)
}

#[tauri::command]
pub fn save_query_draft(
    service: State<'_, QueryDraftService>,
    request: SaveQueryDraftRequest,
) -> Result<QueryDraft, CommandError> {
    service.save(request).map_err(CommandError::from)
}

#[tauri::command]
pub fn delete_query_draft(
    service: State<'_, QueryDraftService>,
    request: QueryDraftIdRequest,
) -> Result<(), CommandError> {
    service.delete(&request.id).map_err(CommandError::from)
}
