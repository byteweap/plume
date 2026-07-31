use std::{path::PathBuf, sync::Mutex, time::Duration};

use rusqlite::{Connection, params};
use serde::{Deserialize, Serialize};
use thiserror::Error;
use uuid::Uuid;

const MAX_SQL_BYTES: usize = 5 * 1024 * 1024;
const SECONDS_PER_DAY: u64 = 24 * 60 * 60;
pub const DEFAULT_HISTORY_RETENTION_DAYS: u32 = 90;
pub const DEFAULT_HISTORY_MAX_ENTRIES: u32 = 10_000;

#[derive(Debug, Error)]
pub enum HistoryError {
    #[error("Local query history storage failed: {0}")]
    Storage(#[from] rusqlite::Error),
    #[error("The query history record is invalid: {0}")]
    Invalid(String),
    #[error("Local query history storage is unavailable.")]
    Lock,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordQueryHistoryRequest {
    pub id: String,
    pub profile_id: String,
    pub database: String,
    pub schema: Option<String>,
    pub sql: String,
    pub duration_ms: u64,
    pub result_status: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QueryHistory {
    pub id: String,
    pub profile_id: Option<String>,
    pub database: String,
    pub schema: Option<String>,
    pub sql: String,
    pub duration_ms: u64,
    pub result_status: String,
    pub executed_at: i64,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListQueryHistoryRequest {
    pub search: Option<String>,
    pub limit: Option<u32>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct HistoryRetentionPolicy {
    max_age: Duration,
    max_entries: u32,
}

impl HistoryRetentionPolicy {
    pub fn new(retention_days: u32, max_entries: u32) -> Result<Self, HistoryError> {
        if retention_days == 0 || max_entries == 0 {
            return Err(HistoryError::Invalid(
                "History retention days and maximum entries must be greater than zero.".to_owned(),
            ));
        }
        Ok(Self {
            max_age: Duration::from_secs(u64::from(retention_days) * SECONDS_PER_DAY),
            max_entries,
        })
    }
}

impl Default for HistoryRetentionPolicy {
    fn default() -> Self {
        Self::new(DEFAULT_HISTORY_RETENTION_DAYS, DEFAULT_HISTORY_MAX_ENTRIES)
            .expect("default history retention policy must be valid")
    }
}

struct HistoryRepository {
    connection: Connection,
}

impl HistoryRepository {
    fn open(path: PathBuf) -> Result<Self, HistoryError> {
        let connection = Connection::open(path)?;
        connection.busy_timeout(Duration::from_secs(5))?;
        connection.pragma_update(None, "foreign_keys", "ON")?;
        Ok(Self { connection })
    }

    fn record(
        &mut self,
        request: &RecordQueryHistoryRequest,
        retention: HistoryRetentionPolicy,
    ) -> Result<QueryHistory, HistoryError> {
        validate_request(request)?;
        let duration_ms = i64::try_from(request.duration_ms).map_err(|_| {
            HistoryError::Invalid("Duration must fit in a signed 64-bit integer.".to_owned())
        })?;
        let executed_at = unix_timestamp();
        let transaction = self.connection.transaction()?;
        transaction.execute(
            "INSERT INTO query_history (
                id, profile_id, database_name, schema_name, sql, duration_ms,
                result_status, executed_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                request.id,
                request.profile_id,
                request.database.trim(),
                clean_optional(&request.schema),
                request.sql,
                duration_ms,
                request.result_status,
                executed_at,
            ],
        )?;
        cleanup_history(&transaction, retention, executed_at)?;
        transaction.commit()?;

        Ok(QueryHistory {
            id: request.id.clone(),
            profile_id: Some(request.profile_id.clone()),
            database: request.database.trim().to_owned(),
            schema: clean_optional(&request.schema).map(str::to_owned),
            sql: request.sql.clone(),
            duration_ms: request.duration_ms,
            result_status: request.result_status.clone(),
            executed_at,
        })
    }

    fn list(&self, request: &ListQueryHistoryRequest) -> Result<Vec<QueryHistory>, HistoryError> {
        let search = request.search.as_deref().unwrap_or("").trim();
        let pattern = format!("%{}%", escape_like(search));
        let limit = i64::from(request.limit.unwrap_or(100).clamp(1, 1_000));
        let mut statement = self.connection.prepare(
            "SELECT id, profile_id, database_name, schema_name, sql, duration_ms,
                    result_status, executed_at
             FROM query_history
             WHERE ?1 = ''
                OR sql LIKE ?2 ESCAPE '\\'
                OR database_name LIKE ?2 ESCAPE '\\'
                OR COALESCE(schema_name, '') LIKE ?2 ESCAPE '\\'
                OR COALESCE(profile_id, '') LIKE ?2 ESCAPE '\\'
             ORDER BY executed_at DESC, id DESC
             LIMIT ?3",
        )?;
        let rows = statement
            .query_map((&search, &pattern, limit), |row| {
                let duration_ms = row.get::<_, i64>(5)?.max(0) as u64;
                Ok(QueryHistory {
                    id: row.get(0)?,
                    profile_id: row.get(1)?,
                    database: row.get(2)?,
                    schema: row.get(3)?,
                    sql: row.get(4)?,
                    duration_ms,
                    result_status: row.get(6)?,
                    executed_at: row.get(7)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    fn clear(&mut self) -> Result<(), HistoryError> {
        self.connection.execute("DELETE FROM query_history", [])?;
        Ok(())
    }
}

pub struct QueryHistoryService {
    repository: Mutex<HistoryRepository>,
    retention: HistoryRetentionPolicy,
}

impl QueryHistoryService {
    pub fn open(path: PathBuf) -> Result<Self, HistoryError> {
        Self::open_with_retention(path, HistoryRetentionPolicy::default())
    }

    pub fn open_with_retention(
        path: PathBuf,
        retention: HistoryRetentionPolicy,
    ) -> Result<Self, HistoryError> {
        Ok(Self {
            repository: Mutex::new(HistoryRepository::open(path)?),
            retention,
        })
    }

    pub fn record(&self, request: RecordQueryHistoryRequest) -> Result<QueryHistory, HistoryError> {
        self.repository()?.record(&request, self.retention)
    }

    pub fn list(
        &self,
        request: ListQueryHistoryRequest,
    ) -> Result<Vec<QueryHistory>, HistoryError> {
        self.repository()?.list(&request)
    }

    pub fn clear(&self) -> Result<(), HistoryError> {
        self.repository()?.clear()
    }

    fn repository(&self) -> Result<std::sync::MutexGuard<'_, HistoryRepository>, HistoryError> {
        self.repository.lock().map_err(|_| HistoryError::Lock)
    }
}

fn cleanup_history(
    connection: &Connection,
    retention: HistoryRetentionPolicy,
    now: i64,
) -> Result<(), HistoryError> {
    let max_age_seconds = i64::try_from(retention.max_age.as_secs()).unwrap_or(i64::MAX);
    let cutoff = now.saturating_sub(max_age_seconds);
    connection.execute(
        "DELETE FROM query_history
         WHERE executed_at < ?1
            OR id IN (
                SELECT id
                FROM query_history
                ORDER BY executed_at DESC, rowid DESC
                LIMIT -1 OFFSET ?2
            )",
        params![cutoff, i64::from(retention.max_entries)],
    )?;
    Ok(())
}

fn validate_request(request: &RecordQueryHistoryRequest) -> Result<(), HistoryError> {
    if Uuid::parse_str(&request.id).is_err() {
        return Err(HistoryError::Invalid(
            "History ID must be a valid UUID.".to_owned(),
        ));
    }
    if request.profile_id.trim().is_empty()
        || request.database.trim().is_empty()
        || request.sql.trim().is_empty()
    {
        return Err(HistoryError::Invalid(
            "Profile, database, and SQL are required.".to_owned(),
        ));
    }
    if request.sql.len() > MAX_SQL_BYTES {
        return Err(HistoryError::Invalid(format!(
            "SQL content must not exceed {MAX_SQL_BYTES} bytes."
        )));
    }
    if !matches!(
        request.result_status.as_str(),
        "succeeded" | "failed" | "cancelled"
    ) {
        return Err(HistoryError::Invalid(
            "Result status must be succeeded, failed, or cancelled.".to_owned(),
        ));
    }
    Ok(())
}

fn clean_optional(value: &Option<String>) -> Option<&str> {
    value
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
}

fn escape_like(value: &str) -> String {
    value
        .replace('\\', "\\\\")
        .replace('%', "\\%")
        .replace('_', "\\_")
}

fn unix_timestamp() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
}

#[cfg(test)]
mod tests {
    use std::{
        fs,
        path::{Path, PathBuf},
    };

    use rusqlite::params;
    use uuid::Uuid;

    use super::{
        HistoryRetentionPolicy, ListQueryHistoryRequest, QueryHistoryService,
        RecordQueryHistoryRequest, SECONDS_PER_DAY, unix_timestamp,
    };
    use crate::{
        credentials::MemoryCredentialStore,
        database::connection::SslMode,
        profiles::{ConnectionProfileService, ProfileWriteRequest},
    };

    #[test]
    fn records_query_outcomes_without_storing_credentials() {
        let path = temporary_path("history.sqlite3");
        let profiles = ConnectionProfileService::open(
            path.clone(),
            Box::new(MemoryCredentialStore::default()),
        )
        .unwrap();
        let profile = profiles.create(profile_request()).unwrap();
        let history = QueryHistoryService::open(path.clone()).unwrap();
        let record = history
            .record(RecordQueryHistoryRequest {
                id: Uuid::new_v4().to_string(),
                profile_id: profile.id,
                database: "postgres".to_owned(),
                schema: Some("public".to_owned()),
                sql: "select 1;".to_owned(),
                duration_ms: 42,
                result_status: "succeeded".to_owned(),
            })
            .unwrap();

        assert_eq!(record.database, "postgres");
        assert_eq!(record.duration_ms, 42);
        assert_eq!(record.result_status, "succeeded");
        assert_eq!(
            history
                .list(ListQueryHistoryRequest::default())
                .unwrap()
                .len(),
            1
        );
        assert_eq!(
            history
                .list(ListQueryHistoryRequest {
                    search: Some("select".to_owned()),
                    limit: Some(10),
                })
                .unwrap()
                .len(),
            1
        );
        history.clear().unwrap();
        assert!(
            history
                .list(ListQueryHistoryRequest::default())
                .unwrap()
                .is_empty()
        );
        drop(history);
        drop(profiles);
        remove_test_files(&path);
    }

    #[test]
    fn rejects_unknown_result_states() {
        let path = temporary_path("history-invalid.sqlite3");
        let profiles = ConnectionProfileService::open(
            path.clone(),
            Box::new(MemoryCredentialStore::default()),
        )
        .unwrap();
        let history = QueryHistoryService::open(path.clone()).unwrap();
        let error = history
            .record(RecordQueryHistoryRequest {
                id: Uuid::new_v4().to_string(),
                profile_id: "profile-1".to_owned(),
                database: "postgres".to_owned(),
                schema: None,
                sql: "select 1;".to_owned(),
                duration_ms: 0,
                result_status: "running".to_owned(),
            })
            .unwrap_err();
        assert!(error.to_string().contains("Result status"));
        drop(history);
        drop(profiles);
        remove_test_files(&path);
    }

    #[test]
    fn removes_history_beyond_the_configured_entry_limit() {
        let path = temporary_path("history-count-retention.sqlite3");
        let profiles = ConnectionProfileService::open(
            path.clone(),
            Box::new(MemoryCredentialStore::default()),
        )
        .unwrap();
        let profile = profiles.create(profile_request()).unwrap();
        let history = QueryHistoryService::open_with_retention(
            path.clone(),
            HistoryRetentionPolicy::new(90, 2).unwrap(),
        )
        .unwrap();

        for sql in ["select 1;", "select 2;", "select 3;"] {
            history.record(history_request(&profile.id, sql)).unwrap();
        }

        let records = history
            .list(ListQueryHistoryRequest {
                search: None,
                limit: Some(10),
            })
            .unwrap();
        assert_eq!(records.len(), 2);
        assert!(records.iter().all(|record| record.sql != "select 1;"));
        drop(history);
        drop(profiles);
        remove_test_files(&path);
    }

    #[test]
    fn removes_history_older_than_the_configured_age() {
        let path = temporary_path("history-age-retention.sqlite3");
        let profiles = ConnectionProfileService::open(
            path.clone(),
            Box::new(MemoryCredentialStore::default()),
        )
        .unwrap();
        let profile = profiles.create(profile_request()).unwrap();
        let history = QueryHistoryService::open_with_retention(
            path.clone(),
            HistoryRetentionPolicy::new(1, 10).unwrap(),
        )
        .unwrap();
        let old_record = history
            .record(history_request(&profile.id, "select 'old';"))
            .unwrap();
        history
            .repository()
            .unwrap()
            .connection
            .execute(
                "UPDATE query_history SET executed_at = ?1 WHERE id = ?2",
                params![
                    unix_timestamp() - (2 * SECONDS_PER_DAY as i64),
                    old_record.id
                ],
            )
            .unwrap();

        history
            .record(history_request(&profile.id, "select 'current';"))
            .unwrap();

        let records = history.list(ListQueryHistoryRequest::default()).unwrap();
        assert_eq!(records.len(), 1);
        assert_eq!(records[0].sql, "select 'current';");
        drop(history);
        drop(profiles);
        remove_test_files(&path);
    }

    #[test]
    fn rejects_zero_retention_limits() {
        assert!(HistoryRetentionPolicy::new(0, 10).is_err());
        assert!(HistoryRetentionPolicy::new(90, 0).is_err());
    }

    fn history_request(profile_id: &str, sql: &str) -> RecordQueryHistoryRequest {
        RecordQueryHistoryRequest {
            id: Uuid::new_v4().to_string(),
            profile_id: profile_id.to_owned(),
            database: "postgres".to_owned(),
            schema: Some("public".to_owned()),
            sql: sql.to_owned(),
            duration_ms: 1,
            result_status: "succeeded".to_owned(),
        }
    }

    fn profile_request() -> ProfileWriteRequest {
        ProfileWriteRequest {
            id: None,
            name: "Local".to_owned(),
            host: "localhost".to_owned(),
            port: 5432,
            database: "postgres".to_owned(),
            username: "postgres".to_owned(),
            password: Some("history-password".to_owned()),
            environment: "development".to_owned(),
            sql_risk_policy: "all".to_owned(),
            color: "#2f6d52".to_owned(),
            ssl_mode: SslMode::Disable,
            root_certificate_path: None,
            client_certificate_path: None,
            client_key_path: None,
            ssh_config: None,
            ssh_password: None,
            ssh_private_key_passphrase: None,
            ssh_jump_password: None,
            ssh_jump_private_key_passphrase: None,
            favorite: false,
        }
    }

    fn temporary_path(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!("plume-{}-{name}", Uuid::new_v4()))
    }

    fn remove_test_files(path: &Path) {
        let Some(parent) = path.parent() else { return };
        let prefix = path.file_name().unwrap().to_string_lossy().to_string();
        for entry in fs::read_dir(parent).unwrap().filter_map(Result::ok) {
            if entry.file_name().to_string_lossy().starts_with(&prefix) {
                let _ = fs::remove_file(entry.path());
            }
        }
    }
}
