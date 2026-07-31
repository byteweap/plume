mod commands;
mod credentials;
mod database;
mod drafts;
mod error;
mod exports;
mod profiles;

use commands::{
    connections::{
        check_database_session, connect_database, connect_saved_database, disconnect_database,
        reconnect_saved_database, test_connection, test_connection_profile,
    },
    drafts::{delete_query_draft, list_query_drafts, save_query_draft},
    exports::{cancel_export, export_csv, export_json},
    metadata::{
        get_catalog_collection_items, get_catalog_tree, get_database_collection_items,
        get_database_tree, get_schema_objects, get_server_tree, get_sql_completions,
    },
    profiles::{
        create_connection_profile, delete_connection_profile, duplicate_connection_profile,
        list_connection_profiles, rename_connection_profile, set_connection_favorite,
        update_connection_profile,
    },
    queries::{cancel_query, execute_query},
};
use credentials::platform_credential_store;
use database::query::QueryRegistry;
use database::session::ConnectionRegistry;
use drafts::QueryDraftService;
use exports::ExportRegistry;
use profiles::ConnectionProfileService;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(ConnectionRegistry::default())
        .manage(QueryRegistry::default())
        .manage(ExportRegistry::default())
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
            get_sql_completions,
            get_catalog_tree,
            get_catalog_collection_items,
            execute_query,
            cancel_query,
            export_csv,
            export_json,
            cancel_export
        ])
        .run(tauri::generate_context!())
        .expect("failed to run Plume");
}
