use serde::Serialize;
use thiserror::Error;

use crate::profiles::ProfileError;

#[derive(Debug, Error)]
pub enum DatabaseError {
    #[error("The connection configuration is invalid: {0}")]
    InvalidConfiguration(String),
    #[error("Unable to read certificate file '{path}': {source}")]
    CertificateFile {
        path: String,
        #[source]
        source: std::io::Error,
    },
    #[error("TLS configuration failed: {0}")]
    Tls(String),
    #[error("The database session '{0}' is no longer available.")]
    SessionNotFound(String),
    #[error("PostgreSQL returned an unsupported metadata kind: {0}")]
    UnexpectedMetadata(String),
    #[error(transparent)]
    Postgres(#[from] tokio_postgres::Error),
}

#[derive(Debug, Serialize)]
pub struct CommandError {
    code: &'static str,
    message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    detail: Option<String>,
}

impl From<DatabaseError> for CommandError {
    fn from(error: DatabaseError) -> Self {
        match error {
            DatabaseError::InvalidConfiguration(message) => Self {
                code: "invalid_configuration",
                message,
                detail: None,
            },
            DatabaseError::CertificateFile { .. } => Self {
                code: "certificate_error",
                message: "The root certificate could not be read.".to_owned(),
                detail: Some(error.to_string()),
            },
            DatabaseError::Tls(_) => Self {
                code: "tls_error",
                message: "The secure connection could not be established.".to_owned(),
                detail: Some(error.to_string()),
            },
            DatabaseError::SessionNotFound(_) => Self {
                code: "session_not_found",
                message: "The database connection is no longer available. Reconnect and try again."
                    .to_owned(),
                detail: None,
            },
            DatabaseError::UnexpectedMetadata(_) => Self {
                code: "metadata_error",
                message: "Plume could not understand the PostgreSQL object metadata.".to_owned(),
                detail: Some(error.to_string()),
            },
            DatabaseError::Postgres(ref postgres_error) => {
                let code = classify_postgres_error(postgres_error);
                let message = match code {
                    "authentication_failed" => "PostgreSQL rejected the username or password.",
                    "database_not_found" => "The requested PostgreSQL database does not exist.",
                    "connection_failed" => "Plume could not reach the PostgreSQL server.",
                    _ => "The PostgreSQL connection test failed.",
                };
                Self {
                    code,
                    message: message.to_owned(),
                    detail: Some(error.to_string()),
                }
            }
        }
    }
}

impl From<ProfileError> for CommandError {
    fn from(error: ProfileError) -> Self {
        match error {
            ProfileError::NotFound(_) => Self {
                code: "profile_not_found",
                message: "The saved connection no longer exists.".to_owned(),
                detail: None,
            },
            ProfileError::Invalid(ref message) => Self {
                code: "invalid_profile",
                message: message.clone(),
                detail: None,
            },
            ProfileError::Credential(_) => Self {
                code: "credential_error",
                message: "The password could not be accessed in the system credential store."
                    .to_owned(),
                detail: Some(error.to_string()),
            },
            ProfileError::UnsupportedSchema(_) => Self {
                code: "storage_version_error",
                message: "This Plume version cannot read the local profile database.".to_owned(),
                detail: Some(error.to_string()),
            },
            ProfileError::Storage(_) | ProfileError::Directory(_) | ProfileError::Lock => Self {
                code: "storage_error",
                message: "Plume could not update the local connection profiles.".to_owned(),
                detail: Some(error.to_string()),
            },
        }
    }
}

fn classify_postgres_error(error: &tokio_postgres::Error) -> &'static str {
    match error.as_db_error().map(|db_error| db_error.code().code()) {
        Some("28P01" | "28000") => "authentication_failed",
        Some("3D000") => "database_not_found",
        Some(_) => "postgres_error",
        None if error.is_closed() => "connection_failed",
        None => "connection_failed",
    }
}

#[cfg(test)]
mod tests {
    use super::{CommandError, DatabaseError};

    #[test]
    fn configuration_errors_are_stable_and_safe() {
        let error = CommandError::from(DatabaseError::InvalidConfiguration(
            "Host is required.".to_owned(),
        ));
        let json = serde_json::to_value(error).expect("command error should serialize");

        assert_eq!(json["code"], "invalid_configuration");
        assert_eq!(json["message"], "Host is required.");
        assert!(json.get("detail").is_none());
    }
}
