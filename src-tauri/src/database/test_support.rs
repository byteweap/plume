use tokio_postgres::{Client, Config, NoTls, config::Host};

use crate::database::connection::{ConnectionTestRequest, SslMode};

pub const TEST_DATABASE_CONFIG_ENV: &str = "PLUME_TEST_DATABASE_CONFIG";
pub const TEST_SECONDARY_DATABASE_ENV: &str = "PLUME_TEST_SECONDARY_DATABASE";
pub const TEST_TLS_DATABASE_CONFIG_ENV: &str = "PLUME_TEST_TLS_DATABASE_CONFIG";
pub const TEST_TLS_CERTIFICATE_DIR_ENV: &str = "PLUME_TEST_TLS_CERTIFICATE_DIR";

pub fn config() -> Config {
    std::env::var(TEST_DATABASE_CONFIG_ENV)
        .unwrap_or_else(|_| panic!("{TEST_DATABASE_CONFIG_ENV} must contain a PostgreSQL URL"))
        .parse()
        .expect("integration test database config should be valid")
}

pub fn connection_request() -> ConnectionTestRequest {
    request_from_config(config(), SslMode::Disable)
}

pub fn tls_connection_request() -> ConnectionTestRequest {
    let config = std::env::var(TEST_TLS_DATABASE_CONFIG_ENV)
        .unwrap_or_else(|_| panic!("{TEST_TLS_DATABASE_CONFIG_ENV} must contain a PostgreSQL URL"))
        .parse()
        .expect("TLS integration test database config should be valid");
    request_from_config(config, SslMode::Require)
}

pub fn tls_certificate_path(file_name: &str) -> String {
    std::path::Path::new(
        &std::env::var(TEST_TLS_CERTIFICATE_DIR_ENV)
            .unwrap_or_else(|_| panic!("{TEST_TLS_CERTIFICATE_DIR_ENV} must be set")),
    )
    .join(file_name)
    .to_string_lossy()
    .into_owned()
}

fn request_from_config(config: Config, ssl_mode: SslMode) -> ConnectionTestRequest {
    let host = match config.get_hosts().first() {
        Some(Host::Tcp(host)) => host.clone(),
        _ => panic!("integration tests require a TCP PostgreSQL host"),
    };
    let port = config.get_ports().first().copied().unwrap_or(5432);
    let username = config
        .get_user()
        .expect("integration test config requires a username")
        .to_owned();
    let password = config
        .get_password()
        .map(|password| String::from_utf8_lossy(password).into_owned())
        .unwrap_or_default();
    let database = config
        .get_dbname()
        .expect("integration test config requires a database")
        .to_owned();

    ConnectionTestRequest {
        host,
        port,
        database,
        username,
        password,
        ssl_mode,
        root_certificate_path: None,
        client_certificate_path: None,
        client_key_path: None,
        timeout_seconds: 10,
    }
}

pub async fn connect() -> Client {
    let (client, connection) = config()
        .connect(NoTls)
        .await
        .expect("integration test PostgreSQL should accept the connection");
    tauri::async_runtime::spawn(async move {
        connection
            .await
            .expect("integration test PostgreSQL connection should remain open");
    });
    client
}

pub fn secondary_database() -> String {
    std::env::var(TEST_SECONDARY_DATABASE_ENV).unwrap_or_else(|_| "plume_secondary".to_owned())
}
