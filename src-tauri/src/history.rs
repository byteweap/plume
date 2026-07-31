use std::{path::PathBuf, sync::Mutex, time::Duration};

use rusqlite::{Connection, params};
use serde::{Deserialize, Serialize};
use thiserror::Error;
use uuid::Uuid;

const MAX_SQL_BYTES: usize = 5 * 1024 * 1024;

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
    ) -> Result<QueryHistory, HistoryError> {
        validate_request(request)?;
        let duration_ms = i64::try_from(request.duration_ms).map_err(|_| {
            HistoryError::Invalid("Duration must fit in a signed 64-bit integer.".to_owned())
        })?;
        let executed_at = unix_timestamp();
        self.connection.execute(
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
}

pub struct QueryHistoryService {
    repository: Mutex<HistoryRepository>,
}

impl QueryHistoryService {
    pub fn open(path: PathBuf) -> Result<Self, HistoryError> {
        Ok(Self {
            repository: Mutex::new(HistoryRepository::open(path)?),
        })
    }

    pub fn record(&self, request: RecordQueryHistoryRequest) -> Result<QueryHistory, HistoryError> {
        self.repository()?.record(&request)
    }

    fn repository(&self) -> Result<std::sync::MutexGuard<'_, HistoryRepository>, HistoryError> {
        self.repository.lock().map_err(|_| HistoryError::Lock)
    }
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

    use uuid::Uuid;

    use super::{QueryHistoryService, RecordQueryHistoryRequest};
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
