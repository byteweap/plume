use std::{
    fs,
    path::{Path, PathBuf},
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};

use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};
use thiserror::Error;
use uuid::Uuid;

use crate::{
    credentials::{CredentialError, CredentialStore},
    database::{
        connection::{ConnectionTestRequest, SslMode},
        ssh::{
            ResolvedSshConfig, ResolvedSshEndpoint, SshAuthentication, SshConfig, SshEndpointConfig,
        },
    },
};

const CURRENT_SCHEMA_VERSION: i64 = 2;

#[derive(Debug, Error)]
pub enum ProfileError {
    #[error("Local profile storage failed: {0}")]
    Storage(#[from] rusqlite::Error),
    #[error("Unable to prepare the local profile directory: {0}")]
    Directory(#[from] std::io::Error),
    #[error("The local profile schema version {0} is newer than this version of Plume supports.")]
    UnsupportedSchema(i64),
    #[error("The saved connection profile '{0}' does not exist.")]
    NotFound(String),
    #[error("The connection profile is invalid: {0}")]
    Invalid(String),
    #[error(transparent)]
    Credential(#[from] CredentialError),
    #[error("Local profile storage is unavailable.")]
    Lock,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionProfile {
    pub id: String,
    pub name: String,
    pub host: String,
    pub port: u16,
    pub database: String,
    pub username: String,
    pub environment: String,
    pub color: String,
    pub ssl_mode: SslMode,
    pub root_certificate_path: Option<String>,
    pub client_certificate_path: Option<String>,
    pub client_key_path: Option<String>,
    pub ssh_config: Option<SshConfig>,
    pub favorite: bool,
    pub created_at: i64,
    pub updated_at: i64,
    #[serde(skip)]
    credential_ref: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfileWriteRequest {
    pub id: Option<String>,
    pub name: String,
    pub host: String,
    pub port: u16,
    pub database: String,
    pub username: String,
    pub password: Option<String>,
    pub environment: String,
    pub color: String,
    pub ssl_mode: SslMode,
    pub root_certificate_path: Option<String>,
    pub client_certificate_path: Option<String>,
    pub client_key_path: Option<String>,
    pub ssh_config: Option<SshConfig>,
    pub ssh_password: Option<String>,
    pub ssh_private_key_passphrase: Option<String>,
    pub ssh_jump_password: Option<String>,
    pub ssh_jump_private_key_passphrase: Option<String>,
    pub favorite: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfileIdRequest {
    pub id: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RenameProfileRequest {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FavoriteProfileRequest {
    pub id: String,
    pub favorite: bool,
}

struct ProfileRepository {
    connection: Connection,
}

impl ProfileRepository {
    fn open(path: &Path) -> Result<Self, ProfileError> {
        let connection = Connection::open(path)?;
        Self::prepare(connection)
    }

    #[cfg(test)]
    fn memory() -> Result<Self, ProfileError> {
        Self::prepare(Connection::open_in_memory()?)
    }

    fn prepare(connection: Connection) -> Result<Self, ProfileError> {
        connection.busy_timeout(std::time::Duration::from_secs(5))?;
        connection.pragma_update(None, "foreign_keys", "ON")?;
        connection.pragma_update(None, "journal_mode", "WAL")?;
        let quick_check: String =
            connection.query_row("PRAGMA quick_check", [], |row| row.get(0))?;
        if quick_check != "ok" {
            return Err(ProfileError::Invalid(format!(
                "SQLite integrity check failed: {quick_check}"
            )));
        }

        let mut repository = Self { connection };
        repository.migrate()?;
        Ok(repository)
    }

    fn migrate(&mut self) -> Result<(), ProfileError> {
        let version: i64 = self
            .connection
            .query_row("PRAGMA user_version", [], |row| row.get(0))?;
        if version > CURRENT_SCHEMA_VERSION {
            return Err(ProfileError::UnsupportedSchema(version));
        }

        if version == 0 {
            let transaction = self.connection.transaction()?;
            transaction.execute_batch(
                "CREATE TABLE connection_profiles (
                    id TEXT PRIMARY KEY NOT NULL,
                    name TEXT NOT NULL,
                    host TEXT NOT NULL,
                    port INTEGER NOT NULL,
                    database_name TEXT NOT NULL,
                    username TEXT NOT NULL,
                    environment TEXT NOT NULL,
                    ssl_mode TEXT NOT NULL,
                    root_certificate_path TEXT,
                    ssh_config_json TEXT,
                    credential_ref TEXT NOT NULL UNIQUE,
                    is_favorite INTEGER NOT NULL DEFAULT 0,
                    created_at INTEGER NOT NULL,
                    updated_at INTEGER NOT NULL
                );
                PRAGMA user_version = 1;",
            )?;
            transaction.commit()?;
        }

        let version: i64 = self
            .connection
            .query_row("PRAGMA user_version", [], |row| row.get(0))?;
        if version == 1 {
            let transaction = self.connection.transaction()?;
            transaction.execute_batch(
                "ALTER TABLE connection_profiles ADD COLUMN color TEXT NOT NULL DEFAULT '#2f6d52';
                 ALTER TABLE connection_profiles ADD COLUMN client_certificate_path TEXT;
                 ALTER TABLE connection_profiles ADD COLUMN client_key_path TEXT;
                 PRAGMA user_version = 2;",
            )?;
            transaction.commit()?;
        }
        Ok(())
    }

    fn list(&self) -> Result<Vec<ConnectionProfile>, ProfileError> {
        let mut statement = self.connection.prepare(
            "SELECT id, name, host, port, database_name, username, environment, color,
                    ssl_mode, root_certificate_path, client_certificate_path, client_key_path,
                    ssh_config_json, credential_ref, is_favorite, created_at, updated_at
             FROM connection_profiles
             ORDER BY is_favorite DESC, lower(name), created_at",
        )?;
        let profiles = statement
            .query_map([], Self::read_profile)?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(profiles)
    }

    fn get(&self, id: &str) -> Result<ConnectionProfile, ProfileError> {
        self.connection
            .query_row(
                "SELECT id, name, host, port, database_name, username, environment, color,
                        ssl_mode, root_certificate_path, client_certificate_path, client_key_path,
                        ssh_config_json, credential_ref, is_favorite, created_at, updated_at
                 FROM connection_profiles WHERE id = ?1",
                [id],
                Self::read_profile,
            )
            .optional()?
            .ok_or_else(|| ProfileError::NotFound(id.to_owned()))
    }

    fn insert(
        &mut self,
        request: &ProfileWriteRequest,
        id: &str,
        credential_ref: &str,
    ) -> Result<ConnectionProfile, ProfileError> {
        validate_request(request)?;
        let now = unix_timestamp();
        let ssh_json = serialize_ssh_config(request.ssh_config.as_ref())?;
        let transaction = self.connection.transaction()?;
        transaction.execute(
            "INSERT INTO connection_profiles (
                id, name, host, port, database_name, username, environment, color, ssl_mode,
                root_certificate_path, client_certificate_path, client_key_path, ssh_config_json,
                credential_ref, is_favorite, created_at, updated_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?16)",
            params![
                id,
                request.name.trim(),
                request.host.trim(),
                request.port,
                request.database.trim(),
                request.username.trim(),
                request.environment,
                request.color,
                ssl_mode_to_str(request.ssl_mode),
                clean_optional(&request.root_certificate_path),
                clean_optional(&request.client_certificate_path),
                clean_optional(&request.client_key_path),
                ssh_json,
                credential_ref,
                request.favorite,
                now,
            ],
        )?;
        transaction.commit()?;
        self.get(id)
    }

    fn update(&mut self, request: &ProfileWriteRequest) -> Result<ConnectionProfile, ProfileError> {
        validate_request(request)?;
        let id = request
            .id
            .as_deref()
            .ok_or_else(|| ProfileError::Invalid("Profile ID is required.".to_owned()))?;
        let ssh_json = serialize_ssh_config(request.ssh_config.as_ref())?;
        let transaction = self.connection.transaction()?;
        let changed = transaction.execute(
            "UPDATE connection_profiles SET
                name = ?2, host = ?3, port = ?4, database_name = ?5, username = ?6,
                environment = ?7, color = ?8, ssl_mode = ?9, root_certificate_path = ?10,
                client_certificate_path = ?11, client_key_path = ?12, ssh_config_json = ?13,
                is_favorite = ?14, updated_at = ?15
             WHERE id = ?1",
            params![
                id,
                request.name.trim(),
                request.host.trim(),
                request.port,
                request.database.trim(),
                request.username.trim(),
                request.environment,
                request.color,
                ssl_mode_to_str(request.ssl_mode),
                clean_optional(&request.root_certificate_path),
                clean_optional(&request.client_certificate_path),
                clean_optional(&request.client_key_path),
                ssh_json,
                request.favorite,
                unix_timestamp(),
            ],
        )?;
        if changed == 0 {
            return Err(ProfileError::NotFound(id.to_owned()));
        }
        transaction.commit()?;
        self.get(id)
    }

    fn rename(&mut self, id: &str, name: &str) -> Result<ConnectionProfile, ProfileError> {
        if name.trim().is_empty() {
            return Err(ProfileError::Invalid(
                "Connection name is required.".to_owned(),
            ));
        }
        let changed = self.connection.execute(
            "UPDATE connection_profiles SET name = ?2, updated_at = ?3 WHERE id = ?1",
            params![id, name.trim(), unix_timestamp()],
        )?;
        if changed == 0 {
            return Err(ProfileError::NotFound(id.to_owned()));
        }
        self.get(id)
    }

    fn set_favorite(
        &mut self,
        id: &str,
        favorite: bool,
    ) -> Result<ConnectionProfile, ProfileError> {
        let changed = self.connection.execute(
            "UPDATE connection_profiles SET is_favorite = ?2, updated_at = ?3 WHERE id = ?1",
            params![id, favorite, unix_timestamp()],
        )?;
        if changed == 0 {
            return Err(ProfileError::NotFound(id.to_owned()));
        }
        self.get(id)
    }

    fn delete(&mut self, id: &str) -> Result<ConnectionProfile, ProfileError> {
        let profile = self.get(id)?;
        let transaction = self.connection.transaction()?;
        transaction.execute("DELETE FROM connection_profiles WHERE id = ?1", [id])?;
        transaction.commit()?;
        Ok(profile)
    }

    fn read_profile(row: &rusqlite::Row<'_>) -> rusqlite::Result<ConnectionProfile> {
        let ssl_mode: String = row.get(8)?;
        let ssh_json: Option<String> = row.get(12)?;
        Ok(ConnectionProfile {
            id: row.get(0)?,
            name: row.get(1)?,
            host: row.get(2)?,
            port: row.get(3)?,
            database: row.get(4)?,
            username: row.get(5)?,
            environment: row.get(6)?,
            color: row.get(7)?,
            ssl_mode: str_to_ssl_mode(&ssl_mode).map_err(|error| {
                rusqlite::Error::FromSqlConversionFailure(
                    8,
                    rusqlite::types::Type::Text,
                    Box::new(error),
                )
            })?,
            root_certificate_path: row.get(9)?,
            client_certificate_path: row.get(10)?,
            client_key_path: row.get(11)?,
            ssh_config: ssh_json
                .map(|value| serde_json::from_str(&value))
                .transpose()
                .map_err(|error| {
                    rusqlite::Error::FromSqlConversionFailure(
                        12,
                        rusqlite::types::Type::Text,
                        Box::new(error),
                    )
                })?,
            credential_ref: row.get(13)?,
            favorite: row.get(14)?,
            created_at: row.get(15)?,
            updated_at: row.get(16)?,
        })
    }
}

pub struct ConnectionProfileService {
    repository: Mutex<ProfileRepository>,
    credentials: Box<dyn CredentialStore>,
}

impl ConnectionProfileService {
    pub fn open(
        path: PathBuf,
        credentials: Box<dyn CredentialStore>,
    ) -> Result<Self, ProfileError> {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }
        let repository = match ProfileRepository::open(&path) {
            Ok(repository) => repository,
            Err(error) if path.exists() && !matches!(error, ProfileError::UnsupportedSchema(_)) => {
                backup_corrupt_database(&path)?;
                ProfileRepository::open(&path)?
            }
            Err(error) => return Err(error),
        };
        Ok(Self {
            repository: Mutex::new(repository),
            credentials,
        })
    }

    #[cfg(test)]
    fn memory(credentials: Box<dyn CredentialStore>) -> Result<Self, ProfileError> {
        Ok(Self {
            repository: Mutex::new(ProfileRepository::memory()?),
            credentials,
        })
    }

    pub fn list(&self) -> Result<Vec<ConnectionProfile>, ProfileError> {
        self.repository()?.list()
    }

    pub fn create(&self, request: ProfileWriteRequest) -> Result<ConnectionProfile, ProfileError> {
        let id = Uuid::new_v4().to_string();
        let credential_ref = id.clone();
        validate_request(&request)?;
        validate_new_ssh_credentials(&request)?;
        let password = request.password.as_deref().unwrap_or_default();
        self.credentials.set(&credential_ref, password)?;
        if let Err(error) = self.update_ssh_credentials(&id, &request) {
            self.delete_all_credentials(&id, &credential_ref);
            return Err(error);
        }
        match self.repository()?.insert(&request, &id, &credential_ref) {
            Ok(profile) => Ok(profile),
            Err(error) => {
                self.delete_all_credentials(&id, &credential_ref);
                Err(error)
            }
        }
    }

    pub fn update(&self, request: ProfileWriteRequest) -> Result<ConnectionProfile, ProfileError> {
        validate_request(&request)?;
        let id = request
            .id
            .as_deref()
            .ok_or_else(|| ProfileError::Invalid("Profile ID is required.".to_owned()))?;
        let existing = self.repository()?.get(id)?;
        self.ensure_ssh_credentials(&existing.id, &request)?;
        if let Some(password) = request
            .password
            .as_deref()
            .filter(|value| !value.is_empty())
        {
            self.credentials.set(&existing.credential_ref, password)?;
        }
        self.update_ssh_credentials(&existing.id, &request)?;
        self.repository()?.update(&request)
    }

    pub fn duplicate(&self, id: &str) -> Result<ConnectionProfile, ProfileError> {
        let existing = self.repository()?.get(id)?;
        let password = self.credentials.get(&existing.credential_ref)?;
        let ssh_password = self.optional_credential(&ssh_credential_ref(id, "password"))?;
        let ssh_private_key_passphrase =
            self.optional_credential(&ssh_credential_ref(id, "key-passphrase"))?;
        let ssh_jump_password =
            self.optional_credential(&ssh_credential_ref(id, "jump-password"))?;
        let ssh_jump_private_key_passphrase =
            self.optional_credential(&ssh_credential_ref(id, "jump-key-passphrase"))?;
        self.create(ProfileWriteRequest {
            id: None,
            name: format!("{} Copy", existing.name),
            host: existing.host,
            port: existing.port,
            database: existing.database,
            username: existing.username,
            password: Some(password),
            environment: existing.environment,
            color: existing.color,
            ssl_mode: existing.ssl_mode,
            root_certificate_path: existing.root_certificate_path,
            client_certificate_path: existing.client_certificate_path,
            client_key_path: existing.client_key_path,
            ssh_config: existing.ssh_config,
            ssh_password,
            ssh_private_key_passphrase,
            ssh_jump_password,
            ssh_jump_private_key_passphrase,
            favorite: false,
        })
    }

    pub fn rename(&self, id: &str, name: &str) -> Result<ConnectionProfile, ProfileError> {
        self.repository()?.rename(id, name)
    }

    pub fn set_favorite(
        &self,
        id: &str,
        favorite: bool,
    ) -> Result<ConnectionProfile, ProfileError> {
        self.repository()?.set_favorite(id, favorite)
    }

    pub fn delete(&self, id: &str) -> Result<(), ProfileError> {
        let profile = self.repository()?.delete(id)?;
        self.delete_all_credentials(&profile.id, &profile.credential_ref);
        Ok(())
    }

    pub fn connection_request(&self, id: &str) -> Result<ConnectionTestRequest, ProfileError> {
        let profile = self.repository()?.get(id)?;
        let password = self.credentials.get(&profile.credential_ref)?;
        let ssh_config = self.resolve_saved_ssh(&profile)?;
        Ok(ConnectionTestRequest {
            host: profile.host,
            port: profile.port,
            database: profile.database,
            username: profile.username,
            password,
            ssl_mode: profile.ssl_mode,
            root_certificate_path: profile.root_certificate_path,
            client_certificate_path: profile.client_certificate_path,
            client_key_path: profile.client_key_path,
            timeout_seconds: 10,
            ssh_config,
            connect_hostaddr: None,
            connect_port: None,
        })
    }

    pub fn test_request(
        &self,
        request: &ProfileWriteRequest,
    ) -> Result<ConnectionTestRequest, ProfileError> {
        validate_request(request)?;
        let password = match request.password.as_deref() {
            Some(password) if !password.is_empty() => password.to_owned(),
            _ => match request.id.as_deref() {
                Some(id) => {
                    let profile = self.repository()?.get(id)?;
                    self.credentials.get(&profile.credential_ref)?
                }
                None => String::new(),
            },
        };
        let ssh_config = self.resolve_test_ssh(request)?;
        Ok(ConnectionTestRequest {
            host: request.host.trim().to_owned(),
            port: request.port,
            database: request.database.trim().to_owned(),
            username: request.username.trim().to_owned(),
            password,
            ssl_mode: request.ssl_mode,
            root_certificate_path: clean_optional(&request.root_certificate_path)
                .map(str::to_owned),
            client_certificate_path: clean_optional(&request.client_certificate_path)
                .map(str::to_owned),
            client_key_path: clean_optional(&request.client_key_path).map(str::to_owned),
            timeout_seconds: 10,
            ssh_config,
            connect_hostaddr: None,
            connect_port: None,
        })
    }

    fn repository(&self) -> Result<std::sync::MutexGuard<'_, ProfileRepository>, ProfileError> {
        self.repository.lock().map_err(|_| ProfileError::Lock)
    }

    fn resolve_saved_ssh(
        &self,
        profile: &ConnectionProfile,
    ) -> Result<Option<ResolvedSshConfig>, ProfileError> {
        profile
            .ssh_config
            .as_ref()
            .map(|config| self.resolve_ssh(&profile.id, config, None))
            .transpose()
    }

    fn resolve_test_ssh(
        &self,
        request: &ProfileWriteRequest,
    ) -> Result<Option<ResolvedSshConfig>, ProfileError> {
        request
            .ssh_config
            .as_ref()
            .map(|config| {
                self.resolve_ssh(
                    request.id.as_deref().unwrap_or("unsaved"),
                    config,
                    Some(request),
                )
            })
            .transpose()
    }

    fn resolve_ssh(
        &self,
        id: &str,
        config: &SshConfig,
        request: Option<&ProfileWriteRequest>,
    ) -> Result<ResolvedSshConfig, ProfileError> {
        let endpoint = self.resolve_ssh_endpoint(
            id,
            &config.endpoint,
            request.and_then(|request| request.ssh_password.as_deref()),
            request.and_then(|request| request.ssh_private_key_passphrase.as_deref()),
            "password",
            "key-passphrase",
        )?;
        let jump_host = config
            .jump_host
            .as_ref()
            .map(|jump| {
                self.resolve_ssh_endpoint(
                    id,
                    jump,
                    request.and_then(|request| request.ssh_jump_password.as_deref()),
                    request.and_then(|request| request.ssh_jump_private_key_passphrase.as_deref()),
                    "jump-password",
                    "jump-key-passphrase",
                )
            })
            .transpose()?;
        Ok(ResolvedSshConfig {
            endpoint,
            jump_host,
        })
    }

    #[allow(clippy::too_many_arguments)]
    fn resolve_ssh_endpoint(
        &self,
        id: &str,
        config: &SshEndpointConfig,
        provided_password: Option<&str>,
        provided_passphrase: Option<&str>,
        password_suffix: &str,
        passphrase_suffix: &str,
    ) -> Result<ResolvedSshEndpoint, ProfileError> {
        let password = match config.authentication {
            SshAuthentication::Password => {
                Some(self.resolve_credential(id, password_suffix, provided_password, true)?)
            }
            SshAuthentication::PrivateKey => None,
        };
        let private_key_passphrase = match config.authentication {
            SshAuthentication::PrivateKey => {
                self.resolve_optional_credential(id, passphrase_suffix, provided_passphrase)?
            }
            SshAuthentication::Password => None,
        };
        Ok(ResolvedSshEndpoint {
            config: config.clone(),
            password,
            private_key_passphrase,
        })
    }

    fn resolve_credential(
        &self,
        id: &str,
        suffix: &str,
        provided: Option<&str>,
        required: bool,
    ) -> Result<String, ProfileError> {
        if let Some(value) = clean_secret(provided) {
            return Ok(value.to_owned());
        }
        match self.credentials.get(&ssh_credential_ref(id, suffix)) {
            Ok(value) => Ok(value),
            Err(CredentialError::NotFound(_)) if !required => Ok(String::new()),
            Err(CredentialError::NotFound(_)) => Err(ProfileError::Invalid(
                "The selected SSH authentication method requires a saved secret.".to_owned(),
            )),
            Err(error) => Err(error.into()),
        }
    }

    fn resolve_optional_credential(
        &self,
        id: &str,
        suffix: &str,
        provided: Option<&str>,
    ) -> Result<Option<String>, ProfileError> {
        if let Some(value) = clean_secret(provided) {
            return Ok(Some(value.to_owned()));
        }
        self.optional_credential(&ssh_credential_ref(id, suffix))
    }

    fn optional_credential(&self, reference: &str) -> Result<Option<String>, ProfileError> {
        match self.credentials.get(reference) {
            Ok(value) => Ok(Some(value)),
            Err(CredentialError::NotFound(_)) => Ok(None),
            Err(error) => Err(error.into()),
        }
    }

    fn ensure_ssh_credentials(
        &self,
        id: &str,
        request: &ProfileWriteRequest,
    ) -> Result<(), ProfileError> {
        let Some(config) = request.ssh_config.as_ref() else {
            return Ok(());
        };
        self.ensure_endpoint_credential(
            id,
            &config.endpoint,
            request.ssh_password.as_deref(),
            "password",
        )?;
        if let Some(jump) = config.jump_host.as_ref() {
            self.ensure_endpoint_credential(
                id,
                jump,
                request.ssh_jump_password.as_deref(),
                "jump-password",
            )?;
        }
        Ok(())
    }

    fn ensure_endpoint_credential(
        &self,
        id: &str,
        endpoint: &SshEndpointConfig,
        provided_password: Option<&str>,
        suffix: &str,
    ) -> Result<(), ProfileError> {
        if matches!(endpoint.authentication, SshAuthentication::Password)
            && clean_secret(provided_password).is_none()
            && self
                .optional_credential(&ssh_credential_ref(id, suffix))?
                .is_none()
        {
            return Err(ProfileError::Invalid(
                "An SSH password is required for password authentication.".to_owned(),
            ));
        }
        Ok(())
    }

    fn update_ssh_credentials(
        &self,
        id: &str,
        request: &ProfileWriteRequest,
    ) -> Result<(), ProfileError> {
        let Some(config) = request.ssh_config.as_ref() else {
            for suffix in [
                "password",
                "key-passphrase",
                "jump-password",
                "jump-key-passphrase",
            ] {
                self.credentials.delete(&ssh_credential_ref(id, suffix))?;
            }
            return Ok(());
        };

        self.update_endpoint_credentials(
            id,
            &config.endpoint,
            request.ssh_password.as_deref(),
            request.ssh_private_key_passphrase.as_deref(),
            "password",
            "key-passphrase",
        )?;
        match config.jump_host.as_ref() {
            Some(jump) => self.update_endpoint_credentials(
                id,
                jump,
                request.ssh_jump_password.as_deref(),
                request.ssh_jump_private_key_passphrase.as_deref(),
                "jump-password",
                "jump-key-passphrase",
            )?,
            None => {
                self.credentials
                    .delete(&ssh_credential_ref(id, "jump-password"))?;
                self.credentials
                    .delete(&ssh_credential_ref(id, "jump-key-passphrase"))?;
            }
        }
        Ok(())
    }

    #[allow(clippy::too_many_arguments)]
    fn update_endpoint_credentials(
        &self,
        id: &str,
        endpoint: &SshEndpointConfig,
        password: Option<&str>,
        passphrase: Option<&str>,
        password_suffix: &str,
        passphrase_suffix: &str,
    ) -> Result<(), ProfileError> {
        match endpoint.authentication {
            SshAuthentication::Password => {
                if let Some(password) = clean_secret(password) {
                    self.credentials
                        .set(&ssh_credential_ref(id, password_suffix), password)?;
                }
                self.credentials
                    .delete(&ssh_credential_ref(id, passphrase_suffix))?;
            }
            SshAuthentication::PrivateKey => {
                if let Some(passphrase) = clean_secret(passphrase) {
                    self.credentials
                        .set(&ssh_credential_ref(id, passphrase_suffix), passphrase)?;
                }
                self.credentials
                    .delete(&ssh_credential_ref(id, password_suffix))?;
            }
        }
        Ok(())
    }

    fn delete_all_credentials(&self, id: &str, database_reference: &str) {
        let _ = self.credentials.delete(database_reference);
        for suffix in [
            "password",
            "key-passphrase",
            "jump-password",
            "jump-key-passphrase",
        ] {
            let _ = self.credentials.delete(&ssh_credential_ref(id, suffix));
        }
    }
}

fn backup_corrupt_database(path: &Path) -> Result<(), std::io::Error> {
    let timestamp = unix_timestamp();
    let backup = path.with_extension(format!("sqlite3.corrupt-{timestamp}"));
    fs::rename(path, backup)?;
    for suffix in ["-wal", "-shm"] {
        let sidecar = PathBuf::from(format!("{}{suffix}", path.display()));
        if sidecar.exists() {
            let backup = PathBuf::from(format!("{}.corrupt-{timestamp}", sidecar.display()));
            fs::rename(sidecar, backup)?;
        }
    }
    Ok(())
}

fn validate_request(request: &ProfileWriteRequest) -> Result<(), ProfileError> {
    if request.name.trim().is_empty()
        || request.host.trim().is_empty()
        || request.database.trim().is_empty()
        || request.username.trim().is_empty()
    {
        return Err(ProfileError::Invalid(
            "Name, host, database, and username are required.".to_owned(),
        ));
    }
    if request.port == 0 {
        return Err(ProfileError::Invalid(
            "Port must be between 1 and 65535.".to_owned(),
        ));
    }
    if matches!(request.ssl_mode, SslMode::VerifyCa | SslMode::VerifyFull)
        && clean_optional(&request.root_certificate_path).is_none()
    {
        return Err(ProfileError::Invalid(
            "A root certificate is required for the selected SSL mode.".to_owned(),
        ));
    }
    let client_certificate = clean_optional(&request.client_certificate_path);
    let client_key = clean_optional(&request.client_key_path);
    if client_certificate.is_some() != client_key.is_some() {
        return Err(ProfileError::Invalid(
            "Client certificate and private key paths must be provided together.".to_owned(),
        ));
    }
    if matches!(request.ssl_mode, SslMode::Disable) && client_certificate.is_some() {
        return Err(ProfileError::Invalid(
            "Client certificates require an SSL connection mode.".to_owned(),
        ));
    }
    if let Some(config) = request.ssh_config.as_ref() {
        validate_ssh_endpoint(&config.endpoint)?;
        if let Some(jump) = config.jump_host.as_ref() {
            validate_ssh_endpoint(jump)?;
        }
    }
    Ok(())
}

fn validate_new_ssh_credentials(request: &ProfileWriteRequest) -> Result<(), ProfileError> {
    let Some(config) = request.ssh_config.as_ref() else {
        return Ok(());
    };
    if matches!(config.endpoint.authentication, SshAuthentication::Password)
        && clean_secret(request.ssh_password.as_deref()).is_none()
    {
        return Err(ProfileError::Invalid(
            "An SSH password is required for password authentication.".to_owned(),
        ));
    }
    if config.jump_host.as_ref().is_some_and(|jump| {
        matches!(jump.authentication, SshAuthentication::Password)
            && clean_secret(request.ssh_jump_password.as_deref()).is_none()
    }) {
        return Err(ProfileError::Invalid(
            "A jump-host password is required for password authentication.".to_owned(),
        ));
    }
    Ok(())
}

fn validate_ssh_endpoint(endpoint: &SshEndpointConfig) -> Result<(), ProfileError> {
    if endpoint.host.trim().is_empty() || endpoint.username.trim().is_empty() || endpoint.port == 0
    {
        return Err(ProfileError::Invalid(
            "SSH host, port, and username are required.".to_owned(),
        ));
    }
    if matches!(endpoint.authentication, SshAuthentication::PrivateKey)
        && clean_optional(&endpoint.private_key_path).is_none()
    {
        return Err(ProfileError::Invalid(
            "An SSH private-key path is required.".to_owned(),
        ));
    }
    Ok(())
}

fn ssh_credential_ref(id: &str, suffix: &str) -> String {
    format!("{id}:ssh:{suffix}")
}

fn clean_secret(value: Option<&str>) -> Option<&str> {
    value.filter(|value| !value.is_empty())
}

fn serialize_ssh_config(value: Option<&SshConfig>) -> Result<Option<String>, ProfileError> {
    value
        .map(serde_json::to_string)
        .transpose()
        .map_err(|error| ProfileError::Invalid(error.to_string()))
}

fn clean_optional(value: &Option<String>) -> Option<&str> {
    value
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
}

fn ssl_mode_to_str(mode: SslMode) -> &'static str {
    match mode {
        SslMode::Disable => "disable",
        SslMode::Prefer => "prefer",
        SslMode::Require => "require",
        SslMode::VerifyCa => "verify-ca",
        SslMode::VerifyFull => "verify-full",
    }
}

fn str_to_ssl_mode(value: &str) -> Result<SslMode, ProfileError> {
    match value {
        "disable" => Ok(SslMode::Disable),
        "prefer" => Ok(SslMode::Prefer),
        "require" => Ok(SslMode::Require),
        "verify-ca" => Ok(SslMode::VerifyCa),
        "verify-full" => Ok(SslMode::VerifyFull),
        _ => Err(ProfileError::Invalid(format!(
            "Unknown SSL mode '{value}'."
        ))),
    }
}

fn unix_timestamp() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
}

#[cfg(test)]
mod tests {
    use std::{fs, sync::Arc};

    use super::*;
    use crate::credentials::{CredentialStore, MemoryCredentialStore};

    fn request(password: &str) -> ProfileWriteRequest {
        ProfileWriteRequest {
            id: None,
            name: "Local development".to_owned(),
            host: "localhost".to_owned(),
            port: 5432,
            database: "postgres".to_owned(),
            username: "postgres".to_owned(),
            password: Some(password.to_owned()),
            environment: "development".to_owned(),
            color: "#2f6d52".to_owned(),
            ssl_mode: SslMode::Prefer,
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

    fn password_ssh_config() -> SshConfig {
        SshConfig {
            endpoint: SshEndpointConfig {
                host: "ssh.internal".to_owned(),
                port: 22,
                username: "plume".to_owned(),
                authentication: SshAuthentication::Password,
                private_key_path: None,
                known_hosts_path: Some("/tmp/known_hosts".to_owned()),
            },
            jump_host: Some(SshEndpointConfig {
                host: "jump.internal".to_owned(),
                port: 2222,
                username: "jump".to_owned(),
                authentication: SshAuthentication::PrivateKey,
                private_key_path: Some("/tmp/jump-key".to_owned()),
                known_hosts_path: None,
            }),
        }
    }

    struct SharedMemoryCredentials(Arc<MemoryCredentialStore>);

    impl CredentialStore for SharedMemoryCredentials {
        fn set(&self, reference: &str, password: &str) -> Result<(), CredentialError> {
            self.0.set(reference, password)
        }
        fn get(&self, reference: &str) -> Result<String, CredentialError> {
            self.0.get(reference)
        }
        fn delete(&self, reference: &str) -> Result<(), CredentialError> {
            self.0.delete(reference)
        }
    }

    #[test]
    fn profile_validation_enforces_ssl_certificate_requirements() {
        let mut value = request("");
        value.ssl_mode = SslMode::VerifyFull;
        assert!(validate_request(&value).is_err());

        value.root_certificate_path = Some("/tmp/ca.crt".to_owned());
        value.client_certificate_path = Some("/tmp/client.crt".to_owned());
        assert!(validate_request(&value).is_err());

        value.client_key_path = Some("/tmp/client.key".to_owned());
        validate_request(&value).expect("a complete TLS profile should be valid");
    }

    #[test]
    fn ssh_config_deserializes_the_frontend_contract() {
        let value = serde_json::json!({
            "host": "ssh.internal",
            "port": 22,
            "username": "plume",
            "authentication": "private-key",
            "privateKeyPath": "/tmp/id_ed25519",
            "knownHostsPath": "/tmp/known_hosts",
            "jumpHost": {
                "host": "jump.internal",
                "port": 2222,
                "username": "jump",
                "authentication": "password"
            }
        });

        let parsed: SshConfig = serde_json::from_value(value).unwrap();
        assert!(matches!(
            parsed.endpoint.authentication,
            SshAuthentication::PrivateKey
        ));
        assert_eq!(
            parsed.endpoint.private_key_path.as_deref(),
            Some("/tmp/id_ed25519")
        );
        assert_eq!(parsed.jump_host.as_ref().unwrap().port, 2222);
    }

    #[test]
    fn ssh_validation_requires_endpoint_fields_and_private_key_path() {
        let mut value = request("");
        value.ssh_config = Some(password_ssh_config());
        validate_request(&value).expect("complete SSH endpoints should be valid");

        value.ssh_config.as_mut().unwrap().endpoint.host.clear();
        assert!(validate_request(&value).is_err());

        let endpoint = &mut value.ssh_config.as_mut().unwrap().endpoint;
        endpoint.host = "ssh.internal".to_owned();
        endpoint.authentication = SshAuthentication::PrivateKey;
        endpoint.private_key_path = None;
        assert!(validate_request(&value).is_err());
    }

    #[test]
    fn ssh_credentials_stay_out_of_profiles_and_follow_the_profile_lifecycle() {
        let credentials = Arc::new(MemoryCredentialStore::default());
        let service = ConnectionProfileService::memory(Box::new(SharedMemoryCredentials(
            Arc::clone(&credentials),
        )))
        .unwrap();
        let mut value = request("database-secret");
        value.ssh_config = Some(password_ssh_config());
        value.ssh_password = Some("ssh-secret".to_owned());
        value.ssh_jump_private_key_passphrase = Some("jump-secret".to_owned());

        let created = service.create(value).unwrap();
        let serialized = serde_json::to_string(&created).unwrap();
        assert!(!serialized.contains("database-secret"));
        assert!(!serialized.contains("ssh-secret"));
        assert!(!serialized.contains("jump-secret"));

        let resolved = service.connection_request(&created.id).unwrap();
        let resolved_ssh = resolved.ssh_config.unwrap();
        assert_eq!(
            resolved_ssh.endpoint.password.as_deref(),
            Some("ssh-secret")
        );
        assert_eq!(
            resolved_ssh
                .jump_host
                .as_ref()
                .unwrap()
                .private_key_passphrase
                .as_deref(),
            Some("jump-secret")
        );

        let duplicate = service.duplicate(&created.id).unwrap();
        let duplicate_ssh = service
            .connection_request(&duplicate.id)
            .unwrap()
            .ssh_config
            .unwrap();
        assert_eq!(
            duplicate_ssh.endpoint.password.as_deref(),
            Some("ssh-secret")
        );
        assert_eq!(
            duplicate_ssh
                .jump_host
                .unwrap()
                .private_key_passphrase
                .as_deref(),
            Some("jump-secret")
        );

        let mut disabled = request("");
        disabled.id = Some(created.id.clone());
        disabled.password = None;
        let updated = service.update(disabled).unwrap();
        assert!(updated.ssh_config.is_none());
        for suffix in [
            "password",
            "key-passphrase",
            "jump-password",
            "jump-key-passphrase",
        ] {
            assert!(
                credentials
                    .get(&ssh_credential_ref(&created.id, suffix))
                    .is_err()
            );
        }

        service.delete(&duplicate.id).unwrap();
        for suffix in [
            "password",
            "key-passphrase",
            "jump-password",
            "jump-key-passphrase",
        ] {
            assert!(
                credentials
                    .get(&ssh_credential_ref(&duplicate.id, suffix))
                    .is_err()
            );
        }
    }

    #[test]
    fn invalid_update_does_not_replace_the_saved_database_password() {
        let service =
            ConnectionProfileService::memory(Box::new(MemoryCredentialStore::default())).unwrap();
        let created = service.create(request("original-secret")).unwrap();
        let mut invalid = request("replacement-secret");
        invalid.id = Some(created.id.clone());
        invalid.ssh_config = Some(password_ssh_config());
        invalid.ssh_config.as_mut().unwrap().endpoint.host.clear();

        assert!(service.update(invalid).is_err());
        assert_eq!(
            service.connection_request(&created.id).unwrap().password,
            "original-secret"
        );
    }

    #[test]
    fn profile_lifecycle_keeps_password_out_of_serialized_data() {
        let credentials = Arc::new(MemoryCredentialStore::default());
        let service = ConnectionProfileService::memory(Box::new(SharedMemoryCredentials(
            Arc::clone(&credentials),
        )))
        .unwrap();
        let created = service.create(request("super-secret-value")).unwrap();

        let json = serde_json::to_string(&created).unwrap();
        assert!(!json.contains("password"));
        assert!(!json.contains("super-secret-value"));
        assert_eq!(
            service.connection_request(&created.id).unwrap().password,
            "super-secret-value"
        );

        let mut edited_request = request("updated-secret-value");
        edited_request.id = Some(created.id.clone());
        edited_request.name = "Edited connection".to_owned();
        let edited = service.update(edited_request).unwrap();
        assert_eq!(edited.name, "Edited connection");
        assert_eq!(
            service.connection_request(&created.id).unwrap().password,
            "updated-secret-value"
        );
        let favorited = service.set_favorite(&created.id, true).unwrap();
        assert!(favorited.favorite);
        let renamed = service.rename(&created.id, "Renamed connection").unwrap();
        assert_eq!(renamed.name, "Renamed connection");

        let mut test_request = request("");
        test_request.id = Some(created.id.clone());
        test_request.password = None;
        assert_eq!(
            service.test_request(&test_request).unwrap().password,
            "updated-secret-value"
        );

        let duplicate = service.duplicate(&created.id).unwrap();
        assert_eq!(service.list().unwrap().len(), 2);
        service.delete(&created.id).unwrap();
        assert!(credentials.get(&created.credential_ref).is_err());
        assert!(service.connection_request(&created.id).is_err());
        assert_eq!(
            service.connection_request(&duplicate.id).unwrap().password,
            "updated-secret-value"
        );
    }

    #[test]
    fn password_is_not_written_to_sqlite() {
        let path = temporary_path("password.sqlite3");
        let service = ConnectionProfileService::open(
            path.clone(),
            Box::new(MemoryCredentialStore::default()),
        )
        .unwrap();
        service
            .create(request("database-must-not-contain-this"))
            .unwrap();
        drop(service);

        let bytes = fs::read(&path).unwrap();
        assert!(!String::from_utf8_lossy(&bytes).contains("database-must-not-contain-this"));
        remove_test_files(&path);
    }

    #[test]
    fn ssh_secrets_are_not_written_to_sqlite() {
        let path = temporary_path("ssh-secrets.sqlite3");
        let mut value = request("database-secret-not-in-sqlite");
        value.ssh_config = Some(password_ssh_config());
        value.ssh_password = Some("ssh-secret-not-in-sqlite".to_owned());
        value.ssh_jump_private_key_passphrase = Some("jump-secret-not-in-sqlite".to_owned());
        let service = ConnectionProfileService::open(
            path.clone(),
            Box::new(MemoryCredentialStore::default()),
        )
        .unwrap();
        service.create(value).unwrap();
        drop(service);

        let sqlite = String::from_utf8_lossy(&fs::read(&path).unwrap()).into_owned();
        assert!(!sqlite.contains("database-secret-not-in-sqlite"));
        assert!(!sqlite.contains("ssh-secret-not-in-sqlite"));
        assert!(!sqlite.contains("jump-secret-not-in-sqlite"));
        remove_test_files(&path);
    }

    #[test]
    fn migrates_a_version_one_database() {
        let path = temporary_path("migration.sqlite3");
        let connection = Connection::open(&path).unwrap();
        connection
            .execute_batch(
                "CREATE TABLE connection_profiles (
                    id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, host TEXT NOT NULL,
                    port INTEGER NOT NULL, database_name TEXT NOT NULL, username TEXT NOT NULL,
                    environment TEXT NOT NULL, ssl_mode TEXT NOT NULL, root_certificate_path TEXT,
                    ssh_config_json TEXT, credential_ref TEXT NOT NULL UNIQUE,
                    is_favorite INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL,
                    updated_at INTEGER NOT NULL
                ); PRAGMA user_version = 1;",
            )
            .unwrap();
        drop(connection);

        let repository = ProfileRepository::open(&path).unwrap();
        let version: i64 = repository
            .connection
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .unwrap();
        assert_eq!(version, CURRENT_SCHEMA_VERSION);
        drop(repository);
        remove_test_files(&path);
    }

    #[test]
    fn corrupt_database_is_backed_up_and_recreated() {
        let path = temporary_path("corrupt.sqlite3");
        fs::write(&path, b"not a sqlite database").unwrap();
        let service = ConnectionProfileService::open(
            path.clone(),
            Box::new(MemoryCredentialStore::default()),
        )
        .unwrap();
        assert!(service.list().unwrap().is_empty());

        let parent = path.parent().unwrap();
        let prefix = format!("{}.corrupt-", path.file_name().unwrap().to_string_lossy());
        assert!(
            fs::read_dir(parent)
                .unwrap()
                .filter_map(Result::ok)
                .any(|entry| entry.file_name().to_string_lossy().starts_with(&prefix))
        );
        drop(service);
        remove_test_files(&path);
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
