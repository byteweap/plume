use serde::{Deserialize, Serialize};
use tokio_postgres::{Client, Row};

use crate::{database::metadata::NamedObject, error::DatabaseError};

#[derive(Debug, Clone, Copy, Deserialize, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum CatalogCollectionKind {
    CatalogObjects,
    Aggregates,
    Collations,
    Domains,
    FtsConfigurations,
    FtsDictionaries,
    FtsParsers,
    FtsTemplates,
    ForeignTables,
    Functions,
    MaterializedViews,
    Operators,
    Procedures,
    Sequences,
    Tables,
    TriggerFunctions,
    Types,
    Views,
}

use CatalogCollectionKind as Kind;

const POSTGRES_CATALOG_COLLECTION_KINDS: [CatalogCollectionKind; 17] = [
    Kind::Aggregates,
    Kind::Collations,
    Kind::Domains,
    Kind::FtsConfigurations,
    Kind::FtsDictionaries,
    Kind::FtsParsers,
    Kind::FtsTemplates,
    Kind::ForeignTables,
    Kind::Functions,
    Kind::MaterializedViews,
    Kind::Operators,
    Kind::Procedures,
    Kind::Sequences,
    Kind::Tables,
    Kind::TriggerFunctions,
    Kind::Types,
    Kind::Views,
];

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogCollectionSummary {
    pub kind: CatalogCollectionKind,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub count: Option<i64>,
}

