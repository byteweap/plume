use tauri::State;

use crate::{
    error::CommandError,
    local_data::{LocalDataScope, LocalDataService},
    profiles::ConnectionProfileService,
};

#[tauri::command]
pub fn clear_local_data(
    data: State<'_, LocalDataService>,
    profiles: State<'_, ConnectionProfileService>,
    scope: LocalDataScope,
) -> Result<(), CommandError> {
    if matches!(scope, LocalDataScope::All) {
        profiles.clear_all().map_err(CommandError::from)?;
    }
    data.clear(scope).map_err(CommandError::from)
}
