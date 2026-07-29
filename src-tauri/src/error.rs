use serde::Serialize;
use thiserror::Error;

use crate::profiles::ProfileError;

#[derive(Debug, Error)]
pub enum DatabaseError {
    #[error("The connection configuration is invalid: {0}")]
    InvalidConfiguration(String),
    #[error("Unable to read {kind} file '{path}': {source}")]
    CertificateFile {
        path: String,
        kind: &'static str,
        #[source]
        source: std::io::Error,
    },
    #[error("The certificate file '{path}' is invalid: {reason}")]
    InvalidCertificate { path: String, reason: String },
    #[error("The server certificate does not match the requested host: {0}")]
    HostnameMismatch(String),
    #[error("The TLS handshake failed: {0}")]
    TlsHandshake(String),
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
            DatabaseError::CertificateFile { ref source, .. } => Self {
                code: if source.kind() == std::io::ErrorKind::NotFound {
                    "certificate_missing"
                } else {
                    "certificate_unreadable"
                },
                message: "A configured certificate or private-key file could not be read."
                    .to_owned(),
                detail: Some(error.to_string()),
            },
            DatabaseError::InvalidCertificate { .. } => Self {
                code: "certificate_invalid",
                message: "A configured certificate or private key is invalid.".to_owned(),
                detail: Some(error.to_string()),
            },
            DatabaseError::HostnameMismatch(_) => Self {
                code: "hostname_mismatch",
                message: "The server certificate does not match the requested host.".to_owned(),
                detail: Some(error.to_string()),
            },
            DatabaseError::TlsHandshake(_) => Self {
                code: "tls_handshake_failed",
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
    use std::io;

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

    #[test]
    fn tls_errors_have_distinct_stable_codes() {
        let cases = [
            (
                DatabaseError::CertificateFile {
                    path: "/missing/ca.crt".to_owned(),
                    kind: "root certificate",
                    source: io::Error::new(io::ErrorKind::NotFound, "missing"),
                },
                "certificate_missing",
            ),
            (
                DatabaseError::InvalidCertificate {
                    path: "/tmp/ca.crt".to_owned(),
                    reason: "invalid PEM".to_owned(),
                },
                "certificate_invalid",
            ),
            (
                DatabaseError::HostnameMismatch("mismatch".to_owned()),
                "hostname_mismatch",
            ),
            (
                DatabaseError::TlsHandshake("handshake".to_owned()),
                "tls_handshake_failed",
            ),
        ];

        for (error, expected_code) in cases {
            let json = serde_json::to_value(CommandError::from(error))
                .expect("command error should serialize");
            assert_eq!(json["code"], expected_code);
        }
    }
}
