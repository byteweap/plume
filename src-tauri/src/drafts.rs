use std::{path::PathBuf, sync::Mutex, time::Duration};

use rusqlite::{Connection, params};
use serde::{Deserialize, Serialize};
use thiserror::Error;

const MAX_SQL_BYTES: usize = 5 * 1024 * 1024;

#[derive(Debug, Error)]
pub enum DraftError {
    #[error("Local draft storage failed: {0}")]
    Storage(#[from] rusqlite::Error),
    #[error("The query draft is invalid: {0}")]
    Invalid(String),
    #[error("The connection profile '{0}' for this draft does not exist.")]
    ProfileNotFound(String),
    #[error("Local draft storage is unavailable.")]
    Lock,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QueryDraft {
    pub id: String,
    pub profile_id: String,
    pub database: String,
    pub schema: Option<String>,
    pub title: String,
    pub sql: String,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveQueryDraftRequest {
    pub id: String,
    pub profile_id: String,
    pub database: String,
    pub schema: Option<String>,
    pub title: String,
    pub sql: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QueryDraftIdRequest {
    pub id: String,
}

struct DraftRepository {
    connection: Connection,
}

impl DraftRepository {
    fn open(path: PathBuf) -> Result<Self, DraftError> {
        let connection = Connection::open(path)?;
        connection.busy_timeout(Duration::from_secs(5))?;
        connection.pragma_update(None, "foreign_keys", "ON")?;
        Ok(Self { connection })
    }

    fn list(&self) -> Result<Vec<QueryDraft>, DraftError> {
        let mut statement = self.connection.prepare(
            "SELECT id, profile_id, database_name, schema_name, title, sql, created_at, updated_at
             FROM query_drafts
             ORDER BY created_at, id",
        )?;
        Ok(statement
            .query_map([], Self::read)?
            .collect::<Result<Vec<_>, _>>()?)
    }

    fn save(&mut self, request: &SaveQueryDraftRequest) -> Result<QueryDraft, DraftError> {
        validate_request(request)?;
        let profile_exists = self.connection.query_row(
            "SELECT EXISTS(SELECT 1 FROM connection_profiles WHERE id = ?1)",
            [&request.profile_id],
            |row| row.get::<_, bool>(0),
        )?;
        if !profile_exists {
            return Err(DraftError::ProfileNotFound(request.profile_id.clone()));
        }

        let now = unix_timestamp();
        let transaction = self.connection.transaction()?;
        transaction.execute(
            "INSERT INTO query_drafts (
                id, profile_id, database_name, schema_name, title, sql, created_at, updated_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)
             ON CONFLICT(id) DO UPDATE SET
                profile_id = excluded.profile_id,
                database_name = excluded.database_name,
                schema_name = excluded.schema_name,
                title = excluded.title,
                sql = excluded.sql,
                updated_at = excluded.updated_at",
            params![
                request.id,
                request.profile_id,
                request.database.trim(),
                clean_optional(&request.schema),
                request.title.trim(),
                request.sql,
                now,
            ],
        )?;
        transaction.commit()?;
        self.get(&request.id)
    }

    fn get(&self, id: &str) -> Result<QueryDraft, DraftError> {
        self.connection
            .query_row(
                "SELECT id, profile_id, database_name, schema_name, title, sql, created_at, updated_at
                 FROM query_drafts WHERE id = ?1",
                [id],
                Self::read,
            )
            .map_err(DraftError::from)
    }

    fn delete(&mut self, id: &str) -> Result<(), DraftError> {
        self.connection
            .execute("DELETE FROM query_drafts WHERE id = ?1", [id])?;
        Ok(())
    }

    fn read(row: &rusqlite::Row<'_>) -> rusqlite::Result<QueryDraft> {
        Ok(QueryDraft {
            id: row.get(0)?,
            profile_id: row.get(1)?,
            database: row.get(2)?,
            schema: row.get(3)?,
            title: row.get(4)?,
            sql: row.get(5)?,
            created_at: row.get(6)?,
            updated_at: row.get(7)?,
        })
    }
}

pub struct QueryDraftService {
    repository: Mutex<DraftRepository>,
}

impl QueryDraftService {
    pub fn open(path: PathBuf) -> Result<Self, DraftError> {
        Ok(Self {
            repository: Mutex::new(DraftRepository::open(path)?),
        })
    }

    pub fn list(&self) -> Result<Vec<QueryDraft>, DraftError> {
        self.repository()?.list()
    }

    pub fn save(&self, request: SaveQueryDraftRequest) -> Result<QueryDraft, DraftError> {
        self.repository()?.save(&request)
    }

    pub fn delete(&self, id: &str) -> Result<(), DraftError> {
        self.repository()?.delete(id)
    }

    fn repository(&self) -> Result<std::sync::MutexGuard<'_, DraftRepository>, DraftError> {
        self.repository.lock().map_err(|_| DraftError::Lock)
    }
}

fn validate_request(request: &SaveQueryDraftRequest) -> Result<(), DraftError> {
    if request.id.trim().is_empty()
        || request.profile_id.trim().is_empty()
        || request.database.trim().is_empty()
        || request.title.trim().is_empty()
    {
        return Err(DraftError::Invalid(
            "ID, connection profile, database, and title are required.".to_owned(),
        ));
    }
    if request.sql.len() > MAX_SQL_BYTES {
        return Err(DraftError::Invalid(format!(
            "SQL content must not exceed {MAX_SQL_BYTES} bytes."
        )));
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

    use super::{QueryDraftService, SaveQueryDraftRequest};
    use crate::database::connection::SslMode;
    use crate::{
        credentials::MemoryCredentialStore,
        profiles::{ConnectionProfileService, ProfileWriteRequest},
    };

    #[test]
    fn saves_updates_lists_and_deletes_drafts() {
        let path = temporary_path("draft-lifecycle.sqlite3");
        let profiles = ConnectionProfileService::open(
            path.clone(),
            Box::new(MemoryCredentialStore::default()),
        )
        .unwrap();
        let profile = profiles.create(profile_request()).unwrap();
        let drafts = QueryDraftService::open(path.clone()).unwrap();
        let mut request = draft_request(&profile.id);

        let created = drafts.save(request.clone()).unwrap();
        assert_eq!(created.sql, "select 1;");
        request.title = "Audit users".to_owned();
        request.sql = "select * from users;".to_owned();
        let updated = drafts.save(request).unwrap();
        assert_eq!(updated.created_at, created.created_at);
        assert_eq!(updated.title, "Audit users");
        assert_eq!(drafts.list().unwrap(), vec![updated]);

        drafts.delete("workspace-1").unwrap();
        assert!(drafts.list().unwrap().is_empty());
        drop(drafts);
        drop(profiles);
        remove_test_files(&path);
    }

    #[test]
    fn deleting_a_profile_cascades_its_drafts() {
        let path = temporary_path("draft-cascade.sqlite3");
        let profiles = ConnectionProfileService::open(
            path.clone(),
            Box::new(MemoryCredentialStore::default()),
        )
        .unwrap();
        let profile = profiles.create(profile_request()).unwrap();
        let drafts = QueryDraftService::open(path.clone()).unwrap();
        drafts.save(draft_request(&profile.id)).unwrap();

        profiles.delete(&profile.id).unwrap();
        assert!(drafts.list().unwrap().is_empty());
        drop(drafts);
        drop(profiles);
        remove_test_files(&path);
    }

    #[test]
    fn rejects_a_draft_for_a_missing_profile() {
        let path = temporary_path("draft-profile.sqlite3");
        let profiles = ConnectionProfileService::open(
            path.clone(),
            Box::new(MemoryCredentialStore::default()),
        )
        .unwrap();
        let drafts = QueryDraftService::open(path.clone()).unwrap();

        let error = drafts.save(draft_request("missing-profile")).unwrap_err();
        assert!(matches!(error, super::DraftError::ProfileNotFound(_)));
        assert!(drafts.list().unwrap().is_empty());
        drop(drafts);
        drop(profiles);
        remove_test_files(&path);
    }

    fn draft_request(profile_id: &str) -> SaveQueryDraftRequest {
        SaveQueryDraftRequest {
            id: "workspace-1".to_owned(),
            profile_id: profile_id.to_owned(),
            database: "postgres".to_owned(),
            schema: Some("public".to_owned()),
            title: "Query 1".to_owned(),
            sql: "select 1;".to_owned(),
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
            password: Some("secret".to_owned()),
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
