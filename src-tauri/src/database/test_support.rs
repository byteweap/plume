use tokio_postgres::{Client, Config, NoTls, config::Host};

use crate::database::{
    connection::{ConnectionTestRequest, SslMode},
    ssh::{ResolvedSshConfig, ResolvedSshEndpoint, SshAuthentication, SshEndpointConfig},
};

pub const TEST_DATABASE_CONFIG_ENV: &str = "PLUME_TEST_DATABASE_CONFIG";
pub const TEST_SECONDARY_DATABASE_ENV: &str = "PLUME_TEST_SECONDARY_DATABASE";
pub const TEST_TLS_DATABASE_CONFIG_ENV: &str = "PLUME_TEST_TLS_DATABASE_CONFIG";
pub const TEST_TLS_CERTIFICATE_DIR_ENV: &str = "PLUME_TEST_TLS_CERTIFICATE_DIR";
pub const TEST_SSH_FIXTURE_DIR_ENV: &str = "PLUME_TEST_SSH_FIXTURE_DIR";
pub const TEST_SSH_PORT_ENV: &str = "PLUME_TEST_SSH_PORT";
pub const TEST_SSH_JUMP_PORT_ENV: &str = "PLUME_TEST_SSH_JUMP_PORT";

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

pub fn ssh_fixture_path(file_name: &str) -> String {
    std::path::Path::new(
        &std::env::var(TEST_SSH_FIXTURE_DIR_ENV)
            .unwrap_or_else(|_| panic!("{TEST_SSH_FIXTURE_DIR_ENV} must be set")),
    )
    .join(file_name)
    .to_string_lossy()
    .into_owned()
}

pub fn ssh_password_config() -> ResolvedSshConfig {
    ResolvedSshConfig {
        endpoint: ssh_endpoint(
            "localhost",
            test_port(TEST_SSH_PORT_ENV, 55222),
            SshAuthentication::Password,
            Some("plume-ssh-password"),
            None,
            None,
            "known_hosts",
        ),
        jump_host: None,
    }
}

pub fn ssh_private_key_config() -> ResolvedSshConfig {
    ResolvedSshConfig {
        endpoint: ssh_endpoint(
            "localhost",
            test_port(TEST_SSH_PORT_ENV, 55222),
            SshAuthentication::PrivateKey,
            None,
            Some("id_ed25519_encrypted"),
            Some("plume-key-passphrase"),
            "known_hosts",
        ),
        jump_host: None,
    }
}

pub fn ssh_jump_config() -> ResolvedSshConfig {
    ResolvedSshConfig {
        endpoint: ssh_endpoint(
            "ssh-target",
            22,
            SshAuthentication::Password,
            Some("plume-ssh-password"),
            None,
            None,
            "known_hosts",
        ),
        jump_host: Some(ssh_endpoint(
            "localhost",
            test_port(TEST_SSH_JUMP_PORT_ENV, 55223),
            SshAuthentication::Password,
            Some("plume-jump-password"),
            None,
            None,
            "known_hosts",
        )),
    }
}

#[allow(clippy::too_many_arguments)]
fn ssh_endpoint(
    host: &str,
    port: u16,
    authentication: SshAuthentication,
    password: Option<&str>,
    private_key: Option<&str>,
    passphrase: Option<&str>,
    known_hosts: &str,
) -> ResolvedSshEndpoint {
    ResolvedSshEndpoint {
        config: SshEndpointConfig {
            host: host.to_owned(),
            port,
            username: "plume".to_owned(),
            authentication,
            private_key_path: private_key.map(ssh_fixture_path),
            known_hosts_path: Some(ssh_fixture_path(known_hosts)),
        },
        password: password.map(str::to_owned),
        private_key_passphrase: passphrase.map(str::to_owned),
    }
}

fn test_port(environment: &str, default: u16) -> u16 {
    std::env::var(environment)
        .ok()
        .map(|value| value.parse().expect("SSH test port should be valid"))
        .unwrap_or(default)
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
        ssh_config: None,
        connect_hostaddr: None,
        connect_port: None,
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
