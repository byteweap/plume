mod commands;
mod credentials;
mod database;
mod drafts;
mod error;
mod profiles;

use commands::{
    connections::{
        check_database_session, connect_database, connect_saved_database, disconnect_database,
        reconnect_saved_database, test_connection, test_connection_profile,
    },
    drafts::{delete_query_draft, list_query_drafts, save_query_draft},
    metadata::{
        get_catalog_collection_items, get_catalog_tree, get_database_collection_items,
        get_database_tree, get_schema_objects, get_server_tree,
    },
    profiles::{
        create_connection_profile, delete_connection_profile, duplicate_connection_profile,
        list_connection_profiles, rename_connection_profile, set_connection_favorite,
        update_connection_profile,
    },
};
use credentials::platform_credential_store;
use database::session::ConnectionRegistry;
use drafts::QueryDraftService;
use profiles::ConnectionProfileService;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(ConnectionRegistry::default())
        .setup(|app| {
            let database_path = app.path().app_data_dir()?.join("plume.sqlite3");
            let profiles =
                ConnectionProfileService::open(database_path.clone(), platform_credential_store())?;
            let drafts = QueryDraftService::open(database_path)?;
            app.manage(profiles);
            app.manage(drafts);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            test_connection,
            test_connection_profile,
            connect_database,
            connect_saved_database,
            reconnect_saved_database,
            disconnect_database,
            check_database_session,
            list_connection_profiles,
            create_connection_profile,
            update_connection_profile,
            duplicate_connection_profile,
            rename_connection_profile,
            set_connection_favorite,
            delete_connection_profile,
            list_query_drafts,
            save_query_draft,
            delete_query_draft,
            get_server_tree,
            get_database_tree,
            get_database_collection_items,
            get_schema_objects,
            get_catalog_tree,
            get_catalog_collection_items
        ])
        .run(tauri::generate_context!())
        .expect("failed to run Plume");
}
