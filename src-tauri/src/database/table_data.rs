use std::collections::{HashMap, HashSet};

use serde::{Deserialize, Serialize};
use thiserror::Error;
use tokio_postgres::{Client, Transaction, types::ToSql};
use uuid::Uuid;

use crate::{database::query::QueryDataType, error::DatabaseError};

const MAX_TABLE_DATA_CHANGES: usize = 10_000;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitTableDataRequest {
    pub request_id: String,
    pub session_id: String,
    pub database: String,
    pub schema: String,
    pub table: String,
    pub columns: Vec<TableDataColumn>,
    pub key_columns: Vec<String>,
    pub updated_rows: Vec<TableDataRowUpdate>,
    pub inserted_rows: Vec<TableDataRowInsert>,
    pub deleted_rows: Vec<TableDataRowDelete>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TableDataColumn {
    pub name: String,
    pub data_type: QueryDataType,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TableDataRowUpdate {
    pub locator: TableDataRowLocator,
    pub cells: Vec<TableDataCellUpdate>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TableDataCellUpdate {
    pub column_name: String,
    pub value: TableDataValue,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TableDataRowInsert {
    pub values: Vec<TableDataValue>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TableDataRowDelete {
    pub locator: TableDataRowLocator,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TableDataRowLocator {
    pub columns: Vec<TableDataLocatorValue>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TableDataLocatorValue {
    pub column_name: String,
    pub value: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum TableDataValue {
    Value { value: String },
    Null,
    Default,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitTableDataResult {
    pub request_id: String,
    pub inserted_rows: u64,
    pub updated_rows: u64,
    pub deleted_rows: u64,
}

#[derive(Debug, Error)]
pub enum TableDataCommitError {
    #[error("The table-data commit request is invalid: {0}")]
    Invalid(String),
    #[error("A {operation} target affected {affected_rows} rows instead of one.")]
    UnexpectedAffectedRows {
        operation: &'static str,
        affected_rows: u64,
    },
    #[error(transparent)]
    Database(#[from] DatabaseError),
    #[error(transparent)]
    Postgres(#[from] tokio_postgres::Error),
}

pub async fn commit(
    client: &mut Client,
    request: &CommitTableDataRequest,
) -> Result<CommitTableDataResult, TableDataCommitError> {
    request.validate()?;
    let transaction = client.transaction().await?;
    match execute_changes(&transaction, request).await {
        Ok(result) => {
            transaction.commit().await?;
            Ok(result)
        }
        Err(error) => {
            // A dropped PostgreSQL transaction also rolls back, but explicitly wait for
            // rollback whenever the connection is still usable.
            let _ = transaction.rollback().await;
            Err(error)
        }
    }
}

async fn execute_changes(
    transaction: &Transaction<'_>,
    request: &CommitTableDataRequest,
) -> Result<CommitTableDataResult, TableDataCommitError> {
    let columns = request
        .columns
        .iter()
        .map(|column| (column.name.as_str(), column))
        .collect::<HashMap<_, _>>();
    let table = format!(
        "{}.{}",
        quote_identifier(&request.schema),
        quote_identifier(&request.table)
    );

    let mut deleted_rows = 0;
    for deletion in &request.deleted_rows {
        let (where_clause, parameters) = build_locator(&deletion.locator, &columns)?;
        let sql = format!("DELETE FROM {table} WHERE {where_clause}");
        ensure_single_row(
            "delete",
            transaction
                .execute(&sql, &parameter_refs(&parameters))
                .await?,
        )?;
        deleted_rows += 1;
    }

    let mut updated_rows = 0;
    for update in &request.updated_rows {
        let mut parameters = Vec::new();
        let assignments = update
            .cells
            .iter()
            .map(|cell| {
                let column = columns.get(cell.column_name.as_str()).ok_or_else(|| {
                    TableDataCommitError::Invalid(format!(
                        "Unknown update column '{}'.",
                        cell.column_name
                    ))
                })?;
                let expression = value_expression(&cell.value, &column.data_type, &mut parameters)?;
                Ok(format!(
                    "{} = {expression}",
                    quote_identifier(&cell.column_name)
                ))
            })
            .collect::<Result<Vec<_>, TableDataCommitError>>()?;
        let (where_clause, locator_parameters) =
            build_locator_at(&update.locator, &columns, parameters.len())?;
        parameters.extend(locator_parameters);
        let sql = format!(
            "UPDATE {table} SET {} WHERE {where_clause}",
            assignments.join(", ")
        );
        ensure_single_row(
            "update",
            transaction
                .execute(&sql, &parameter_refs(&parameters))
                .await?,
        )?;
        updated_rows += 1;
    }

    let mut inserted_rows = 0;
    for insertion in &request.inserted_rows {
        let mut parameters = Vec::new();
        let expressions = insertion
            .values
            .iter()
            .zip(&request.columns)
            .map(|(value, column)| value_expression(value, &column.data_type, &mut parameters))
            .collect::<Result<Vec<_>, _>>()?;
        let sql = if request.columns.is_empty() {
            format!("INSERT INTO {table} DEFAULT VALUES")
        } else {
            format!(
                "INSERT INTO {table} ({}) VALUES ({})",
                request
                    .columns
                    .iter()
                    .map(|column| quote_identifier(&column.name))
                    .collect::<Vec<_>>()
                    .join(", "),
                expressions.join(", ")
            )
        };
        ensure_single_row(
            "insert",
            transaction
                .execute(&sql, &parameter_refs(&parameters))
                .await?,
        )?;
        inserted_rows += 1;
    }

    Ok(CommitTableDataResult {
        request_id: request.request_id.clone(),
        inserted_rows,
        updated_rows,
        deleted_rows,
    })
}

impl CommitTableDataRequest {
    fn validate(&self) -> Result<(), TableDataCommitError> {
        if Uuid::parse_str(&self.request_id).is_err() {
            return Err(TableDataCommitError::Invalid(
                "Request ID must be a valid UUID.".to_owned(),
            ));
        }
        for (label, value) in [
            ("Session ID", &self.session_id),
            ("Database", &self.database),
            ("Schema", &self.schema),
            ("Table", &self.table),
        ] {
            if value.trim().is_empty() {
                return Err(TableDataCommitError::Invalid(format!(
                    "{label} is required."
                )));
            }
        }
        let change_count =
            self.updated_rows.len() + self.inserted_rows.len() + self.deleted_rows.len();
        if change_count == 0 || change_count > MAX_TABLE_DATA_CHANGES {
            return Err(TableDataCommitError::Invalid(format!(
                "A commit must contain between 1 and {MAX_TABLE_DATA_CHANGES} changed rows."
            )));
        }
        if self.columns.len() > 1_600 {
            return Err(TableDataCommitError::Invalid(
                "A table cannot contain more than 1600 columns.".to_owned(),
            ));
        }
        let column_names = self
            .columns
            .iter()
            .map(|column| column.name.as_str())
            .collect::<HashSet<_>>();
        if column_names.len() != self.columns.len()
            || self.columns.iter().any(|column| column.name.is_empty())
        {
            return Err(TableDataCommitError::Invalid(
                "Table column names must be non-empty and unique.".to_owned(),
            ));
        }
        if self.key_columns.is_empty()
            || self
                .key_columns
                .iter()
                .any(|name| !column_names.contains(name.as_str()))
            || self.key_columns.iter().collect::<HashSet<_>>().len() != self.key_columns.len()
        {
            return Err(TableDataCommitError::Invalid(
                "Reliable key columns must be non-empty, unique table columns.".to_owned(),
            ));
        }
        for insertion in &self.inserted_rows {
            if insertion.values.len() != self.columns.len() {
                return Err(TableDataCommitError::Invalid(
                    "Every inserted row must provide one state per table column.".to_owned(),
                ));
            }
        }
        for update in &self.updated_rows {
            validate_locator(&update.locator, &self.key_columns)?;
            if update.cells.is_empty()
                || update
                    .cells
                    .iter()
                    .any(|cell| !column_names.contains(cell.column_name.as_str()))
                || update
                    .cells
                    .iter()
                    .map(|cell| cell.column_name.as_str())
                    .collect::<HashSet<_>>()
                    .len()
                    != update.cells.len()
            {
                return Err(TableDataCommitError::Invalid(
                    "Updated cells must be non-empty, unique table columns.".to_owned(),
                ));
            }
        }
        for deletion in &self.deleted_rows {
            validate_locator(&deletion.locator, &self.key_columns)?;
        }
        Ok(())
    }
}

fn validate_locator(
    locator: &TableDataRowLocator,
    key_columns: &[String],
) -> Result<(), TableDataCommitError> {
    if locator.columns.len() != key_columns.len()
        || locator
            .columns
            .iter()
            .zip(key_columns)
            .any(|(value, expected)| value.column_name != *expected)
    {
        return Err(TableDataCommitError::Invalid(
            "Every row locator must match the reliable key columns in order.".to_owned(),
        ));
    }
    Ok(())
}

fn build_locator(
    locator: &TableDataRowLocator,
    columns: &HashMap<&str, &TableDataColumn>,
) -> Result<(String, Vec<Option<String>>), TableDataCommitError> {
    build_locator_at(locator, columns, 0)
}

fn build_locator_at(
    locator: &TableDataRowLocator,
    columns: &HashMap<&str, &TableDataColumn>,
    parameter_offset: usize,
) -> Result<(String, Vec<Option<String>>), TableDataCommitError> {
    let mut parameters = Vec::new();
    let predicates = locator
        .columns
        .iter()
        .map(|value| {
            let column = columns.get(value.column_name.as_str()).ok_or_else(|| {
                TableDataCommitError::Invalid(format!(
                    "Unknown locator column '{}'.",
                    value.column_name
                ))
            })?;
            parameters.push(Some(value.value.clone()));
            Ok(format!(
                "{} = ${}::text::{}",
                quote_identifier(&value.column_name),
                parameter_offset + parameters.len(),
                format_data_type(&column.data_type)?
            ))
        })
        .collect::<Result<Vec<_>, TableDataCommitError>>()?;
    Ok((predicates.join(" AND "), parameters))
}

fn value_expression(
    value: &TableDataValue,
    data_type: &QueryDataType,
    parameters: &mut Vec<Option<String>>,
) -> Result<String, TableDataCommitError> {
    match value {
        TableDataValue::Default => Ok("DEFAULT".to_owned()),
        TableDataValue::Null => Ok("NULL".to_owned()),
        TableDataValue::Value { value } => {
            parameters.push(Some(value.clone()));
            Ok(format!(
                "${}::text::{}",
                parameters.len(),
                format_data_type(data_type)?
            ))
        }
    }
}

fn format_data_type(data_type: &QueryDataType) -> Result<String, TableDataCommitError> {
    let name = data_type.name.as_deref().ok_or_else(|| {
        TableDataCommitError::Invalid(
            "Every writable column requires a named data type.".to_owned(),
        )
    })?;
    Ok(match data_type.schema.as_deref() {
        Some(schema) => format!("{}.{}", quote_identifier(schema), quote_identifier(name)),
        None => quote_identifier(name),
    })
}

fn parameter_refs(parameters: &[Option<String>]) -> Vec<&(dyn ToSql + Sync)> {
    parameters
        .iter()
        .map(|value| value as &(dyn ToSql + Sync))
        .collect()
}

fn ensure_single_row(
    operation: &'static str,
    affected_rows: u64,
) -> Result<(), TableDataCommitError> {
    if affected_rows == 1 {
        Ok(())
    } else {
        Err(TableDataCommitError::UnexpectedAffectedRows {
            operation,
            affected_rows,
        })
    }
}

fn quote_identifier(identifier: &str) -> String {
    format!("\"{}\"", identifier.replace('"', "\"\""))
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::{CommitTableDataRequest, TableDataCommitError, commit};
    use crate::database::test_support;

    #[test]
    fn validates_structured_changes_and_reliable_locator_order() {
        let mut request: CommitTableDataRequest = serde_json::from_value(json!({
            "requestId": "1138bb0e-cf61-4dbd-a723-6aa3ddd173ab",
            "sessionId": "session-1",
            "database": "plume",
            "schema": "public",
            "table": "items",
            "columns": [{
                "name": "id",
                "dataType": { "oid": 23, "name": "int4", "schema": "pg_catalog", "kind": "simple" }
            }],
            "keyColumns": ["id"],
            "updatedRows": [{
                "locator": { "columns": [{ "columnName": "id", "value": "1" }] },
                "cells": [{ "columnName": "id", "value": { "kind": "value", "value": "2" } }]
            }],
            "insertedRows": [],
            "deletedRows": []
        }))
        .unwrap();
        request.validate().expect("valid request");

        request.updated_rows[0].locator.columns[0].column_name = "other".to_owned();
        assert!(matches!(
            request.validate(),
            Err(TableDataCommitError::Invalid(message))
                if message.contains("reliable key columns")
        ));
    }

    #[test]
    #[ignore = "requires the local PostgreSQL integration environment"]
    fn rolls_back_every_change_when_one_row_fails() {
        tauri::async_runtime::block_on(async {
            let mut client = test_support::connect().await;
            client
                .batch_execute(
                    "DROP TABLE IF EXISTS public.plume_table_data_commit_test;
                     CREATE TABLE public.plume_table_data_commit_test (
                       id integer PRIMARY KEY,
                       note text NOT NULL DEFAULT 'fallback'
                     );",
                )
                .await
                .unwrap();
            let request: CommitTableDataRequest = serde_json::from_value(json!({
                "requestId": "1138bb0e-cf61-4dbd-a723-6aa3ddd173ab",
                "sessionId": "session-1",
                "database": "plume_test",
                "schema": "public",
                "table": "plume_table_data_commit_test",
                "columns": [
                    {
                        "name": "id",
                        "dataType": { "oid": 23, "name": "int4", "schema": "pg_catalog", "kind": "simple" }
                    },
                    {
                        "name": "note",
                        "dataType": { "oid": 25, "name": "text", "schema": "pg_catalog", "kind": "simple" }
                    }
                ],
                "keyColumns": ["id"],
                "updatedRows": [],
                "insertedRows": [
                    { "values": [
                        { "kind": "value", "value": "1" },
                        { "kind": "value", "value": "first" }
                    ] },
                    { "values": [
                        { "kind": "value", "value": "1" },
                        { "kind": "value", "value": "duplicate" }
                    ] }
                ],
                "deletedRows": []
            }))
            .unwrap();

            assert!(matches!(
                commit(&mut client, &request).await,
                Err(TableDataCommitError::Postgres(_))
            ));
            let row_count: i64 = client
                .query_one(
                    "SELECT count(*) FROM public.plume_table_data_commit_test",
                    &[],
                )
                .await
                .unwrap()
                .get(0);
            assert_eq!(row_count, 0, "the first insert must have been rolled back");

            client
                .batch_execute(
                    "INSERT INTO public.plume_table_data_commit_test (id, note)
                     VALUES (1, 'delete me'), (2, 'update me')",
                )
                .await
                .unwrap();
            let successful_request: CommitTableDataRequest =
                serde_json::from_value(json!({
                    "requestId": "94773038-b4d2-4f3e-929a-bc153fcf2b81",
                    "sessionId": "session-1",
                    "database": "plume_test",
                    "schema": "public",
                    "table": "plume_table_data_commit_test",
                    "columns": [
                        {
                            "name": "id",
                            "dataType": { "oid": 23, "name": "int4", "schema": "pg_catalog", "kind": "simple" }
                        },
                        {
                            "name": "note",
                            "dataType": { "oid": 25, "name": "text", "schema": "pg_catalog", "kind": "simple" }
                        }
                    ],
                    "keyColumns": ["id"],
                    "updatedRows": [{
                        "locator": { "columns": [{ "columnName": "id", "value": "2" }] },
                        "cells": [{ "columnName": "note", "value": { "kind": "default" } }]
                    }],
                    "insertedRows": [{ "values": [
                        { "kind": "value", "value": "3" },
                        { "kind": "value", "value": "" }
                    ] }],
                    "deletedRows": [{
                        "locator": { "columns": [{ "columnName": "id", "value": "1" }] }
                    }]
                }))
                .unwrap();
            let result = commit(&mut client, &successful_request).await.unwrap();
            assert_eq!(result.inserted_rows, 1);
            assert_eq!(result.updated_rows, 1);
            assert_eq!(result.deleted_rows, 1);
            let rows = client
                .query(
                    "SELECT id, note FROM public.plume_table_data_commit_test ORDER BY id",
                    &[],
                )
                .await
                .unwrap();
            assert_eq!(rows.len(), 2);
            assert_eq!(rows[0].get::<_, i32>(0), 2);
            assert_eq!(rows[0].get::<_, String>(1), "fallback");
            assert_eq!(rows[1].get::<_, i32>(0), 3);
            assert_eq!(rows[1].get::<_, String>(1), "");
            client
                .batch_execute("DROP TABLE public.plume_table_data_commit_test")
                .await
                .unwrap();
        });
    }
}
