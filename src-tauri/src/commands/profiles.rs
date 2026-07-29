use tauri::State;

use crate::{
    error::CommandError,
    profiles::{
        ConnectionProfile, ConnectionProfileService, FavoriteProfileRequest, ProfileIdRequest,
        ProfileWriteRequest, RenameProfileRequest,
    },
};

#[tauri::command]
pub fn list_connection_profiles(
    service: State<'_, ConnectionProfileService>,
) -> Result<Vec<ConnectionProfile>, CommandError> {
    service.list().map_err(CommandError::from)
}

#[tauri::command]
pub fn create_connection_profile(
    service: State<'_, ConnectionProfileService>,
    request: ProfileWriteRequest,
) -> Result<ConnectionProfile, CommandError> {
    service.create(request).map_err(CommandError::from)
}

#[tauri::command]
pub fn update_connection_profile(
    service: State<'_, ConnectionProfileService>,
    request: ProfileWriteRequest,
) -> Result<ConnectionProfile, CommandError> {
    service.update(request).map_err(CommandError::from)
}

#[tauri::command]
pub fn duplicate_connection_profile(
    service: State<'_, ConnectionProfileService>,
    request: ProfileIdRequest,
) -> Result<ConnectionProfile, CommandError> {
    service.duplicate(&request.id).map_err(CommandError::from)
}

#[tauri::command]
pub fn rename_connection_profile(
    service: State<'_, ConnectionProfileService>,
    request: RenameProfileRequest,
) -> Result<ConnectionProfile, CommandError> {
    service
        .rename(&request.id, &request.name)
        .map_err(CommandError::from)
}

#[tauri::command]
pub fn set_connection_favorite(
    service: State<'_, ConnectionProfileService>,
    request: FavoriteProfileRequest,
) -> Result<ConnectionProfile, CommandError> {
    service
        .set_favorite(&request.id, request.favorite)
        .map_err(CommandError::from)
}

#[tauri::command]
pub fn delete_connection_profile(
    service: State<'_, ConnectionProfileService>,
    request: ProfileIdRequest,
) -> Result<(), CommandError> {
    service.delete(&request.id).map_err(CommandError::from)
}
