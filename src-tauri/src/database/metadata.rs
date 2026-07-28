use serde::{Deserialize, Serialize};
use tokio_postgres::{Client, Row};

use crate::error::DatabaseError;

// PostgreSQL reserves lower OIDs for built-in objects. pgAdmin uses the same
// boundary when its "Show system objects" preference is disabled.
const FIRST_USER_OBJECT_OID: i64 = 16_384;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NamedObject {
    pub name: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseSummary {
    pub name: String,
    pub owner: String,
    pub allow_connections: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RoleSummary {
    pub name: String,
    pub can_login: bool,
    pub superuser: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerOverview {
    pub databases: Vec<DatabaseSummary>,
    pub roles: Vec<RoleSummary>,
    pub tablespaces: Vec<NamedObject>,
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum DatabaseCollectionKind {
    Casts,
    Catalogs,
    EventTriggers,
    Extensions,
    ForeignDataWrappers,
    Languages,
    Publications,
    Schemas,
    Subscriptions,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseCollectionSummary {
    pub kind: DatabaseCollectionKind,
    pub count: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseObject {
    pub name: String,
    pub kind: DatabaseObjectKind,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum DatabaseObjectKind {
    Table,
    ForeignTable,
    View,
    MaterializedView,
    Sequence,
    Function,
    Procedure,
    Type,
}

pub async fn get_server_overview(client: &Client) -> Result<ServerOverview, DatabaseError> {
    let database_rows = client
        .query(
            "SELECT datname, pg_catalog.pg_get_userbyid(datdba), datallowconn
             FROM pg_catalog.pg_database
             WHERE NOT datistemplate
             ORDER BY datname",
            &[],
        )
        .await?;
    let role_rows = client
        .query(
            "SELECT rolname, rolcanlogin, rolsuper
             FROM pg_catalog.pg_roles
             ORDER BY rolname",
            &[],
        )
        .await?;
    let tablespace_rows = client
        .query(
            "SELECT spcname FROM pg_catalog.pg_tablespace ORDER BY spcname",
            &[],
        )
        .await?;

    Ok(ServerOverview {
        databases: database_rows
            .into_iter()
            .map(|row| DatabaseSummary {
                name: row.get(0),
                owner: row.get(1),
                allow_connections: row.get(2),
            })
            .collect(),
        roles: role_rows
            .into_iter()
            .map(|row| RoleSummary {
                name: row.get(0),
                can_login: row.get(1),
                superuser: row.get(2),
            })
            .collect(),
        tablespaces: tablespace_rows
            .into_iter()
            .map(|row| NamedObject { name: row.get(0) })
            .collect(),
    })
}

pub async fn get_database_collections(
    client: &Client,
) -> Result<Vec<DatabaseCollectionSummary>, DatabaseError> {
    let row = client
        .query_one(
            "SELECT
               (SELECT count(*) FROM pg_catalog.pg_cast WHERE oid::bigint >= $1),
               (SELECT count(*) FROM pg_catalog.pg_namespace
                  WHERE nspname LIKE 'pg\\_%' ESCAPE '\\' OR nspname = 'information_schema'),
               (SELECT count(*) FROM pg_catalog.pg_event_trigger),
               (SELECT count(*) FROM pg_catalog.pg_extension),
               (SELECT count(*) FROM pg_catalog.pg_foreign_data_wrapper),
               (SELECT count(*) FROM pg_catalog.pg_language),
               (SELECT count(*) FROM pg_catalog.pg_publication),
               (SELECT count(*) FROM pg_catalog.pg_namespace
                  WHERE nspname NOT LIKE 'pg\\_%' ESCAPE '\\' AND nspname <> 'information_schema'),
               (SELECT count(*) FROM pg_catalog.pg_subscription)",
            &[&FIRST_USER_OBJECT_OID],
        )
        .await?;

    let kinds = [
        DatabaseCollectionKind::Casts,
        DatabaseCollectionKind::Catalogs,
        DatabaseCollectionKind::EventTriggers,
        DatabaseCollectionKind::Extensions,
        DatabaseCollectionKind::ForeignDataWrappers,
        DatabaseCollectionKind::Languages,
        DatabaseCollectionKind::Publications,
        DatabaseCollectionKind::Schemas,
        DatabaseCollectionKind::Subscriptions,
    ];

    Ok(kinds
        .into_iter()
        .enumerate()
        .map(|(index, kind)| DatabaseCollectionSummary {
            kind,
            count: row.get(index),
        })
        .collect())
}

pub async fn get_database_collection(
    client: &Client,
    kind: DatabaseCollectionKind,
) -> Result<Vec<NamedObject>, DatabaseError> {
    let query = match kind {
        DatabaseCollectionKind::Casts => return get_user_casts(client).await,
        DatabaseCollectionKind::Catalogs => {
            "SELECT nspname
             FROM pg_catalog.pg_namespace
             WHERE nspname LIKE 'pg\\_%' ESCAPE '\\' OR nspname = 'information_schema'
             ORDER BY nspname"
        }
        DatabaseCollectionKind::EventTriggers => {
            "SELECT evtname FROM pg_catalog.pg_event_trigger ORDER BY evtname"
        }
        DatabaseCollectionKind::Extensions => {
            "SELECT extname FROM pg_catalog.pg_extension ORDER BY extname"
        }
        DatabaseCollectionKind::ForeignDataWrappers => {
            "SELECT fdwname FROM pg_catalog.pg_foreign_data_wrapper ORDER BY fdwname"
        }
        DatabaseCollectionKind::Languages => {
            "SELECT lanname FROM pg_catalog.pg_language ORDER BY lanname"
        }
        DatabaseCollectionKind::Publications => {
            "SELECT pubname FROM pg_catalog.pg_publication ORDER BY pubname"
        }
        DatabaseCollectionKind::Schemas => {
            "SELECT nspname
             FROM pg_catalog.pg_namespace
             WHERE nspname NOT LIKE 'pg\\_%' ESCAPE '\\'
               AND nspname <> 'information_schema'
             ORDER BY nspname"
        }
        DatabaseCollectionKind::Subscriptions => {
            "SELECT subname FROM pg_catalog.pg_subscription ORDER BY subname"
        }
    };

    let rows = client.query(query, &[]).await?;
    Ok(named_objects(rows))
}

async fn get_user_casts(client: &Client) -> Result<Vec<NamedObject>, DatabaseError> {
    let rows = client
        .query(
            "SELECT pg_catalog.concat(
                       pg_catalog.format_type(source_type.oid, NULL),
                       '->',
                       pg_catalog.format_type(target_type.oid, target_type.typtypmod)
                    )
             FROM pg_catalog.pg_cast cast_definition
             JOIN pg_catalog.pg_type source_type
               ON source_type.oid = cast_definition.castsource
             JOIN pg_catalog.pg_type target_type
               ON target_type.oid = cast_definition.casttarget
             WHERE cast_definition.oid::bigint >= $1
             ORDER BY source_type.typname, target_type.typname",
            &[&FIRST_USER_OBJECT_OID],
        )
        .await?;

    Ok(named_objects(rows))
}

fn named_objects(rows: Vec<Row>) -> Vec<NamedObject> {
    rows.into_iter()
        .map(|row| NamedObject { name: row.get(0) })
        .collect()
}

pub async fn list_schema_objects(
    client: &Client,
    schema: &str,
) -> Result<Vec<DatabaseObject>, DatabaseError> {
    let rows = client
        .query(
            "SELECT object_name, object_kind
             FROM (
               SELECT c.relname AS object_name,
                      CASE c.relkind
                        WHEN 'r' THEN 'table'
                        WHEN 'p' THEN 'table'
                        WHEN 'f' THEN 'foreign-table'
                        WHEN 'v' THEN 'view'
                        WHEN 'm' THEN 'materialized-view'
                        WHEN 'S' THEN 'sequence'
                      END AS object_kind
               FROM pg_catalog.pg_class c
               JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
               WHERE n.nspname = $1
                 AND c.relkind IN ('r', 'p', 'f', 'v', 'm', 'S')

               UNION ALL

               SELECT p.proname || '(' || pg_catalog.pg_get_function_identity_arguments(p.oid) || ')',
                      CASE p.prokind WHEN 'p' THEN 'procedure' ELSE 'function' END
               FROM pg_catalog.pg_proc p
               JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
               WHERE n.nspname = $1
                 AND p.prokind IN ('f', 'p')

               UNION ALL

               SELECT pg_catalog.format_type(t.oid, NULL), 'type'
               FROM pg_catalog.pg_type t
               JOIN pg_catalog.pg_namespace n ON n.oid = t.typnamespace
               WHERE n.nspname = $1
                 AND t.typtype IN ('c', 'd', 'e', 'r')
                 AND NOT EXISTS (
                   SELECT 1 FROM pg_catalog.pg_class c
                   WHERE c.reltype = t.oid AND c.relkind IN ('r', 'p', 'f', 'v', 'm')
                 )
             ) objects
             ORDER BY object_kind, object_name",
            &[&schema],
        )
        .await?;

    rows.into_iter()
        .map(|row| {
            let kind: String = row.get(1);
            Ok(DatabaseObject {
                name: row.get(0),
                kind: parse_object_kind(&kind)?,
            })
        })
        .collect()
}

fn parse_object_kind(kind: &str) -> Result<DatabaseObjectKind, DatabaseError> {
    match kind {
        "table" => Ok(DatabaseObjectKind::Table),
        "foreign-table" => Ok(DatabaseObjectKind::ForeignTable),
        "view" => Ok(DatabaseObjectKind::View),
        "materialized-view" => Ok(DatabaseObjectKind::MaterializedView),
        "sequence" => Ok(DatabaseObjectKind::Sequence),
        "function" => Ok(DatabaseObjectKind::Function),
        "procedure" => Ok(DatabaseObjectKind::Procedure),
        "type" => Ok(DatabaseObjectKind::Type),
        unexpected => Err(DatabaseError::UnexpectedMetadata(unexpected.to_owned())),
    }
}

#[cfg(test)]
mod tests {
    use super::{
        DatabaseCollectionKind, DatabaseObjectKind, get_database_collection,
        get_database_collections, get_server_overview, list_schema_objects, parse_object_kind,
    };
    use crate::error::DatabaseError;

    #[test]
    fn parses_supported_object_kinds() {
        assert!(matches!(
            parse_object_kind("foreign-table"),
            Ok(DatabaseObjectKind::ForeignTable)
        ));
        assert!(matches!(
            parse_object_kind("procedure"),
            Ok(DatabaseObjectKind::Procedure)
        ));
    }

    #[test]
    fn rejects_unknown_object_kinds() {
        assert!(parse_object_kind("unknown").is_err());
    }

    #[test]
    #[ignore = "requires PLUME_TEST_DATABASE_CONFIG and a local PostgreSQL instance"]
    fn loads_the_pgadmin_style_tree_from_postgres() {
        tauri::async_runtime::block_on(async {
            let config = std::env::var("PLUME_TEST_DATABASE_CONFIG")
                .expect("PLUME_TEST_DATABASE_CONFIG must contain libpq connection parameters");
            let config: tokio_postgres::Config =
                config.parse().expect("database config should be valid");
            let (client, connection) = config
                .connect(tokio_postgres::NoTls)
                .await
                .expect("local PostgreSQL should accept the connection");
            tauri::async_runtime::spawn(async move {
                connection
                    .await
                    .expect("PostgreSQL connection should remain open");
            });

            let validation: Result<(), DatabaseError> = async {
                client
                    .batch_execute(
                        "DROP SCHEMA IF EXISTS plume_navigation_test CASCADE;
                         CREATE SCHEMA plume_navigation_test;
                         CREATE TABLE plume_navigation_test.items (id bigint PRIMARY KEY);
                         CREATE VIEW plume_navigation_test.item_view AS
                           SELECT id FROM plume_navigation_test.items;
                         CREATE MATERIALIZED VIEW plume_navigation_test.item_snapshot AS
                           SELECT id FROM plume_navigation_test.items WITH NO DATA;
                         CREATE SEQUENCE plume_navigation_test.item_sequence;
                         CREATE FUNCTION plume_navigation_test.answer() RETURNS integer
                           LANGUAGE sql AS 'SELECT 42';
                         CREATE PROCEDURE plume_navigation_test.add_item()
                           LANGUAGE sql AS 'INSERT INTO plume_navigation_test.items DEFAULT VALUES';
                         CREATE TYPE plume_navigation_test.item_state AS ENUM ('active', 'archived');
                         CREATE TYPE plume_navigation_test.cast_source AS (value integer);
                         CREATE TYPE plume_navigation_test.cast_target AS (value integer);
                         CREATE FUNCTION plume_navigation_test.cast_source_to_target(
                           value plume_navigation_test.cast_source
                         ) RETURNS plume_navigation_test.cast_target
                           LANGUAGE sql IMMUTABLE STRICT
                           AS 'SELECT ROW(($1).value)::plume_navigation_test.cast_target';
                         CREATE CAST (
                           plume_navigation_test.cast_source AS plume_navigation_test.cast_target
                         ) WITH FUNCTION plume_navigation_test.cast_source_to_target(
                           plume_navigation_test.cast_source
                         );",
                    )
                    .await?;

                let server = get_server_overview(&client).await?;
                assert!(server.databases.iter().any(|database| database.name == "postgres"));
                assert!(server.roles.iter().any(|role| role.name == "root"));

                let collections = get_database_collections(&client).await?;
                assert_eq!(collections.len(), 9);
                let casts = get_database_collection(&client, DatabaseCollectionKind::Casts)
                    .await?;
                let cast_count = collections
                    .iter()
                    .find(|collection| matches!(collection.kind, DatabaseCollectionKind::Casts))
                    .expect("casts collection should be present")
                    .count;
                assert_eq!(cast_count, casts.len() as i64);
                assert!(casts.iter().any(|cast| {
                    cast.name
                        == "plume_navigation_test.cast_source->plume_navigation_test.cast_target"
                }));
                assert!(!casts.iter().any(|cast| cast.name == "bigint->integer"));
                let schemas = get_database_collection(&client, DatabaseCollectionKind::Schemas)
                    .await?;
                assert!(schemas.iter().any(|schema| schema.name == "plume_navigation_test"));

                let objects = list_schema_objects(&client, "plume_navigation_test").await?;
                for expected_kind in [
                    "table",
                    "view",
                    "materialized-view",
                    "sequence",
                    "function",
                    "procedure",
                    "type",
                ] {
                    assert!(
                        objects.iter().any(|object| {
                            serde_json::to_value(&object.kind)
                                .is_ok_and(|value| value == expected_kind)
                        }),
                        "missing object kind: {expected_kind}"
                    );
                }

                Ok(())
            }
            .await;

            client
                .batch_execute("DROP SCHEMA IF EXISTS plume_navigation_test CASCADE")
                .await
                .expect("test schema cleanup should succeed");
            validation.expect("PostgreSQL navigation metadata should load");
        });
    }
}
