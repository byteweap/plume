use serde::Serialize;
use thiserror::Error;
use tokio_postgres::error::ErrorPosition;

use crate::{
    database::query::QueryError, drafts::DraftError, exports::ExportError, profiles::ProfileError,
};

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
    #[error("The SSH configuration is invalid: {0}")]
    SshConfiguration(String),
    #[error("The SSH host key is unknown.")]
    SshUnknownHostKey,
    #[error("The SSH host key does not match the known_hosts entry.")]
    SshHostKeyMismatch,
    #[error("The SSH known_hosts file could not be checked: {0}")]
    SshKnownHosts(String),
    #[error("The SSH server rejected the configured credentials.")]
    SshAuthentication,
    #[error("The SSH private key '{path}' is invalid: {reason}")]
    SshPrivateKey { path: String, reason: String },
    #[error("The SSH connection failed: {0}")]
    SshConnection(String),
    #[error("The SSH port forward failed: {0}")]
    SshForward(String),
    #[error("The SSH tunnel is no longer available.")]
    SshDisconnected,
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
    #[serde(skip_serializing_if = "Option::is_none")]
    diagnostic: Option<Box<QueryDiagnostic>>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct QueryDiagnostic {
    sql_state: String,
    severity: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    hint: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    position: Option<u32>,
}

impl From<DatabaseError> for CommandError {
    fn from(error: DatabaseError) -> Self {
        match error {
            DatabaseError::InvalidConfiguration(message) => Self {
                code: "invalid_configuration",
                message,
                detail: None,
                diagnostic: None,
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
                diagnostic: None,
            },
            DatabaseError::InvalidCertificate { .. } => Self {
                code: "certificate_invalid",
                message: "A configured certificate or private key is invalid.".to_owned(),
                detail: Some(error.to_string()),
                diagnostic: None,
            },
            DatabaseError::HostnameMismatch(_) => Self {
                code: "hostname_mismatch",
                message: "The server certificate does not match the requested host.".to_owned(),
                detail: Some(error.to_string()),
                diagnostic: None,
            },
            DatabaseError::TlsHandshake(_) => Self {
                code: "tls_handshake_failed",
                message: "The secure connection could not be established.".to_owned(),
                detail: Some(error.to_string()),
                diagnostic: None,
            },
            DatabaseError::SshConfiguration(message) => Self {
                code: "ssh_invalid_configuration",
                message,
                detail: None,
                diagnostic: None,
            },
            DatabaseError::SshUnknownHostKey => Self {
                code: "ssh_unknown_host_key",
                message: "The SSH server is not trusted by the configured known_hosts file."
                    .to_owned(),
                detail: None,
                diagnostic: None,
            },
            DatabaseError::SshHostKeyMismatch => Self {
                code: "ssh_host_key_mismatch",
                message: "The SSH server host key has changed.".to_owned(),
                detail: None,
                diagnostic: None,
            },
            DatabaseError::SshKnownHosts(_) => Self {
                code: "ssh_known_hosts_error",
                message: "The SSH known_hosts file could not be checked.".to_owned(),
                detail: Some(error.to_string()),
                diagnostic: None,
            },
            DatabaseError::SshAuthentication => Self {
                code: "ssh_authentication_failed",
                message: "The SSH server rejected the configured credentials.".to_owned(),
                detail: None,
                diagnostic: None,
            },
            DatabaseError::SshPrivateKey { .. } => Self {
                code: "ssh_private_key_error",
                message: "The SSH private key could not be loaded.".to_owned(),
                detail: Some(error.to_string()),
                diagnostic: None,
            },
            DatabaseError::SshConnection(_) => Self {
                code: "ssh_connection_failed",
                message: "Plume could not establish the SSH connection.".to_owned(),
                detail: Some(error.to_string()),
                diagnostic: None,
            },
            DatabaseError::SshForward(_) => Self {
                code: "ssh_forward_failed",
                message: "The SSH server could not forward the database connection.".to_owned(),
                detail: Some(error.to_string()),
                diagnostic: None,
            },
            DatabaseError::SshDisconnected => Self {
                code: "ssh_tunnel_disconnected",
                message: "The SSH tunnel is no longer available. Reconnect and try again."
                    .to_owned(),
                detail: None,
                diagnostic: None,
            },
            DatabaseError::SessionNotFound(_) => Self {
                code: "session_not_found",
                message: "The database connection is no longer available. Reconnect and try again."
                    .to_owned(),
                detail: None,
                diagnostic: None,
            },
            DatabaseError::UnexpectedMetadata(_) => Self {
                code: "metadata_error",
                message: "Plume could not understand the PostgreSQL object metadata.".to_owned(),
                detail: Some(error.to_string()),
                diagnostic: None,
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
                    diagnostic: None,
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
                diagnostic: None,
            },
            ProfileError::Invalid(ref message) => Self {
                code: "invalid_profile",
                message: message.clone(),
                detail: None,
                diagnostic: None,
            },
            ProfileError::Credential(_) => Self {
                code: "credential_error",
                message: "The password could not be accessed in the system credential store."
                    .to_owned(),
                detail: Some(error.to_string()),
                diagnostic: None,
            },
            ProfileError::UnsupportedSchema(_) => Self {
                code: "storage_version_error",
                message: "This Plume version cannot read the local profile database.".to_owned(),
                detail: Some(error.to_string()),
                diagnostic: None,
            },
            ProfileError::Storage(_) | ProfileError::Directory(_) | ProfileError::Lock => Self {
                code: "storage_error",
                message: "Plume could not update the local connection profiles.".to_owned(),
                detail: Some(error.to_string()),
                diagnostic: None,
            },
        }
    }
}

