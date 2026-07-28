use tauri::State;

use crate::{
    database::{
        catalog::{
            CatalogCollectionKind, CatalogCollectionSummary, get_catalog_collection,
            get_catalog_collections,
        },
        metadata::{
            DatabaseCollectionKind, DatabaseCollectionSummary, DatabaseObject, NamedObject,
            ServerOverview, get_database_collection, get_database_collections, get_server_overview,
            list_schema_objects,
        },
        session::ConnectionRegistry,
    },
    error::CommandError,
};

#[tauri::command]
pub async fn get_server_tree(
    registry: State<'_, ConnectionRegistry>,
    session_id: String,
) -> Result<ServerOverview, CommandError> {
    let client = registry
        .primary_client(&session_id)
        .await
        .map_err(CommandError::from)?;
    get_server_overview(&client)
        .await
        .map_err(CommandError::from)
}

#[tauri::command]
pub async fn get_database_tree(
    registry: State<'_, ConnectionRegistry>,
    session_id: String,
    database: String,
) -> Result<Vec<DatabaseCollectionSummary>, CommandError> {
    let client = registry
        .database_client(&session_id, &database)
        .await
        .map_err(CommandError::from)?;
    get_database_collections(&client)
        .await
        .map_err(CommandError::from)
}

#[tauri::command]
pub async fn get_database_collection_items(
    registry: State<'_, ConnectionRegistry>,
    session_id: String,
    database: String,
    collection: DatabaseCollectionKind,
) -> Result<Vec<NamedObject>, CommandError> {
    let client = registry
        .database_client(&session_id, &database)
        .await
        .map_err(CommandError::from)?;
    get_database_collection(&client, collection)
        .await
        .map_err(CommandError::from)
}

#[tauri::command]
pub async fn get_schema_objects(
    registry: State<'_, ConnectionRegistry>,
    session_id: String,
    database: String,
    schema: String,
) -> Result<Vec<DatabaseObject>, CommandError> {
    let client = registry
        .database_client(&session_id, &database)
        .await
        .map_err(CommandError::from)?;
    list_schema_objects(&client, &schema)
        .await
        .map_err(CommandError::from)
}

#[tauri::command]
pub async fn get_catalog_tree(
    registry: State<'_, ConnectionRegistry>,
    session_id: String,
    database: String,
    catalog: String,
) -> Result<Vec<CatalogCollectionSummary>, CommandError> {
    let client = registry
        .database_client(&session_id, &database)
        .await
        .map_err(CommandError::from)?;
    get_catalog_collections(&client, &catalog)
        .await
        .map_err(CommandError::from)
}

#[tauri::command]
pub async fn get_catalog_collection_items(
    registry: State<'_, ConnectionRegistry>,
    session_id: String,
    database: String,
    catalog: String,
    collection: CatalogCollectionKind,
) -> Result<Vec<NamedObject>, CommandError> {
    let client = registry
        .database_client(&session_id, &database)
        .await
        .map_err(CommandError::from)?;
    get_catalog_collection(&client, &catalog, collection)
        .await
        .map_err(CommandError::from)
}
