use std::{collections::HashSet, path::PathBuf, sync::Mutex, time::Duration};

use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};
use thiserror::Error;

const CURRENT_SNAPSHOT_ID: &str = "current";
const MAX_TABS: usize = 200;
const MAX_SQL_BYTES: usize = 5 * 1024 * 1024;

#[derive(Debug, Error)]
pub enum WorkspaceSnapshotError {
    #[error("Local workspace snapshot storage failed: {0}")]
    Storage(#[from] rusqlite::Error),
    #[error("The workspace snapshot is invalid: {0}")]
    Invalid(String),
    #[error("The workspace snapshot layout is invalid: {0}")]
    Layout(#[from] serde_json::Error),
    #[error("Local workspace snapshot storage is unavailable.")]
    Lock,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WorkspaceLayout {
    pub sidebar_width: u32,
    pub sidebar_collapsed: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WorkspaceSnapshotTab {
    pub id: String,
    pub kind: String,
    pub profile_id: Option<String>,
    pub database: Option<String>,
    pub schema: Option<String>,
    pub title: Option<String>,
    pub table: Option<String>,
    pub sql: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SaveWorkspaceSnapshotRequest {
    pub active_tab_id: String,
    pub next_tab_id: u32,
    pub next_query_number: u32,
    pub layout: WorkspaceLayout,
    pub tabs: Vec<WorkspaceSnapshotTab>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceSnapshot {
    pub active_tab_id: String,
    pub next_tab_id: u32,
    pub next_query_number: u32,
    pub layout: WorkspaceLayout,
    pub tabs: Vec<WorkspaceSnapshotTab>,
    pub updated_at: i64,
}

struct WorkspaceSnapshotRepository {
    connection: Connection,
}

impl WorkspaceSnapshotRepository {
    fn open(path: PathBuf) -> Result<Self, WorkspaceSnapshotError> {
        let connection = Connection::open(path)?;
        connection.busy_timeout(Duration::from_secs(5))?;
        connection.pragma_update(None, "foreign_keys", "ON")?;
        Ok(Self { connection })
    }

    fn save(
        &mut self,
        request: &SaveWorkspaceSnapshotRequest,
    ) -> Result<WorkspaceSnapshot, WorkspaceSnapshotError> {
        validate_snapshot(request)?;
        let layout_json = serde_json::to_string(&request.layout)?;
        let updated_at = unix_timestamp();
        let transaction = self.connection.transaction()?;
        transaction.execute(
            "INSERT INTO workspace_snapshots (
                id, active_tab_id, next_tab_id, next_query_number, layout_json, updated_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
             ON CONFLICT(id) DO UPDATE SET
                active_tab_id = excluded.active_tab_id,
                next_tab_id = excluded.next_tab_id,
                next_query_number = excluded.next_query_number,
                layout_json = excluded.layout_json,
                updated_at = excluded.updated_at",
            params![
                CURRENT_SNAPSHOT_ID,
                request.active_tab_id,
                request.next_tab_id,
                request.next_query_number,
                layout_json,
                updated_at,
            ],
        )?;
        transaction.execute(
            "DELETE FROM workspace_tabs WHERE snapshot_id = ?1",
            [CURRENT_SNAPSHOT_ID],
        )?;
        for (position, tab) in request.tabs.iter().enumerate() {
            transaction.execute(
                "INSERT INTO workspace_tabs (
                    id, snapshot_id, kind, profile_id, database_name, schema_name,
                    title, table_name, sql, position, state_json
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, '{}')",
                params![
                    tab.id,
                    CURRENT_SNAPSHOT_ID,
                    tab.kind,
                    tab.profile_id,
                    tab.database,
                    tab.schema,
                    tab.title,
                    tab.table,
                    tab.sql,
                    i64::try_from(position).unwrap_or(i64::MAX),
                ],
            )?;
        }
        transaction.commit()?;

        Ok(WorkspaceSnapshot {
            active_tab_id: request.active_tab_id.clone(),
            next_tab_id: request.next_tab_id,
            next_query_number: request.next_query_number,
            layout: request.layout.clone(),
            tabs: request.tabs.clone(),
            updated_at,
        })
    }

    fn load(&self) -> Result<Option<WorkspaceSnapshot>, WorkspaceSnapshotError> {
        let header = self
            .connection
            .query_row(
                "SELECT active_tab_id, next_tab_id, next_query_number, layout_json, updated_at
                 FROM workspace_snapshots WHERE id = ?1",
                [CURRENT_SNAPSHOT_ID],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, u32>(1)?,
                        row.get::<_, u32>(2)?,
                        row.get::<_, String>(3)?,
                        row.get::<_, i64>(4)?,
                    ))
                },
            )
            .optional()?;
        let Some((active_tab_id, next_tab_id, next_query_number, layout_json, updated_at)) = header
        else {
            return Ok(None);
        };
        let layout = serde_json::from_str(&layout_json)?;
        let mut statement = self.connection.prepare(
            "SELECT id, kind, profile_id, database_name, schema_name, title, table_name, sql
             FROM workspace_tabs
             WHERE snapshot_id = ?1
             ORDER BY position, id",
        )?;
        let tabs = statement
            .query_map([CURRENT_SNAPSHOT_ID], |row| {
                Ok(WorkspaceSnapshotTab {
                    id: row.get(0)?,
                    kind: row.get(1)?,
                    profile_id: row.get(2)?,
                    database: row.get(3)?,
                    schema: row.get(4)?,
                    title: row.get(5)?,
                    table: row.get(6)?,
                    sql: row.get(7)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;

        Ok(Some(WorkspaceSnapshot {
            active_tab_id,
            next_tab_id,
            next_query_number,
            layout,
            tabs,
            updated_at,
        }))
    }
}

pub struct WorkspaceSnapshotService {
    repository: Mutex<WorkspaceSnapshotRepository>,
}

impl WorkspaceSnapshotService {
    pub fn open(path: PathBuf) -> Result<Self, WorkspaceSnapshotError> {
        Ok(Self {
            repository: Mutex::new(WorkspaceSnapshotRepository::open(path)?),
        })
    }

    pub fn save(
        &self,
        request: SaveWorkspaceSnapshotRequest,
    ) -> Result<WorkspaceSnapshot, WorkspaceSnapshotError> {
        self.repository()?.save(&request)
    }

    pub fn load(&self) -> Result<Option<WorkspaceSnapshot>, WorkspaceSnapshotError> {
        self.repository()?.load()
    }

    fn repository(
        &self,
    ) -> Result<std::sync::MutexGuard<'_, WorkspaceSnapshotRepository>, WorkspaceSnapshotError>
    {
        self.repository
            .lock()
            .map_err(|_| WorkspaceSnapshotError::Lock)
    }
}

fn validate_snapshot(request: &SaveWorkspaceSnapshotRequest) -> Result<(), WorkspaceSnapshotError> {
    if request.next_tab_id == 0 || request.next_query_number == 0 {
        return Err(WorkspaceSnapshotError::Invalid(
            "Workspace counters must be greater than zero.".to_owned(),
        ));
    }
    if !(180..=1_000).contains(&request.layout.sidebar_width) {
        return Err(WorkspaceSnapshotError::Invalid(
            "Sidebar width must be between 180 and 1000 pixels.".to_owned(),
        ));
    }
    if request.tabs.is_empty() || request.tabs.len() > MAX_TABS {
        return Err(WorkspaceSnapshotError::Invalid(format!(
            "A workspace snapshot must contain between 1 and {MAX_TABS} tabs."
        )));
    }

    let mut ids = HashSet::with_capacity(request.tabs.len());
    for (position, tab) in request.tabs.iter().enumerate() {
        if tab.id.trim().is_empty() || !ids.insert(tab.id.as_str()) {
            return Err(WorkspaceSnapshotError::Invalid(
                "Workspace tab IDs must be present and unique.".to_owned(),
            ));
        }
        validate_tab(tab, position)?;
    }
    if !ids.contains(request.active_tab_id.as_str()) {
        return Err(WorkspaceSnapshotError::Invalid(
            "The active workspace tab must exist in the snapshot.".to_owned(),
        ));
    }
    Ok(())
}

fn validate_tab(tab: &WorkspaceSnapshotTab, position: usize) -> Result<(), WorkspaceSnapshotError> {
    let required = |value: &Option<String>| {
        value
            .as_deref()
            .is_some_and(|value| !value.trim().is_empty())
    };
    let absent = |value: &Option<String>| value.is_none();
    match tab.kind.as_str() {
        "welcome"
            if position == 0
                && tab.id == "welcome"
                && absent(&tab.profile_id)
                && absent(&tab.database)
                && absent(&tab.schema)
                && absent(&tab.title)
                && absent(&tab.table)
                && absent(&tab.sql) => {}
        "connection"
            if required(&tab.profile_id)
                && required(&tab.database)
                && absent(&tab.table)
                && absent(&tab.sql) => {}
        "query"
            if required(&tab.profile_id)
                && required(&tab.database)
                && required(&tab.title)
                && absent(&tab.table)
                && tab.sql.is_some() =>
        {
            if tab
                .sql
                .as_ref()
                .is_some_and(|sql| sql.len() > MAX_SQL_BYTES)
            {
                return Err(WorkspaceSnapshotError::Invalid(format!(
                    "Workspace tab SQL must not exceed {MAX_SQL_BYTES} bytes."
                )));
            }
        }
        "table-data"
            if required(&tab.profile_id)
                && required(&tab.database)
                && required(&tab.schema)
                && required(&tab.title)
                && required(&tab.table)
                && absent(&tab.sql) => {}
        _ => {
            return Err(WorkspaceSnapshotError::Invalid(format!(
                "Workspace tab '{}' has invalid fields for kind '{}'.",
                tab.id, tab.kind
            )));
        }
    }
    Ok(())
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

    use rusqlite::Connection;
    use uuid::Uuid;

    use super::{
        SaveWorkspaceSnapshotRequest, WorkspaceLayout, WorkspaceSnapshotService,
        WorkspaceSnapshotTab,
    };
    use crate::{credentials::MemoryCredentialStore, profiles::ConnectionProfileService};

    #[test]
    fn replaces_and_loads_the_current_snapshot_without_result_data() {
        let path = temporary_path("workspace-snapshot.sqlite3");
        let profiles = ConnectionProfileService::open(
            path.clone(),
            Box::new(MemoryCredentialStore::default()),
        )
        .unwrap();
        let snapshots = WorkspaceSnapshotService::open(path.clone()).unwrap();
        let first = snapshot_request(vec![
            welcome_tab(),
            query_tab("workspace-1", "select 'first';"),
        ]);
        snapshots.save(first).unwrap();

        let mut replacement = snapshot_request(vec![
            welcome_tab(),
            query_tab("workspace-2", "select 'unsaved';"),
        ]);
        replacement.active_tab_id = "workspace-2".to_owned();
        replacement.layout.sidebar_collapsed = true;
        snapshots.save(replacement.clone()).unwrap();

        let loaded = snapshots.load().unwrap().unwrap();
        assert_eq!(loaded.active_tab_id, "workspace-2");
        assert_eq!(loaded.tabs, replacement.tabs);
        assert!(loaded.layout.sidebar_collapsed);
        let connection = Connection::open(&path).unwrap();
        let first_exists: bool = connection
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM workspace_tabs WHERE id = 'workspace-1')",
                [],
                |row| row.get(0),
            )
            .unwrap();
        let state_json: String = connection
            .query_row(
                "SELECT state_json FROM workspace_tabs WHERE id = 'workspace-2'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert!(!first_exists);
        assert_eq!(state_json, "{}");
        drop(connection);
        drop(snapshots);
        drop(profiles);
        remove_test_files(&path);
    }

    #[test]
    fn rejects_duplicate_tabs_and_missing_active_tabs() {
        let path = temporary_path("workspace-invalid.sqlite3");
        let profiles = ConnectionProfileService::open(
            path.clone(),
            Box::new(MemoryCredentialStore::default()),
        )
        .unwrap();
        let snapshots = WorkspaceSnapshotService::open(path.clone()).unwrap();
        let duplicate = snapshot_request(vec![welcome_tab(), welcome_tab()]);
        assert!(snapshots.save(duplicate).is_err());

        let mut missing_active = snapshot_request(vec![welcome_tab()]);
        missing_active.active_tab_id = "missing".to_owned();
        assert!(snapshots.save(missing_active).is_err());
        assert!(snapshots.load().unwrap().is_none());
        drop(snapshots);
        drop(profiles);
        remove_test_files(&path);
    }

    #[test]
    fn rejects_unknown_snapshot_fields_and_cross_kind_sql() {
        let unknown = r#"{
            "activeTabId":"welcome",
            "nextTabId":1,
            "nextQueryNumber":1,
            "layout":{"sidebarWidth":286,"sidebarCollapsed":false},
            "tabs":[{"id":"welcome","kind":"welcome","result":[["secret"]]}]
        }"#;
        assert!(serde_json::from_str::<SaveWorkspaceSnapshotRequest>(unknown).is_err());

        let path = temporary_path("workspace-kind-fields.sqlite3");
        let profiles = ConnectionProfileService::open(
            path.clone(),
            Box::new(MemoryCredentialStore::default()),
        )
        .unwrap();
        let snapshots = WorkspaceSnapshotService::open(path.clone()).unwrap();
        let mut request = snapshot_request(vec![welcome_tab()]);
        request.tabs[0].sql = Some("select 'must not persist';".to_owned());
        assert!(snapshots.save(request).is_err());
        drop(snapshots);
        drop(profiles);
        remove_test_files(&path);
    }

    fn snapshot_request(tabs: Vec<WorkspaceSnapshotTab>) -> SaveWorkspaceSnapshotRequest {
        SaveWorkspaceSnapshotRequest {
            active_tab_id: "welcome".to_owned(),
            next_tab_id: 3,
            next_query_number: 2,
            layout: WorkspaceLayout {
                sidebar_width: 286,
                sidebar_collapsed: false,
            },
            tabs,
        }
    }

    fn welcome_tab() -> WorkspaceSnapshotTab {
        WorkspaceSnapshotTab {
            id: "welcome".to_owned(),
            kind: "welcome".to_owned(),
            profile_id: None,
            database: None,
            schema: None,
            title: None,
            table: None,
            sql: None,
        }
    }

    fn query_tab(id: &str, sql: &str) -> WorkspaceSnapshotTab {
        WorkspaceSnapshotTab {
            id: id.to_owned(),
            kind: "query".to_owned(),
            profile_id: Some("profile-1".to_owned()),
            database: Some("postgres".to_owned()),
            schema: Some("public".to_owned()),
            title: Some("Query 1".to_owned()),
            table: None,
            sql: Some(sql.to_owned()),
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
