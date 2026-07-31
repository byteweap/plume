mod commands;
mod credentials;
mod database;
mod diagnostics;
mod drafts;
mod error;
mod exports;
mod history;
mod local_data;
mod profiles;
mod replay;
mod workspace;

use commands::{
    connections::{
        check_database_session, connect_database, connect_saved_database, disconnect_database,
        reconnect_saved_database, test_connection, test_connection_profile,
    },
    drafts::{delete_query_draft, list_query_drafts, save_query_draft},
    exports::{cancel_export, export_csv, export_json},
    history::{clear_query_history, list_query_history, record_query_history},
    local_data::clear_local_data,
    metadata::{
        get_catalog_collection_items, get_catalog_tree, get_database_collection_items,
        get_database_tree, get_schema_objects, get_server_tree, get_sql_completions,
        get_table_data_editability,
    },
    profiles::{
        create_connection_profile, delete_connection_profile, duplicate_connection_profile,
        list_connection_profiles, rename_connection_profile, set_connection_favorite,
        update_connection_profile,
    },
    queries::{cancel_query, execute_query},
    table_data::commit_table_data_changes,
    workspace::{load_workspace_snapshot, save_workspace_snapshot},
};
use credentials::platform_credential_store;
use database::query::QueryRegistry;
use database::session::ConnectionRegistry;
use drafts::QueryDraftService;
use exports::ExportRegistry;
use history::QueryHistoryService;
use local_data::LocalDataService;
use profiles::ConnectionProfileService;
use replay::OperationReplayGuard;
use tauri::Manager;
use workspace::WorkspaceSnapshotService;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    diagnostics::install_panic_hook();

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(ConnectionRegistry::default())
        .manage(QueryRegistry::default())
        .manage(ExportRegistry::default())
        .manage(OperationReplayGuard::default())
        .setup(|app| {
            let database_path = app.path().app_data_dir()?.join("plume.sqlite3");
            let profiles =
                ConnectionProfileService::open(database_path.clone(), platform_credential_store())?;
            let drafts = QueryDraftService::open(database_path.clone())?;
            let history = QueryHistoryService::open(database_path.clone())?;
            let workspace = WorkspaceSnapshotService::open(database_path.clone())?;
            let local_data = LocalDataService::open(database_path)?;
            app.manage(profiles);
            app.manage(drafts);
            app.manage(history);
            app.manage(workspace);
            app.manage(local_data);
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
            get_table_data_editability,
            get_sql_completions,
            get_catalog_tree,
            get_catalog_collection_items,
            execute_query,
            cancel_query,
            commit_table_data_changes,
            export_csv,
            export_json,
            cancel_export,
            record_query_history,
            list_query_history,
            clear_query_history,
            save_workspace_snapshot,
            load_workspace_snapshot,
            clear_local_data
        ])
        .run(tauri::generate_context!())
        .expect("failed to run Plume");
}