pub async fn get_catalog_collections(
    client: &Client,
    catalog: &str,
) -> Result<Vec<CatalogCollectionSummary>, DatabaseError> {
    if catalog == "information_schema" {
        let row = client
            .query_one(
                "SELECT count(*)
                   FROM pg_catalog.pg_class catalog_object
                   JOIN pg_catalog.pg_namespace catalog_namespace
                     ON catalog_namespace.oid = catalog_object.relnamespace
                  WHERE catalog_namespace.nspname = $1",
                &[&catalog],
            )
            .await?;

        return Ok(vec![CatalogCollectionSummary {
            kind: CatalogCollectionKind::CatalogObjects,
            count: Some(row.get(0)),
        }]);
    }

    if catalog != "pg_catalog" && catalog != "pgagent" {
        return Err(DatabaseError::UnexpectedMetadata(format!(
            "unsupported catalog: {catalog}"
        )));
    }

    let row = client
        .query_one(
            "SELECT
               (SELECT count(*)
                  FROM pg_catalog.pg_aggregate aggregate_definition
                  JOIN pg_catalog.pg_proc procedure_definition
                    ON procedure_definition.oid = aggregate_definition.aggfnoid
                  JOIN pg_catalog.pg_namespace catalog_namespace
                    ON catalog_namespace.oid = procedure_definition.pronamespace
                 WHERE catalog_namespace.nspname = $1),
               (SELECT count(*)
                  FROM pg_catalog.pg_collation collation_definition
                  JOIN pg_catalog.pg_namespace catalog_namespace
                    ON catalog_namespace.oid = collation_definition.collnamespace
                 WHERE catalog_namespace.nspname = $1),
               (SELECT count(*)
                  FROM pg_catalog.pg_type domain_definition
                  JOIN pg_catalog.pg_namespace catalog_namespace
                    ON catalog_namespace.oid = domain_definition.typnamespace
                 WHERE catalog_namespace.nspname = $1
                   AND domain_definition.typtype = 'd'),
               (SELECT count(*)
                  FROM pg_catalog.pg_ts_config configuration
                  JOIN pg_catalog.pg_namespace catalog_namespace
                    ON catalog_namespace.oid = configuration.cfgnamespace
                 WHERE catalog_namespace.nspname = $1),
               (SELECT count(*)
                  FROM pg_catalog.pg_ts_dict dictionary
                  JOIN pg_catalog.pg_namespace catalog_namespace
                    ON catalog_namespace.oid = dictionary.dictnamespace
                 WHERE catalog_namespace.nspname = $1),
               (SELECT count(*)
                  FROM pg_catalog.pg_ts_parser parser
                  JOIN pg_catalog.pg_namespace catalog_namespace
                    ON catalog_namespace.oid = parser.prsnamespace
                 WHERE catalog_namespace.nspname = $1),
               (SELECT count(*)
                  FROM pg_catalog.pg_ts_template template
                  JOIN pg_catalog.pg_namespace catalog_namespace
                    ON catalog_namespace.oid = template.tmplnamespace
                 WHERE catalog_namespace.nspname = $1),
               (SELECT count(*)
                  FROM pg_catalog.pg_class relation
                  JOIN pg_catalog.pg_namespace catalog_namespace
                    ON catalog_namespace.oid = relation.relnamespace
                 WHERE catalog_namespace.nspname = $1
                   AND relation.relkind = 'f'),
               (SELECT count(*)
                  FROM pg_catalog.pg_proc procedure_definition
                  JOIN pg_catalog.pg_namespace catalog_namespace
                    ON catalog_namespace.oid = procedure_definition.pronamespace
                  JOIN pg_catalog.pg_type return_type
                    ON return_type.oid = procedure_definition.prorettype
                 WHERE catalog_namespace.nspname = $1
                   AND procedure_definition.prokind IN ('f', 'w')
                   AND return_type.typname NOT IN ('trigger', 'event_trigger')),
               (SELECT count(*)
                  FROM pg_catalog.pg_class relation
                  JOIN pg_catalog.pg_namespace catalog_namespace
                    ON catalog_namespace.oid = relation.relnamespace
                 WHERE catalog_namespace.nspname = $1
                   AND relation.relkind = 'm'),
               (SELECT count(*)
                  FROM pg_catalog.pg_operator operator_definition
                  JOIN pg_catalog.pg_namespace catalog_namespace
                    ON catalog_namespace.oid = operator_definition.oprnamespace
                 WHERE catalog_namespace.nspname = $1),
               (SELECT count(*)
                  FROM pg_catalog.pg_proc procedure_definition
                  JOIN pg_catalog.pg_namespace catalog_namespace
                    ON catalog_namespace.oid = procedure_definition.pronamespace
                 WHERE catalog_namespace.nspname = $1
                   AND procedure_definition.prokind = 'p'),
               (SELECT count(*)
                  FROM pg_catalog.pg_class relation
                  JOIN pg_catalog.pg_namespace catalog_namespace
                    ON catalog_namespace.oid = relation.relnamespace
                 WHERE catalog_namespace.nspname = $1
                   AND relation.relkind = 'S'),
               (SELECT count(*)
                  FROM pg_catalog.pg_class relation
                  JOIN pg_catalog.pg_namespace catalog_namespace
                    ON catalog_namespace.oid = relation.relnamespace
                 WHERE catalog_namespace.nspname = $1
                   AND relation.relkind IN ('r', 's', 't', 'p')
                   AND NOT relation.relispartition),
               (SELECT count(*)
                  FROM pg_catalog.pg_proc procedure_definition
                  JOIN pg_catalog.pg_namespace catalog_namespace
                    ON catalog_namespace.oid = procedure_definition.pronamespace
                  JOIN pg_catalog.pg_type return_type
                    ON return_type.oid = procedure_definition.prorettype
                  JOIN pg_catalog.pg_language language_definition
                    ON language_definition.oid = procedure_definition.prolang
                 WHERE catalog_namespace.nspname = $1
                   AND procedure_definition.prokind IN ('f', 'w')
                   AND return_type.typname IN ('trigger', 'event_trigger')
                   AND language_definition.lanname NOT IN ('edbspl', 'sql', 'internal')),
               (SELECT count(*)
                  FROM pg_catalog.pg_type type_definition
                  JOIN pg_catalog.pg_namespace catalog_namespace
                    ON catalog_namespace.oid = type_definition.typnamespace
                 WHERE catalog_namespace.nspname = $1
                   AND type_definition.typtype <> 'd'
                   AND type_definition.typname NOT LIKE '\\_%' ESCAPE '\\'),
               (SELECT count(*)
                  FROM pg_catalog.pg_class relation
                  JOIN pg_catalog.pg_namespace catalog_namespace
                    ON catalog_namespace.oid = relation.relnamespace
                 WHERE catalog_namespace.nspname = $1
                   AND relation.relkind = 'v')",
            &[&catalog],
        )
        .await?;

    Ok(POSTGRES_CATALOG_COLLECTION_KINDS
        .into_iter()
        .enumerate()
        .map(|(index, kind)| CatalogCollectionSummary {
            kind,
            count: Some(row.get(index)),
        })
        .collect())
}

