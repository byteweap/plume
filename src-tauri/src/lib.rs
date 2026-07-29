mod commands;
mod credentials;
mod database;
mod error;
mod profiles;

use commands::{
    connections::{
        connect_database, connect_saved_database, test_connection, test_connection_profile,
    },
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
                ConnectionProfileService::open(database_path, platform_credential_store())?;
            app.manage(profiles);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            test_connection,
            test_connection_profile,
            connect_database,
            connect_saved_database,
            list_connection_profiles,
            create_connection_profile,
            update_connection_profile,
            duplicate_connection_profile,
            rename_connection_profile,
            set_connection_favorite,
            delete_connection_profile,
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
