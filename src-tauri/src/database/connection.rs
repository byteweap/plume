use std::{error::Error, fs, time::Duration};

use native_tls::{Certificate, Identity, TlsConnector};
use postgres_native_tls::MakeTlsConnector;
use serde::{Deserialize, Serialize};
use tokio::time::Instant;
use tokio_postgres::{Client, Config, config::SslMode as PostgresSslMode};

use crate::error::DatabaseError;

const APPLICATION_NAME: &str = "plume";

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionTestRequest {
    pub host: String,
    pub port: u16,
    pub database: String,
    pub username: String,
    pub password: String,
    pub ssl_mode: SslMode,
    pub root_certificate_path: Option<String>,
    pub client_certificate_path: Option<String>,
    pub client_key_path: Option<String>,
    pub timeout_seconds: u64,
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum SslMode {
    Disable,
    Prefer,
    Require,
    VerifyCa,
    VerifyFull,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionTestResult {
    pub database: String,
    pub latency_ms: u128,
    pub server_version: String,
    pub transport: Transport,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Transport {
    Plain,
    Tls,
}

pub struct OpenConnection {
    pub client: Client,
    pub result: ConnectionTestResult,
}

pub async fn test(request: &ConnectionTestRequest) -> Result<ConnectionTestResult, DatabaseError> {
    let connection = open(request).await?;
    Ok(connection.result)
}

pub async fn open(request: &ConnectionTestRequest) -> Result<OpenConnection, DatabaseError> {
    validate(request)?;

    let started_at = Instant::now();
    let timeout = Duration::from_secs(request.timeout_seconds.clamp(1, 60));
    let config = build_config(request, timeout);

    let (client, transport) = match request.ssl_mode {
        SslMode::Disable => {
            let (client, connection) = config.connect(tokio_postgres::NoTls).await?;
            tauri::async_runtime::spawn(async move {
                if let Err(error) = connection.await {
                    eprintln!("PostgreSQL connection closed: {error}");
                }
            });
            (client, Transport::Plain)
        }
        ssl_mode => {
            let connector = build_tls_connector(request)?;
            let (client, connection) = config
                .connect(connector)
                .await
                .map_err(|error| classify_tls_connection_error(error, ssl_mode))?;
            tauri::async_runtime::spawn(async move {
                if let Err(error) = connection.await {
                    eprintln!("PostgreSQL TLS connection closed: {error}");
                }
            });
            let transport = detect_transport(&client).await?;
            (client, transport)
        }
    };

    let row = client
        .query_one(
            "SELECT current_database(), current_setting('server_version')",
            &[],
        )
        .await?;

    Ok(OpenConnection {
        client,
        result: ConnectionTestResult {
            database: row.get(0),
            latency_ms: started_at.elapsed().as_millis(),
            server_version: row.get(1),
            transport,
        },
    })
}

impl ConnectionTestRequest {
    pub fn for_database(&self, database: &str) -> Self {
        let mut request = self.clone();
        request.database = database.to_owned();
        request
    }
}

fn validate(request: &ConnectionTestRequest) -> Result<(), DatabaseError> {
    if request.host.trim().is_empty()
        || request.database.trim().is_empty()
        || request.username.trim().is_empty()
    {
        return Err(DatabaseError::InvalidConfiguration(
            "Host, database, and username are required.".to_owned(),
        ));
    }

    if matches!(request.ssl_mode, SslMode::VerifyCa | SslMode::VerifyFull)
        && request
            .root_certificate_path
            .as_deref()
            .unwrap_or("")
            .is_empty()
    {
        return Err(DatabaseError::InvalidConfiguration(
            "A root certificate is required for the selected SSL mode.".to_owned(),
        ));
    }

    let client_certificate = clean_path(request.client_certificate_path.as_deref());
    let client_key = clean_path(request.client_key_path.as_deref());
    if client_certificate.is_some() != client_key.is_some() {
        return Err(DatabaseError::InvalidConfiguration(
            "Client certificate and private key paths must be provided together.".to_owned(),
        ));
    }
    if matches!(request.ssl_mode, SslMode::Disable) && client_certificate.is_some() {
        return Err(DatabaseError::InvalidConfiguration(
            "Client certificates require an SSL connection mode.".to_owned(),
        ));
    }

    Ok(())
}

fn build_config(request: &ConnectionTestRequest, timeout: Duration) -> Config {
    let mut config = Config::new();
    config
        .host(&request.host)
        .port(request.port)
        .dbname(&request.database)
        .user(&request.username)
        .password(&request.password)
        .application_name(APPLICATION_NAME)
        .connect_timeout(timeout)
        .ssl_mode(match request.ssl_mode {
            SslMode::Disable => PostgresSslMode::Disable,
            SslMode::Prefer => PostgresSslMode::Prefer,
            SslMode::Require | SslMode::VerifyCa | SslMode::VerifyFull => PostgresSslMode::Require,
        });
    config
}

fn build_tls_connector(request: &ConnectionTestRequest) -> Result<MakeTlsConnector, DatabaseError> {
    let mut builder = TlsConnector::builder();

    match request.ssl_mode {
        SslMode::Prefer | SslMode::Require => {
            builder.danger_accept_invalid_certs(true);
            builder.danger_accept_invalid_hostnames(true);
        }
        SslMode::VerifyCa => {
            builder.danger_accept_invalid_hostnames(true);
            add_root_certificates(&mut builder, request.root_certificate_path.as_deref())?;
        }
        SslMode::VerifyFull => {
            add_root_certificates(&mut builder, request.root_certificate_path.as_deref())?;
        }
        SslMode::Disable => unreachable!("TLS connector is not built for disabled SSL"),
    }

    if let (Some(certificate_path), Some(key_path)) = (
        clean_path(request.client_certificate_path.as_deref()),
        clean_path(request.client_key_path.as_deref()),
    ) {
        builder.identity(load_client_identity(certificate_path, key_path)?);
    }

    let connector = builder
        .build()
        .map_err(|error| DatabaseError::TlsHandshake(error.to_string()))?;
    Ok(MakeTlsConnector::new(connector))
}

fn add_root_certificates(
    builder: &mut native_tls::TlsConnectorBuilder,
    path: Option<&str>,
) -> Result<(), DatabaseError> {
    let path = path.ok_or_else(|| {
        DatabaseError::InvalidConfiguration("Root certificate path is missing.".to_owned())
    })?;
    let pem = read_certificate_file(path, "root certificate")?;
    let certificates =
        Certificate::stack_from_pem(&pem).map_err(|error| DatabaseError::InvalidCertificate {
            path: path.to_owned(),
            reason: error.to_string(),
        })?;
    if certificates.is_empty() {
        return Err(DatabaseError::InvalidCertificate {
            path: path.to_owned(),
            reason: "the file does not contain a PEM certificate".to_owned(),
        });
    }
    for certificate in certificates {
        builder.add_root_certificate(certificate);
    }
    Ok(())
}

fn load_client_identity(certificate_path: &str, key_path: &str) -> Result<Identity, DatabaseError> {
    let certificate = read_certificate_file(certificate_path, "client certificate")?;
    let key = read_certificate_file(key_path, "client private key")?;
    Identity::from_pkcs8(&certificate, &key).map_err(|error| DatabaseError::InvalidCertificate {
        path: certificate_path.to_owned(),
        reason: format!("the client certificate or PKCS#8 private key is invalid: {error}"),
    })
}

fn read_certificate_file(path: &str, kind: &'static str) -> Result<Vec<u8>, DatabaseError> {
    fs::read(path).map_err(|source| DatabaseError::CertificateFile {
        path: path.to_owned(),
        kind,
        source,
    })
}

fn clean_path(path: Option<&str>) -> Option<&str> {
    path.map(str::trim).filter(|path| !path.is_empty())
}

async fn detect_transport(client: &Client) -> Result<Transport, DatabaseError> {
    let row = client
        .query_one(
            "SELECT ssl FROM pg_catalog.pg_stat_ssl WHERE pid = pg_catalog.pg_backend_pid()",
            &[],
        )
        .await?;
    Ok(if row.get(0) {
        Transport::Tls
    } else {
        Transport::Plain
    })
}

fn classify_tls_connection_error(error: tokio_postgres::Error, ssl_mode: SslMode) -> DatabaseError {
    if error.as_db_error().is_some() {
        return DatabaseError::Postgres(error);
    }
    let details = error_chain(&error);
    let normalized = details.to_ascii_lowercase();
    if matches!(ssl_mode, SslMode::VerifyFull)
        && (normalized.contains("hostname")
            || normalized.contains("host name mismatch")
            || normalized.contains("not valid for name")
            || normalized.contains("does not match")
            || normalized.contains("doesn't match"))
    {
        DatabaseError::HostnameMismatch(details)
    } else {
        DatabaseError::TlsHandshake(details)
    }
}

fn error_chain(error: &dyn Error) -> String {
    let mut messages = vec![error.to_string()];
    let mut source = error.source();
    while let Some(error) = source {
        messages.push(error.to_string());
        source = error.source();
    }
    messages.join(": ")
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::{ConnectionTestRequest, SslMode, Transport, test, validate};
    use crate::database::test_support;

    fn request(ssl_mode: SslMode) -> ConnectionTestRequest {
        ConnectionTestRequest {
            host: "localhost".to_owned(),
            port: 5432,
            database: "postgres".to_owned(),
            username: "postgres".to_owned(),
            password: String::new(),
            ssl_mode,
            root_certificate_path: None,
            client_certificate_path: None,
            client_key_path: None,
            timeout_seconds: 10,
        }
    }

    #[test]
    fn deserializes_the_frontend_contract() {
        let value = json!({
            "host": "localhost",
            "port": 5432,
            "database": "postgres",
            "username": "postgres",
            "password": "",
            "sslMode": "verify-full",
            "rootCertificatePath": "/tmp/root.crt",
            "clientCertificatePath": "/tmp/client.crt",
            "clientKeyPath": "/tmp/client.key",
            "timeoutSeconds": 10
        });

        let parsed: ConnectionTestRequest =
            serde_json::from_value(value).expect("frontend request should deserialize");

        assert!(matches!(parsed.ssl_mode, SslMode::VerifyFull));
        assert_eq!(
            parsed.root_certificate_path.as_deref(),
            Some("/tmp/root.crt")
        );
        assert_eq!(parsed.client_key_path.as_deref(), Some("/tmp/client.key"));
    }

    #[test]
    fn verified_tls_requires_a_root_certificate() {
        let error = validate(&request(SslMode::VerifyCa))
            .expect_err("verify-ca without a certificate should fail");

        assert!(error.to_string().contains("root certificate"));
    }

    #[test]
    fn direct_connection_configuration_is_valid() {
        validate(&request(SslMode::Disable)).expect("direct connection should be valid");
    }

    #[test]
    fn client_certificate_and_key_are_required_as_a_pair() {
        let mut value = request(SslMode::Require);
        value.client_certificate_path = Some("/tmp/client.crt".to_owned());
        let error = validate(&value).expect_err("a certificate without its key should fail");

        assert!(error.to_string().contains("provided together"));
    }

    #[test]
    #[ignore = "requires the local PostgreSQL integration environment"]
    fn connects_to_real_postgres_and_reports_server_metadata() {
        tauri::async_runtime::block_on(async {
            let request = test_support::connection_request();
            let result = test(&request)
                .await
                .expect("integration test connection should succeed");

            assert_eq!(result.database, request.database);
            assert!(!result.server_version.is_empty());
            assert!(matches!(result.transport, Transport::Plain));
        });
    }

    #[test]
    #[ignore = "requires the local PostgreSQL TLS integration environment"]
    fn ssl_modes_enforce_transport_and_certificate_validation() {
        tauri::async_runtime::block_on(async {
            let mut prefer = test_support::connection_request();
            prefer.ssl_mode = SslMode::Prefer;
            let result = test(&prefer)
                .await
                .expect("prefer should fall back for a server without TLS");
            assert!(matches!(result.transport, Transport::Plain));

            let require = test_support::tls_connection_request();
            let mut prefer_tls = require.clone();
            prefer_tls.ssl_mode = SslMode::Prefer;
            let result = test(&prefer_tls)
                .await
                .expect("prefer should negotiate TLS when the server supports it");
            assert!(matches!(result.transport, Transport::Tls));

            let result = test(&require)
                .await
                .expect("require should connect without certificate validation");
            assert!(matches!(result.transport, Transport::Tls));

            let mut verify_ca = require.clone();
            verify_ca.ssl_mode = SslMode::VerifyCa;
            verify_ca.root_certificate_path = Some(test_support::tls_certificate_path("ca.crt"));
            let result = test(&verify_ca)
                .await
                .expect("verify-ca should trust the configured CA");
            assert!(matches!(result.transport, Transport::Tls));

            let mut verify_full = verify_ca.clone();
            verify_full.ssl_mode = SslMode::VerifyFull;
            let result = test(&verify_full)
                .await
                .expect("verify-full should accept the localhost certificate");
            assert!(matches!(result.transport, Transport::Tls));

            verify_full.host = "127.0.0.1".to_owned();
            let error = test(&verify_full)
                .await
                .expect_err("verify-full must reject a hostname mismatch");
            assert!(
                matches!(&error, crate::error::DatabaseError::HostnameMismatch(_)),
                "unexpected hostname error: {error:?}"
            );

            verify_ca.root_certificate_path =
                Some(test_support::tls_certificate_path("untrusted-ca.crt"));
            let error = test(&verify_ca)
                .await
                .expect_err("verify-ca must reject an untrusted server certificate");
            assert!(matches!(
                error,
                crate::error::DatabaseError::TlsHandshake(_)
            ));
        });
    }

    #[test]
    #[ignore = "requires the local PostgreSQL TLS integration environment"]
    fn connects_with_a_pem_client_certificate() {
        tauri::async_runtime::block_on(async {
            let mut request = test_support::tls_connection_request();
            request.username = "plume_client".to_owned();
            request.password.clear();
            request.ssl_mode = SslMode::VerifyFull;
            request.root_certificate_path = Some(test_support::tls_certificate_path("ca.crt"));
            request.client_certificate_path =
                Some(test_support::tls_certificate_path("client.crt"));
            request.client_key_path = Some(test_support::tls_certificate_path("client.key"));

            let result = test(&request)
                .await
                .expect("client certificate authentication should succeed");
            assert!(matches!(result.transport, Transport::Tls));
        });
    }
}