pub async fn get_catalog_collection(
    client: &Client,
    catalog: &str,
    kind: CatalogCollectionKind,
) -> Result<Vec<NamedObject>, DatabaseError> {
    let query = match kind {
        CatalogCollectionKind::CatalogObjects => {
            "SELECT catalog_object.relname
               FROM pg_catalog.pg_class catalog_object
               JOIN pg_catalog.pg_namespace catalog_namespace
                 ON catalog_namespace.oid = catalog_object.relnamespace
              WHERE catalog_namespace.nspname = $1
              ORDER BY catalog_object.relname"
        }
        CatalogCollectionKind::Aggregates => {
            "SELECT procedure_definition.proname || '(' ||
                    pg_catalog.pg_get_function_identity_arguments(procedure_definition.oid) || ')'
               FROM pg_catalog.pg_aggregate aggregate_definition
               JOIN pg_catalog.pg_proc procedure_definition
                 ON procedure_definition.oid = aggregate_definition.aggfnoid
               JOIN pg_catalog.pg_namespace catalog_namespace
                 ON catalog_namespace.oid = procedure_definition.pronamespace
              WHERE catalog_namespace.nspname = $1
              ORDER BY 1"
        }
        CatalogCollectionKind::Collations => {
            "SELECT collation_definition.collname
               FROM pg_catalog.pg_collation collation_definition
               JOIN pg_catalog.pg_namespace catalog_namespace
                 ON catalog_namespace.oid = collation_definition.collnamespace
              WHERE catalog_namespace.nspname = $1
              ORDER BY collation_definition.collname"
        }
        CatalogCollectionKind::Domains => {
            "SELECT domain_definition.typname
               FROM pg_catalog.pg_type domain_definition
               JOIN pg_catalog.pg_namespace catalog_namespace
                 ON catalog_namespace.oid = domain_definition.typnamespace
              WHERE catalog_namespace.nspname = $1
                AND domain_definition.typtype = 'd'
              ORDER BY domain_definition.typname"
        }
        CatalogCollectionKind::FtsConfigurations => {
            "SELECT configuration.cfgname
               FROM pg_catalog.pg_ts_config configuration
               JOIN pg_catalog.pg_namespace catalog_namespace
                 ON catalog_namespace.oid = configuration.cfgnamespace
              WHERE catalog_namespace.nspname = $1
              ORDER BY configuration.cfgname"
        }
        CatalogCollectionKind::FtsDictionaries => {
            "SELECT dictionary.dictname
               FROM pg_catalog.pg_ts_dict dictionary
               JOIN pg_catalog.pg_namespace catalog_namespace
                 ON catalog_namespace.oid = dictionary.dictnamespace
              WHERE catalog_namespace.nspname = $1
              ORDER BY dictionary.dictname"
        }
        CatalogCollectionKind::FtsParsers => {
            "SELECT parser.prsname
               FROM pg_catalog.pg_ts_parser parser
               JOIN pg_catalog.pg_namespace catalog_namespace
                 ON catalog_namespace.oid = parser.prsnamespace
              WHERE catalog_namespace.nspname = $1
              ORDER BY parser.prsname"
        }
        CatalogCollectionKind::FtsTemplates => {
            "SELECT template.tmplname
               FROM pg_catalog.pg_ts_template template
               JOIN pg_catalog.pg_namespace catalog_namespace
                 ON catalog_namespace.oid = template.tmplnamespace
              WHERE catalog_namespace.nspname = $1
              ORDER BY template.tmplname"
        }
        CatalogCollectionKind::ForeignTables => {
            "SELECT relation.relname
               FROM pg_catalog.pg_class relation
               JOIN pg_catalog.pg_namespace catalog_namespace
                 ON catalog_namespace.oid = relation.relnamespace
              WHERE catalog_namespace.nspname = $1
                AND relation.relkind = 'f'
              ORDER BY relation.relname"
        }
        CatalogCollectionKind::Functions => {
            "SELECT procedure_definition.proname || '(' ||
                    pg_catalog.pg_get_function_identity_arguments(procedure_definition.oid) || ')'
               FROM pg_catalog.pg_proc procedure_definition
               JOIN pg_catalog.pg_namespace catalog_namespace
                 ON catalog_namespace.oid = procedure_definition.pronamespace
               JOIN pg_catalog.pg_type return_type
                 ON return_type.oid = procedure_definition.prorettype
              WHERE catalog_namespace.nspname = $1
                AND procedure_definition.prokind IN ('f', 'w')
                AND return_type.typname NOT IN ('trigger', 'event_trigger')
              ORDER BY 1"
        }
        CatalogCollectionKind::MaterializedViews => {
            "SELECT relation.relname
               FROM pg_catalog.pg_class relation
               JOIN pg_catalog.pg_namespace catalog_namespace
                 ON catalog_namespace.oid = relation.relnamespace
              WHERE catalog_namespace.nspname = $1
                AND relation.relkind = 'm'
              ORDER BY relation.relname"
        }
        CatalogCollectionKind::Operators => {
            "SELECT CASE
                      WHEN left_type.oid IS NOT NULL AND right_type.oid IS NOT NULL THEN
                        operator_definition.oprname || ' (' ||
                        pg_catalog.format_type(left_type.oid, NULL) || ', ' ||
                        pg_catalog.format_type(right_type.oid, NULL) || ')'
                      WHEN left_type.oid IS NOT NULL THEN
                        operator_definition.oprname || ' (' ||
                        pg_catalog.format_type(left_type.oid, NULL) || ')'
                      WHEN right_type.oid IS NOT NULL THEN
                        operator_definition.oprname || ' (' ||
                        pg_catalog.format_type(right_type.oid, NULL) || ')'
                      ELSE operator_definition.oprname || '()'
                    END
               FROM pg_catalog.pg_operator operator_definition
               JOIN pg_catalog.pg_namespace catalog_namespace
                 ON catalog_namespace.oid = operator_definition.oprnamespace
               LEFT JOIN pg_catalog.pg_type left_type
                 ON left_type.oid = operator_definition.oprleft
               LEFT JOIN pg_catalog.pg_type right_type
                 ON right_type.oid = operator_definition.oprright
              WHERE catalog_namespace.nspname = $1
              ORDER BY operator_definition.oprname, operator_definition.oid"
        }
        CatalogCollectionKind::Procedures => {
            "SELECT procedure_definition.proname || '(' ||
                    pg_catalog.pg_get_function_identity_arguments(procedure_definition.oid) || ')'
               FROM pg_catalog.pg_proc procedure_definition
               JOIN pg_catalog.pg_namespace catalog_namespace
                 ON catalog_namespace.oid = procedure_definition.pronamespace
              WHERE catalog_namespace.nspname = $1
                AND procedure_definition.prokind = 'p'
              ORDER BY 1"
        }
        CatalogCollectionKind::Sequences => {
            "SELECT relation.relname
               FROM pg_catalog.pg_class relation
               JOIN pg_catalog.pg_namespace catalog_namespace
                 ON catalog_namespace.oid = relation.relnamespace
              WHERE catalog_namespace.nspname = $1
                AND relation.relkind = 'S'
              ORDER BY relation.relname"
        }
        CatalogCollectionKind::Tables => {
            "SELECT relation.relname
               FROM pg_catalog.pg_class relation
               JOIN pg_catalog.pg_namespace catalog_namespace
                 ON catalog_namespace.oid = relation.relnamespace
              WHERE catalog_namespace.nspname = $1
                AND relation.relkind IN ('r', 's', 't', 'p')
                AND NOT relation.relispartition
              ORDER BY relation.relname"
        }
        CatalogCollectionKind::TriggerFunctions => {
            "SELECT procedure_definition.proname || '(' ||
                    pg_catalog.pg_get_function_identity_arguments(procedure_definition.oid) || ')'
               FROM pg_catalog.pg_proc procedure_definition
               JOIN pg_catalog.pg_namespace catalog_namespace
                 ON catalog_namespace.oid = procedure_definition.pronamespace
               JOIN pg_catalog.pg_type return_type
                 ON return_type.oid = procedure_definition.prorettype
               JOIN pg_catalog.pg_language language_definition
                 ON language_definition.oid = procedure_definition.prolang
              WHERE catalog_namespace.nspname = $1
                AND procedure_definition.prokind IN ('f', 'w')
                AND return_type.typname IN ('trigger', 'event_trigger')
                AND language_definition.lanname NOT IN ('edbspl', 'sql', 'internal')
              ORDER BY 1"
        }
        CatalogCollectionKind::Types => {
            "SELECT type_definition.typname
               FROM pg_catalog.pg_type type_definition
               JOIN pg_catalog.pg_namespace catalog_namespace
                 ON catalog_namespace.oid = type_definition.typnamespace
              WHERE catalog_namespace.nspname = $1
                AND type_definition.typtype <> 'd'
                AND type_definition.typname NOT LIKE '\\_%' ESCAPE '\\'
              ORDER BY type_definition.typname"
        }
        CatalogCollectionKind::Views => {
            "SELECT relation.relname
               FROM pg_catalog.pg_class relation
               JOIN pg_catalog.pg_namespace catalog_namespace
                 ON catalog_namespace.oid = relation.relnamespace
              WHERE catalog_namespace.nspname = $1
                AND relation.relkind = 'v'
              ORDER BY relation.relname"
        }
    };

    let rows = client.query(query, &[&catalog]).await?;
    Ok(named_objects(rows))
}

fn named_objects(rows: Vec<Row>) -> Vec<NamedObject> {
    rows.into_iter()
        .map(|row| NamedObject { name: row.get(0) })
        .collect()
}
