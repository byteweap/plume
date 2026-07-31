use serde::{Deserialize, Serialize};
use tokio_postgres::{Client, Row};

use crate::error::DatabaseError;

// PostgreSQL reserves lower OIDs for built-in objects. pgAdmin uses the same
// boundary when its "Show system objects" preference is disabled.
const FIRST_USER_OBJECT_OID: i64 = 16_384;

const PGADMIN_CATALOG_PREDICATE: &str = "
    (
        catalog_namespace.nspname = 'information_schema'
        AND EXISTS (
            SELECT 1 FROM pg_catalog.pg_class catalog_object
             WHERE catalog_object.relname = 'tables'
               AND catalog_object.relnamespace = catalog_namespace.oid
        )
    )
    OR (
        catalog_namespace.nspname = 'pg_catalog'
        AND EXISTS (
            SELECT 1 FROM pg_catalog.pg_class catalog_object
             WHERE catalog_object.relname = 'pg_class'
               AND catalog_object.relnamespace = catalog_namespace.oid
        )
    )
    OR (
        catalog_namespace.nspname = 'pgagent'
        AND EXISTS (
            SELECT 1 FROM pg_catalog.pg_class catalog_object
             WHERE catalog_object.relname = 'pga_job'
               AND catalog_object.relnamespace = catalog_namespace.oid
        )
    )";

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

#[derive(Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TableEditability {
    pub editable: bool,
    pub key: Option<TableIdentityKey>,
    pub reason: Option<TableReadOnlyReason>,
}

#[derive(Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TableIdentityKey {
    pub name: String,
    pub kind: TableIdentityKeyKind,
    pub columns: Vec<String>,
}

#[derive(Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum TableIdentityKeyKind {
    PrimaryKey,
    UniqueKey,
}