impl From<DraftError> for CommandError {
    fn from(error: DraftError) -> Self {
        match error {
            DraftError::Invalid(ref message) => Self {
                code: "invalid_draft",
                message: message.clone(),
                detail: None,
                diagnostic: None,
            },
            DraftError::ProfileNotFound(_) => Self {
                code: "profile_not_found",
                message: "The saved connection for this query draft no longer exists.".to_owned(),
                detail: None,
                diagnostic: None,
            },
            DraftError::Storage(_) | DraftError::Lock => Self {
                code: "storage_error",
                message: "Plume could not update the local query drafts.".to_owned(),
                detail: Some(error.to_string()),
                diagnostic: None,
            },
        }
    }
}

impl From<QueryError> for CommandError {
    fn from(error: QueryError) -> Self {
        match error {
            QueryError::Invalid(message) => Self {
                code: "invalid_query",
                message,
                detail: None,
                diagnostic: None,
            },
            QueryError::AlreadyRunning(_) => Self {
                code: "query_already_running",
                message: "This query is already running.".to_owned(),
                detail: None,
                diagnostic: None,
            },
            QueryError::Cancelled => Self {
                code: "query_cancelled",
                message: "The query was cancelled by PostgreSQL.".to_owned(),
                detail: None,
                diagnostic: None,
            },
            QueryError::CancellationFailed(_) => Self {
                code: "query_cancellation_failed",
                message:
                    "The cancellation request could not be sent. The query may still be running."
                        .to_owned(),
                detail: Some(error.to_string()),
                diagnostic: None,
            },
            QueryError::Database(error) => Self::from(error),
            QueryError::Postgres(ref postgres_error) => {
                if let Some(database_error) = postgres_error.as_db_error() {
                    Self {
                        code: "query_failed",
                        message: database_error.message().to_owned(),
                        detail: database_error.detail().map(str::to_owned),
                        diagnostic: Some(Box::new(QueryDiagnostic {
                            sql_state: database_error.code().code().to_owned(),
                            severity: database_error.severity().to_owned(),
                            hint: database_error.hint().map(str::to_owned),
                            position: match database_error.position() {
                                Some(ErrorPosition::Original(position)) => Some(*position),
                                Some(ErrorPosition::Internal { .. }) | None => None,
                            },
                        })),
                    }
                } else {
                    Self {
                        code: if postgres_error.is_closed() {
                            "connection_failed"
                        } else {
                            "query_failed"
                        },
                        message: if postgres_error.is_closed() {
                            "The PostgreSQL connection closed while executing the query."
                        } else {
                            "PostgreSQL could not execute the query."
                        }
                        .to_owned(),
                        detail: Some(error.to_string()),
                        diagnostic: None,
                    }
                }
            }
        }
    }
}

