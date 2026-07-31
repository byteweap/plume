use std::{path::PathBuf, sync::Mutex, time::Duration};

use rusqlite::Connection;
use serde::Deserialize;
use thiserror::Error;

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum LocalDataScope {
    History,
    Drafts,
    Cache,
    All,
}

#[derive(Debug, Error)]
pub enum LocalDataError {
    #[error("Local data storage failed: {0}")]
    Storage(#[from] rusqlite::Error),
    #[error("Local data storage is unavailable.")]
    Lock,
}

struct LocalDataRepository {
    connection: Connection,
}

impl LocalDataRepository {
    fn open(path: PathBuf) -> Result<Self, LocalDataError> {
        let connection = Connection::open(path)?;
        connection.busy_timeout(Duration::from_secs(5))?;
        connection.pragma_update(None, "foreign_keys", "ON")?;
        Ok(Self { connection })
    }

    fn clear(&mut self, scope: LocalDataScope) -> Result<(), LocalDataError> {
        let transaction = self.connection.transaction()?;
        match scope {
            LocalDataScope::History => {
                transaction.execute("DELETE FROM query_history", [])?;
            }
            LocalDataScope::Drafts => {
                transaction.execute("DELETE FROM query_drafts", [])?;
                transaction.execute("DELETE FROM workspace_tabs", [])?;
                transaction.execute("DELETE FROM workspace_snapshots", [])?;
            }
            LocalDataScope::Cache => {
                transaction.execute("DELETE FROM local_settings WHERE key LIKE 'cache.%'", [])?;
            }
            LocalDataScope::All => {
                transaction.execute_batch(
                    "DELETE FROM query_history;
                     DELETE FROM query_drafts;
                     DELETE FROM workspace_tabs;
                     DELETE FROM workspace_snapshots;
                     DELETE FROM local_tag_assignments;
                     DELETE FROM local_tags;
                     DELETE FROM local_settings;",
                )?;
            }
        }
        transaction.commit()?;
        Ok(())
    }
}

pub struct LocalDataService {
    repository: Mutex<LocalDataRepository>,
}

impl LocalDataService {
    pub fn open(path: PathBuf) -> Result<Self, LocalDataError> {
        Ok(Self {
            repository: Mutex::new(LocalDataRepository::open(path)?),
        })
    }

    pub fn clear(&self, scope: LocalDataScope) -> Result<(), LocalDataError> {
        self.repository
            .lock()
            .map_err(|_| LocalDataError::Lock)?
            .clear(scope)
    }
}

#[cfg(test)]
mod tests {
    use std::{fs, path::Path};

    use rusqlite::Connection;
    use uuid::Uuid;

    use super::{LocalDataScope, LocalDataService};
    use crate::{credentials::MemoryCredentialStore, profiles::ConnectionProfileService};

    #[test]
    fn clears_each_scope_and_all_workspace_data() {
        let path = temporary_path("local-data.sqlite3");
        let profiles = ConnectionProfileService::open(
            path.clone(),
            Box::new(MemoryCredentialStore::default()),
        )
        .unwrap();
        let connection = Connection::open(&path).unwrap();
        connection
            .execute(
                "INSERT INTO connection_profiles
                 (id, name, host, port, database_name, username, environment, ssl_mode,
                  credential_ref, is_favorite, created_at, updated_at)
                 VALUES ('profile-1', 'Local', 'localhost', 5432, 'postgres', 'postgres',
                         'development', 'disable', 'credential-1', 0, 1, 1)",
                [],
            )
            .unwrap();
        connection
            .execute(
                "INSERT INTO query_history
                 (id, profile_id, database_name, sql, duration_ms, result_status, executed_at)
                 VALUES ('history-1', NULL, 'postgres', 'select 1;', 1, 'succeeded', 1)",
                [],
            )
            .unwrap();
        connection
            .execute(
                "INSERT INTO query_drafts
                 (id, profile_id, database_name, schema_name, title, sql, created_at, updated_at)
                 VALUES ('draft-1', 'profile-1', 'postgres', 'public', 'Query 1',
                         'select 1;', 1, 1)",
                [],
            )
            .unwrap();
        connection
            .execute(
                "INSERT INTO workspace_snapshots
                 (id, active_tab_id, next_tab_id, next_query_number, layout_json, updated_at)
                 VALUES ('current', 'draft-1', 2, 2, '{}', 1)",
                [],
            )
            .unwrap();
        connection
            .execute(
                "INSERT INTO workspace_tabs
                 (id, snapshot_id, kind, profile_id, database_name, title, sql, position, state_json)
                 VALUES ('draft-1', 'current', 'query', 'profile-1', 'postgres',
                         'Query 1', 'select 1;', 0, '{}')",
                [],
            )
            .unwrap();
        connection
            .execute(
                "INSERT INTO local_settings (key, value_json, updated_at)
                 VALUES ('cache.catalog', '{}', 1), ('user.theme', '{}', 1)",
                [],
            )
            .unwrap();
        drop(connection);
        let service = LocalDataService::open(path.clone()).unwrap();

        service.clear(LocalDataScope::History).unwrap();
        let connection = Connection::open(&path).unwrap();
        let history_count: i64 = connection
            .query_row("SELECT COUNT(*) FROM query_history", [], |row| row.get(0))
            .unwrap();
        assert_eq!(history_count, 0);
        drop(connection);

        service.clear(LocalDataScope::Cache).unwrap();
        let connection = Connection::open(&path).unwrap();
        let cache_count: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM local_settings WHERE key LIKE 'cache.%'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        let user_setting_count: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM local_settings WHERE key = 'user.theme'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(cache_count, 0);
        assert_eq!(user_setting_count, 1);
        drop(connection);

        service.clear(LocalDataScope::Drafts).unwrap();
        let connection = Connection::open(&path).unwrap();
        for table in ["query_drafts", "workspace_snapshots", "workspace_tabs"] {
            let count: i64 = connection
                .query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| {
                    row.get(0)
                })
                .unwrap();
            assert_eq!(count, 0, "drafts scope should clear {table}");
        }
        let profile_count: i64 = connection
            .query_row("SELECT COUNT(*) FROM connection_profiles", [], |row| {
                row.get(0)
            })
            .unwrap();
        let setting_count: i64 = connection
            .query_row("SELECT COUNT(*) FROM local_settings", [], |row| row.get(0))
            .unwrap();
        assert_eq!(profile_count, 1);
        assert_eq!(setting_count, 1);
        drop(connection);

        profiles.clear_all().unwrap();
        service.clear(LocalDataScope::All).unwrap();
        let connection = Connection::open(&path).unwrap();
        for table in [
            "query_history",
            "query_drafts",
            "workspace_snapshots",
            "workspace_tabs",
            "local_tags",
            "local_tag_assignments",
            "local_settings",
            "connection_profiles",
        ] {
            let count: i64 = connection
                .query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| {
                    row.get(0)
                })
                .unwrap();
            assert_eq!(count, 0, "all scope should clear {table}");
        }
        drop(connection);
        drop(service);
        drop(profiles);
        remove_test_files(&path);
    }

    fn temporary_path(name: &str) -> std::path::PathBuf {
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
