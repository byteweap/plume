use std::{fs, time::Duration};

use native_tls::{Certificate, TlsConnector};
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
    pub timeout_seconds: u64,
}

#[derive(Debug, Clone, Copy, Deserialize)]
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
            let connector =
                build_tls_connector(ssl_mode, request.root_certificate_path.as_deref())?;
            let (client, connection) = config.connect(connector).await?;
            tauri::async_runtime::spawn(async move {
                if let Err(error) = connection.await {
                    eprintln!("PostgreSQL TLS connection closed: {error}");
                }
            });
            (client, Transport::Tls)
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

fn build_tls_connector(
    ssl_mode: SslMode,
    root_certificate_path: Option<&str>,
) -> Result<MakeTlsConnector, DatabaseError> {
    let mut builder = TlsConnector::builder();

    match ssl_mode {
        SslMode::Prefer | SslMode::Require => {
            builder.danger_accept_invalid_certs(true);
            builder.danger_accept_invalid_hostnames(true);
        }
        SslMode::VerifyCa => {
            builder.danger_accept_invalid_hostnames(true);
            add_root_certificate(&mut builder, root_certificate_path)?;
        }
        SslMode::VerifyFull => {
            add_root_certificate(&mut builder, root_certificate_path)?;
        }
        SslMode::Disable => unreachable!("TLS connector is not built for disabled SSL"),
    }

    let connector = builder
        .build()
        .map_err(|error| DatabaseError::Tls(error.to_string()))?;
    Ok(MakeTlsConnector::new(connector))
}

fn add_root_certificate(
    builder: &mut native_tls::TlsConnectorBuilder,
    path: Option<&str>,
) -> Result<(), DatabaseError> {
    let path = path.ok_or_else(|| {
        DatabaseError::InvalidConfiguration("Root certificate path is missing.".to_owned())
    })?;
    let pem = fs::read(path).map_err(|error| DatabaseError::CertificateFile {
        path: path.to_owned(),
        source: error,
    })?;
    let certificate =
        Certificate::from_pem(&pem).map_err(|error| DatabaseError::Tls(error.to_string()))?;
    builder.add_root_certificate(certificate);
    Ok(())
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::{ConnectionTestRequest, SslMode, validate};

    fn request(ssl_mode: SslMode) -> ConnectionTestRequest {
        ConnectionTestRequest {
            host: "localhost".to_owned(),
            port: 5432,
            database: "postgres".to_owned(),
            username: "postgres".to_owned(),
            password: String::new(),
            ssl_mode,
            root_certificate_path: None,
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
            "timeoutSeconds": 10
        });

        let parsed: ConnectionTestRequest =
            serde_json::from_value(value).expect("frontend request should deserialize");

        assert!(matches!(parsed.ssl_mode, SslMode::VerifyFull));
        assert_eq!(
            parsed.root_certificate_path.as_deref(),
            Some("/tmp/root.crt")
        );
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
}