impl From<ExportError> for CommandError {
    fn from(error: ExportError) -> Self {
        match error {
            ExportError::Invalid(message) => Self {
                code: "invalid_export",
                message,
                detail: None,
                diagnostic: None,
            },
            ExportError::AlreadyRunning(_) => Self {
                code: "export_already_running",
                message: "This export is already running.".to_owned(),
                detail: None,
                diagnostic: None,
            },
            ExportError::Lock => Self {
                code: "export_unavailable",
                message: "The export task service is unavailable.".to_owned(),
                detail: Some(error.to_string()),
                diagnostic: None,
            },
            ExportError::DialogPath(_) => Self {
                code: "export_path_invalid",
                message: "The selected export location is invalid.".to_owned(),
                detail: Some(error.to_string()),
                diagnostic: None,
            },
            ExportError::Io(_) => Self {
                code: "export_write_failed",
                message: "The CSV export could not be written.".to_owned(),
                detail: Some(error.to_string()),
                diagnostic: None,
            },
            ExportError::Progress(_) | ExportError::Worker(_) => Self {
                code: "export_failed",
                message: "The CSV export could not be completed.".to_owned(),
                detail: Some(error.to_string()),
                diagnostic: None,
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
    use crate::{database::query::QueryError, exports::ExportError};

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
    fn export_errors_have_stable_codes() {
        let invalid = serde_json::to_value(CommandError::from(ExportError::Invalid(
            "bad CSV shape".to_owned(),
        )))
        .unwrap();
        assert_eq!(invalid["code"], "invalid_export");
        assert!(invalid.get("detail").is_none());

        let write = serde_json::to_value(CommandError::from(ExportError::Io(io::Error::new(
            io::ErrorKind::PermissionDenied,
            "denied",
        ))))
        .unwrap();
        assert_eq!(write["code"], "export_write_failed");
        assert_eq!(write["message"], "The CSV export could not be written.");
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

    #[test]
    fn ssh_errors_have_distinct_stable_codes() {
        let cases = [
            (
                DatabaseError::SshConfiguration("missing host".to_owned()),
                "ssh_invalid_configuration",
            ),
            (DatabaseError::SshUnknownHostKey, "ssh_unknown_host_key"),
            (DatabaseError::SshHostKeyMismatch, "ssh_host_key_mismatch"),
            (
                DatabaseError::SshKnownHosts("unreadable".to_owned()),
                "ssh_known_hosts_error",
            ),
            (
                DatabaseError::SshAuthentication,
                "ssh_authentication_failed",
            ),
            (
                DatabaseError::SshPrivateKey {
                    path: "/tmp/id_ed25519".to_owned(),
                    reason: "invalid".to_owned(),
                },
                "ssh_private_key_error",
            ),
            (
                DatabaseError::SshConnection("refused".to_owned()),
                "ssh_connection_failed",
            ),
            (
                DatabaseError::SshForward("denied".to_owned()),
                "ssh_forward_failed",
            ),
            (DatabaseError::SshDisconnected, "ssh_tunnel_disconnected"),
        ];

        for (error, expected_code) in cases {
            let json = serde_json::to_value(CommandError::from(error))
                .expect("command error should serialize");
            assert_eq!(json["code"], expected_code);
        }
    }

    #[test]
    fn query_request_errors_have_stable_codes() {
        let cases = [
            (
                QueryError::Invalid("SQL is required.".to_owned()),
                "invalid_query",
            ),
            (
                QueryError::AlreadyRunning("query-1".to_owned()),
                "query_already_running",
            ),
            (QueryError::Cancelled, "query_cancelled"),
        ];

        for (error, expected_code) in cases {
            let json = serde_json::to_value(CommandError::from(error))
                .expect("command error should serialize");
            assert_eq!(json["code"], expected_code);
            assert!(json.get("detail").is_none());
        }

        let cancellation_failure = serde_json::to_value(CommandError::from(
            QueryError::CancellationFailed("connection refused".to_owned()),
        ))
        .expect("cancellation error should serialize");
        assert_eq!(cancellation_failure["code"], "query_cancellation_failed");
        assert!(cancellation_failure.get("detail").is_some());
    }

    #[test]
    #[ignore = "requires the local PostgreSQL integration environment"]
    fn query_errors_include_structured_postgres_diagnostics() {
        tauri::async_runtime::block_on(async {
            let client = crate::database::test_support::connect().await;
            let syntax_error = client
                .simple_query("SELECT '😀', FROM;")
                .await
                .expect_err("invalid SQL should return a PostgreSQL error");
            let syntax_json =
                serde_json::to_value(CommandError::from(QueryError::Postgres(syntax_error)))
                    .unwrap();

            assert_eq!(syntax_json["code"], "query_failed");
            assert_eq!(syntax_json["diagnostic"]["sqlState"], "42601");
            assert_eq!(syntax_json["diagnostic"]["severity"], "ERROR");
            assert_eq!(syntax_json["diagnostic"]["position"], 13);

            let raised_error = client
                .simple_query(
                    "DO $$ BEGIN RAISE EXCEPTION 'boom' USING \
                     DETAIL = 'row detail', HINT = 'check input'; END $$;",
                )
                .await
                .expect_err("raised exception should return PostgreSQL detail fields");
            let raised_json =
                serde_json::to_value(CommandError::from(QueryError::Postgres(raised_error)))
                    .unwrap();

            assert_eq!(raised_json["detail"], "row detail");
            assert_eq!(raised_json["diagnostic"]["hint"], "check input");
        });
    }
}
