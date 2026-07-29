use tokio_postgres::{Client, Config, NoTls, config::Host};

use crate::database::connection::{ConnectionTestRequest, SslMode};

pub const TEST_DATABASE_CONFIG_ENV: &str = "PLUME_TEST_DATABASE_CONFIG";
pub const TEST_SECONDARY_DATABASE_ENV: &str = "PLUME_TEST_SECONDARY_DATABASE";

pub fn config() -> Config {
    std::env::var(TEST_DATABASE_CONFIG_ENV)
        .unwrap_or_else(|_| panic!("{TEST_DATABASE_CONFIG_ENV} must contain a PostgreSQL URL"))
        .parse()
        .expect("integration test database config should be valid")
}

pub fn connection_request() -> ConnectionTestRequest {
    let config = config();
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
        ssl_mode: SslMode::Disable,
        root_certificate_path: None,
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
