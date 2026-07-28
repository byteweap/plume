mod commands;
mod database;
mod error;

use commands::{
    connections::{connect_database, test_connection},
    metadata::{
        get_catalog_collection_items, get_catalog_tree, get_database_collection_items,
        get_database_tree, get_schema_objects, get_server_tree,
    },
};
use database::session::ConnectionRegistry;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(ConnectionRegistry::default())
        .invoke_handler(tauri::generate_handler![
            test_connection,
            connect_database,
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