#[derive(Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum TableReadOnlyReason {
    NoReliableKey,
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

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SqlCompletionCatalog {
    pub schemas: Vec<SqlCompletionSchema>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SqlCompletionSchema {
    pub name: String,
    pub relations: Vec<SqlCompletionRelation>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SqlCompletionRelation {
    pub name: String,
    pub kind: SqlCompletionRelationKind,
    pub columns: Vec<String>,
}

#[derive(Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum SqlCompletionRelationKind {
    Table,
    ForeignTable,
    View,
    MaterializedView,
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
    let query = format!(
        "SELECT
           (SELECT count(*) FROM pg_catalog.pg_cast WHERE oid::bigint >= $1),
           (SELECT count(*)
              FROM pg_catalog.pg_namespace catalog_namespace
             WHERE {PGADMIN_CATALOG_PREDICATE}),
           (SELECT count(*) FROM pg_catalog.pg_event_trigger),
           (SELECT count(*) FROM pg_catalog.pg_extension),
           (SELECT count(*) FROM pg_catalog.pg_foreign_data_wrapper),
           (SELECT count(*)
              FROM pg_catalog.pg_language language_definition
             WHERE language_definition.lanispl),
           (SELECT count(*) FROM pg_catalog.pg_publication),
           (SELECT count(*) FROM pg_catalog.pg_namespace
              WHERE nspname NOT LIKE 'pg\\_%' ESCAPE '\\' AND nspname <> 'information_schema'),
           (SELECT count(*) FROM pg_catalog.pg_subscription)"
    );
    let row = client
        .query_one(query.as_str(), &[&FIRST_USER_OBJECT_OID])
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
        DatabaseCollectionKind::Catalogs => return get_catalogs(client).await,
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
            "SELECT lanname
               FROM pg_catalog.pg_language
              WHERE lanispl
              ORDER BY lanname"
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

async fn get_catalogs(client: &Client) -> Result<Vec<NamedObject>, DatabaseError> {
    let query = format!(
        "SELECT catalog_namespace.nspname
           FROM pg_catalog.pg_namespace catalog_namespace
          WHERE {PGADMIN_CATALOG_PREDICATE}
          ORDER BY CASE catalog_namespace.nspname
                     WHEN 'information_schema' THEN 1
                     WHEN 'pg_catalog' THEN 2
                     WHEN 'pgagent' THEN 3
                   END"
    );
    let rows = client.query(query.as_str(), &[]).await?;

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

pub async fn get_table_editability(
    client: &Client,
    schema: &str,
    table: &str,
) -> Result<TableEditability, DatabaseError> {
    let row = client
        .query_opt(
            "SELECT index_relation.relname,
                    index_definition.indisprimary,
                    pg_catalog.array_agg(attribute.attname ORDER BY key_column.ordinality)
               FROM pg_catalog.pg_class relation
               JOIN pg_catalog.pg_namespace namespace
                 ON namespace.oid = relation.relnamespace
               JOIN pg_catalog.pg_index index_definition
                 ON index_definition.indrelid = relation.oid
               JOIN pg_catalog.pg_class index_relation
                 ON index_relation.oid = index_definition.indexrelid
               CROSS JOIN LATERAL pg_catalog.unnest(index_definition.indkey)
                 WITH ORDINALITY AS key_column(attribute_number, ordinality)
               JOIN pg_catalog.pg_attribute attribute
                 ON attribute.attrelid = relation.oid
                AND attribute.attnum = key_column.attribute_number
              WHERE namespace.nspname = $1
                AND relation.relname = $2
                AND relation.relkind IN ('r', 'p')
                AND index_definition.indisunique
                AND index_definition.indisvalid
                AND index_definition.indisready
                AND index_definition.indislive
                AND index_definition.indimmediate
                AND index_definition.indpred IS NULL
                AND index_definition.indexprs IS NULL
                AND key_column.ordinality <= index_definition.indnkeyatts
              GROUP BY index_relation.oid,
                       index_relation.relname,
                       index_definition.indisprimary,
                       index_definition.indnkeyatts
             HAVING pg_catalog.count(*) = index_definition.indnkeyatts
                AND pg_catalog.bool_and(attribute.attnotnull)
              ORDER BY index_definition.indisprimary DESC,
                       index_definition.indnkeyatts,
                       index_relation.oid
              LIMIT 1",
            &[&schema, &table],
        )
        .await?;

    let Some(row) = row else {
        return Ok(TableEditability {
            editable: false,
            key: None,
            reason: Some(TableReadOnlyReason::NoReliableKey),
        });
    };
    let primary: bool = row.get(1);
    Ok(TableEditability {
        editable: true,
        key: Some(TableIdentityKey {
            name: row.get(0),
            kind: if primary {
                TableIdentityKeyKind::PrimaryKey
            } else {
                TableIdentityKeyKind::UniqueKey
            },
            columns: row.get(2),
        }),
        reason: None,
    })
}

pub async fn get_sql_completion_catalog(
    client: &Client,
) -> Result<SqlCompletionCatalog, DatabaseError> {
    let rows = client
        .query(
            "SELECT namespace.nspname,
                    relation.relname,
                    relation.relkind::text,
                    attribute.attname
               FROM pg_catalog.pg_namespace namespace
               LEFT JOIN pg_catalog.pg_class relation
                 ON relation.relnamespace = namespace.oid
                AND relation.relkind IN ('r', 'p', 'f', 'v', 'm')
               LEFT JOIN pg_catalog.pg_attribute attribute
                 ON attribute.attrelid = relation.oid
                AND attribute.attnum > 0
                AND NOT attribute.attisdropped
              WHERE namespace.nspname NOT LIKE 'pg\\_%' ESCAPE '\\'
                AND namespace.nspname <> 'information_schema'
                AND pg_catalog.has_schema_privilege(namespace.oid, 'USAGE')
              ORDER BY namespace.nspname, relation.relname, attribute.attnum",
            &[],
        )
        .await?;

    let mut schemas: Vec<SqlCompletionSchema> = Vec::new();
    for row in rows {
        let schema_name: String = row.get(0);
        if schemas
            .last()
            .is_none_or(|schema| schema.name != schema_name)
        {
            schemas.push(SqlCompletionSchema {
                name: schema_name,
                relations: Vec::new(),
            });
        }

        let schema = schemas.last_mut().expect("a schema was inserted above");
        let Some(relation_name) = row.get::<_, Option<String>>(1) else {
            continue;
        };
        if schema
            .relations
            .last()
            .is_none_or(|relation| relation.name != relation_name)
        {
            let relation_kind: String = row
                .get::<_, Option<String>>(2)
                .expect("relations returned for completion have a kind");
            schema.relations.push(SqlCompletionRelation {
                name: relation_name,
                kind: parse_completion_relation_kind(&relation_kind)?,
                columns: Vec::new(),
            });
        }

        if let Some(column) = row.get::<_, Option<String>>(3) {
            schema
                .relations
                .last_mut()
                .expect("a relation was inserted above")
                .columns
                .push(column);
        }
    }

    Ok(SqlCompletionCatalog { schemas })
}

fn parse_completion_relation_kind(kind: &str) -> Result<SqlCompletionRelationKind, DatabaseError> {
    match kind {
        "r" | "p" => Ok(SqlCompletionRelationKind::Table),
        "f" => Ok(SqlCompletionRelationKind::ForeignTable),
        "v" => Ok(SqlCompletionRelationKind::View),
        "m" => Ok(SqlCompletionRelationKind::MaterializedView),
        unexpected => Err(DatabaseError::UnexpectedMetadata(unexpected.to_owned())),
    }
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
    use crate::database::catalog::{
        CatalogCollectionKind, get_catalog_collection, get_catalog_collections,
    };

    use super::{
        DatabaseCollectionKind, DatabaseObjectKind, TableIdentityKeyKind, TableReadOnlyReason,
        get_database_collection, get_database_collections, get_server_overview,
        get_sql_completion_catalog, get_table_editability, list_schema_objects, parse_object_kind,
    };
    use crate::{database::test_support, error::DatabaseError};

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
    #[ignore = "requires the local PostgreSQL integration environment"]
    fn identifies_only_reliable_table_keys() {
        tauri::async_runtime::block_on(async {
            let client = test_support::connect().await;
            client
                .batch_execute(
                    "DROP SCHEMA IF EXISTS plume_editability_test CASCADE;
                     CREATE SCHEMA plume_editability_test;
                     CREATE TABLE plume_editability_test.primary_table (
                       id bigint PRIMARY KEY,
                       code text NOT NULL UNIQUE
                     );
                     CREATE TABLE plume_editability_test.unique_table (
                       tenant_id bigint NOT NULL,
                       external_id text NOT NULL,
                       UNIQUE (tenant_id, external_id)
                     );
                     CREATE TABLE plume_editability_test.unsafe_table (
                       id bigint,
                       email text UNIQUE,
                       code text NOT NULL,
                       UNIQUE (code) DEFERRABLE
                     );
                     CREATE UNIQUE INDEX unsafe_partial
                       ON plume_editability_test.unsafe_table (code)
                       WHERE id IS NOT NULL;
                     CREATE UNIQUE INDEX unsafe_expression
                       ON plume_editability_test.unsafe_table (lower(code));",
                )
                .await
                .expect("editability fixtures should be created");

            let validation: Result<(), DatabaseError> = async {
                let primary =
                    get_table_editability(&client, "plume_editability_test", "primary_table")
                        .await?;
                assert!(primary.editable);
                let primary_key = primary.key.expect("primary key should be selected");
                assert_eq!(primary_key.kind, TableIdentityKeyKind::PrimaryKey);
                assert_eq!(primary_key.columns, ["id"]);

                let unique =
                    get_table_editability(&client, "plume_editability_test", "unique_table")
                        .await?;
                let unique_key = unique.key.expect("non-null unique key should be selected");
                assert_eq!(unique_key.kind, TableIdentityKeyKind::UniqueKey);
                assert_eq!(unique_key.columns, ["tenant_id", "external_id"]);

                let unsafe_table =
                    get_table_editability(&client, "plume_editability_test", "unsafe_table")
                        .await?;
                assert!(!unsafe_table.editable);
                assert_eq!(unsafe_table.key, None);
                assert_eq!(
                    unsafe_table.reason,
                    Some(TableReadOnlyReason::NoReliableKey)
                );
                Ok(())
            }
            .await;

            client
                .batch_execute("DROP SCHEMA IF EXISTS plume_editability_test CASCADE")
                .await
                .expect("editability fixtures should be removed");
            validation.expect("table editability should use only reliable keys");
        });
    }

    #[test]
    #[ignore = "requires the local PostgreSQL integration environment"]
    fn loads_the_pgadmin_style_tree_from_postgres() {
        tauri::async_runtime::block_on(async {
            let client = test_support::connect().await;
            let current_database: String = client
                .query_one("SELECT current_database()", &[])
                .await
                .expect("current database should be available")
                .get(0);
            let current_user: String = client
                .query_one("SELECT current_user", &[])
                .await
                .expect("current user should be available")
                .get(0);

            let validation: Result<(), DatabaseError> = async {
                client
                    .batch_execute(
                        "DROP SCHEMA IF EXISTS plume_navigation_test CASCADE;
                         CREATE SCHEMA plume_navigation_test;
                         CREATE TABLE plume_navigation_test.items (
                           id bigint PRIMARY KEY,
                           display_name text NOT NULL
                         );
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
                assert!(
                    server
                        .databases
                        .iter()
                        .any(|database| database.name == current_database)
                );
                assert!(server.roles.iter().any(|role| role.name == current_user));

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
                let catalogs =
                    get_database_collection(&client, DatabaseCollectionKind::Catalogs).await?;
                let catalog_count = collections
                    .iter()
                    .find(|collection| matches!(collection.kind, DatabaseCollectionKind::Catalogs))
                    .expect("catalogs collection should be present")
                    .count;
                assert_eq!(catalog_count, catalogs.len() as i64);
                assert_eq!(
                    catalogs
                        .iter()
                        .map(|catalog| catalog.name.as_str())
                        .take(2)
                        .collect::<Vec<_>>(),
                    ["information_schema", "pg_catalog"]
                );
                assert!(!catalogs.iter().any(|catalog| catalog.name == "pg_toast"));

                let languages =
                    get_database_collection(&client, DatabaseCollectionKind::Languages).await?;
                let language_count = collections
                    .iter()
                    .find(|collection| {
                        matches!(collection.kind, DatabaseCollectionKind::Languages)
                    })
                    .expect("languages collection should be present")
                    .count;
                assert_eq!(language_count, languages.len() as i64);
                assert!(languages.iter().any(|language| language.name == "plpgsql"));
                assert!(languages.iter().all(|language| {
                    !matches!(language.name.as_str(), "c" | "internal" | "sql")
                }));

                let ansi_collections = get_catalog_collections(&client, "information_schema")
                    .await?;
                assert_eq!(ansi_collections.len(), 1);
                assert!(matches!(
                    ansi_collections[0].kind,
                    CatalogCollectionKind::CatalogObjects
                ));
                let ansi_objects = get_catalog_collection(
                    &client,
                    "information_schema",
                    CatalogCollectionKind::CatalogObjects,
                )
                .await?;
                assert_eq!(
                    ansi_collections[0].count,
                    Some(ansi_objects.len() as i64)
                );

                let postgres_collections = get_catalog_collections(&client, "pg_catalog").await?;
                assert_eq!(postgres_collections.len(), 17);
                assert!(matches!(
                    postgres_collections.first().map(|collection| collection.kind),
                    Some(CatalogCollectionKind::Aggregates)
                ));
                assert!(matches!(
                    postgres_collections.last().map(|collection| collection.kind),
                    Some(CatalogCollectionKind::Views)
                ));
                for collection in postgres_collections {
                    let items =
                        get_catalog_collection(&client, "pg_catalog", collection.kind).await?;
                    assert_eq!(collection.count, Some(items.len() as i64));
                }

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

                let completion_catalog = get_sql_completion_catalog(&client).await?;
                let completion_schema = completion_catalog
                    .schemas
                    .iter()
                    .find(|schema| schema.name == "plume_navigation_test")
                    .expect("completion schema should be present");
                let items = completion_schema
                    .relations
                    .iter()
                    .find(|relation| relation.name == "items")
                    .expect("completion relation should be present");
                assert_eq!(items.columns, ["id", "display_name"]);
                assert!(
                    completion_schema
                        .relations
                        .iter()
                        .any(|relation| relation.name == "item_view")
                );

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
