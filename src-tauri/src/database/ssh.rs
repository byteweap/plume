use std::{
    net::{IpAddr, Ipv4Addr, SocketAddr},
    path::PathBuf,
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
    },
    time::Duration,
};

use russh::{
    Disconnect, client,
    keys::{PrivateKeyWithHashAlg, check_known_hosts, check_known_hosts_path, load_secret_key},
};
use serde::{Deserialize, Serialize};
use thiserror::Error;
use tokio::{
    io::copy_bidirectional,
    net::{TcpListener, TcpStream},
    sync::watch,
    task::JoinHandle,
};

use crate::error::DatabaseError;

#[derive(Debug, Clone, Copy, Deserialize, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum SshAuthentication {
    Password,
    PrivateKey,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SshEndpointConfig {
    pub host: String,
    pub port: u16,
    pub username: String,
    pub authentication: SshAuthentication,
    pub private_key_path: Option<String>,
    pub known_hosts_path: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SshConfig {
    #[serde(flatten)]
    pub endpoint: SshEndpointConfig,
    pub jump_host: Option<SshEndpointConfig>,
}

#[derive(Clone)]
pub struct ResolvedSshEndpoint {
    pub config: SshEndpointConfig,
    pub password: Option<String>,
    pub private_key_passphrase: Option<String>,
}

#[derive(Clone)]
pub struct ResolvedSshConfig {
    pub endpoint: ResolvedSshEndpoint,
    pub jump_host: Option<ResolvedSshEndpoint>,
}

#[derive(Debug, Error)]
enum ClientError {
    #[error(transparent)]
    Russh(#[from] russh::Error),
    #[error("The SSH host key is not present in the configured known_hosts file.")]
    UnknownHostKey,
    #[error("The SSH host key differs from the configured known_hosts entry.")]
    HostKeyChanged,
    #[error("The SSH known_hosts file could not be checked: {0}")]
    KnownHosts(String),
}

struct HostKeyVerifier {
    host: String,
    port: u16,
    known_hosts_path: Option<PathBuf>,
}

impl client::Handler for HostKeyVerifier {
    type Error = ClientError;

    async fn check_server_key(
        &mut self,
        server_public_key: &russh::keys::ssh_key::PublicKey,
    ) -> Result<bool, Self::Error> {
        let checked = match self.known_hosts_path.as_ref() {
            Some(path) => check_known_hosts_path(&self.host, self.port, server_public_key, path),
            None => check_known_hosts(&self.host, self.port, server_public_key),
        };
        match checked {
            Ok(true) => Ok(true),
            Ok(false) => Err(ClientError::UnknownHostKey),
            Err(russh::keys::Error::KeyChanged { .. }) => Err(ClientError::HostKeyChanged),
            Err(error) => Err(ClientError::KnownHosts(error.to_string())),
        }
    }
}

type SshHandle = client::Handle<HostKeyVerifier>;

pub struct SshTunnel {
    local_address: SocketAddr,
    primary: Arc<SshHandle>,
    jump: Option<Arc<SshHandle>>,
    cancel: watch::Sender<bool>,
    listener_task: JoinHandle<()>,
    healthy: Arc<AtomicBool>,
    forward_failure: Arc<Mutex<Option<String>>>,
}

impl SshTunnel {
    pub async fn start(
        settings: &ResolvedSshConfig,
        target_host: &str,
        target_port: u16,
        timeout: Duration,
    ) -> Result<Self, DatabaseError> {
        let (primary, jump) = match settings.jump_host.as_ref() {
            Some(jump_settings) => {
                let jump = Arc::new(connect_tcp(jump_settings, timeout).await?);
                let channel = jump
                    .channel_open_direct_tcpip(
                        settings.endpoint.config.host.clone(),
                        u32::from(settings.endpoint.config.port),
                        Ipv4Addr::LOCALHOST.to_string(),
                        0,
                    )
                    .await
                    .map_err(|error| DatabaseError::SshForward(error.to_string()))?;
                let primary =
                    connect_stream(&settings.endpoint, channel.into_stream(), timeout).await?;
                (Arc::new(primary), Some(jump))
            }
            None => (
                Arc::new(connect_tcp(&settings.endpoint, timeout).await?),
                None,
            ),
        };

        let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0))
            .await
            .map_err(|error| DatabaseError::SshForward(error.to_string()))?;
        let local_address = listener
            .local_addr()
            .map_err(|error| DatabaseError::SshForward(error.to_string()))?;
        let (cancel, cancel_rx) = watch::channel(false);
        let healthy = Arc::new(AtomicBool::new(true));
        let forward_failure = Arc::new(Mutex::new(None));
        let listener_task = tokio::spawn(run_listener(
            listener,
            Arc::clone(&primary),
            target_host.to_owned(),
            target_port,
            cancel_rx,
            Arc::clone(&healthy),
            Arc::clone(&forward_failure),
        ));

        Ok(Self {
            local_address,
            primary,
            jump,
            cancel,
            listener_task,
            healthy,
            forward_failure,
        })
    }

    pub fn local_hostaddr(&self) -> IpAddr {
        self.local_address.ip()
    }

    pub fn local_port(&self) -> u16 {
        self.local_address.port()
    }

    pub async fn health(&self) -> Result<(), DatabaseError> {
        if let Some(message) = self.forward_failure() {
            return Err(DatabaseError::SshForward(message));
        }
        if !self.healthy.load(Ordering::Acquire)
            || self.listener_task.is_finished()
            || self.primary.is_closed()
            || self.jump.as_ref().is_some_and(|jump| jump.is_closed())
        {
            return Err(DatabaseError::SshDisconnected);
        }
        tokio::time::timeout(Duration::from_secs(5), self.primary.send_ping())
            .await
            .map_err(|_| DatabaseError::SshDisconnected)?
            .map_err(|_| DatabaseError::SshDisconnected)?;
        if let Some(jump) = self.jump.as_ref() {
            tokio::time::timeout(Duration::from_secs(5), jump.send_ping())
                .await
                .map_err(|_| DatabaseError::SshDisconnected)?
                .map_err(|_| DatabaseError::SshDisconnected)?;
        }
        Ok(())
    }

    pub fn forward_failure(&self) -> Option<String> {
        self.forward_failure
            .lock()
            .ok()
            .and_then(|failure| failure.clone())
    }

    pub async fn close(&self) {
        self.healthy.store(false, Ordering::Release);
        let _ = self.cancel.send(true);
        let _ = self
            .primary
            .disconnect(Disconnect::ByApplication, "", "")
            .await;
        if let Some(jump) = self.jump.as_ref() {
            let _ = jump.disconnect(Disconnect::ByApplication, "", "").await;
        }
    }
}

impl Drop for SshTunnel {
    fn drop(&mut self) {
        let _ = self.cancel.send(true);
        self.listener_task.abort();
    }
}

async fn run_listener(
    listener: TcpListener,
    ssh: Arc<SshHandle>,
    target_host: String,
    target_port: u16,
    mut cancel: watch::Receiver<bool>,
    healthy: Arc<AtomicBool>,
    forward_failure: Arc<Mutex<Option<String>>>,
) {
    loop {
        tokio::select! {
            result = listener.accept() => match result {
                Ok((stream, originator)) => {
                    let ssh = Arc::clone(&ssh);
                    let target_host = target_host.clone();
                    let forward_failure = Arc::clone(&forward_failure);
                    tokio::spawn(async move {
                        let _ = forward_connection(
                            ssh,
                            stream,
                            originator,
                            target_host,
                            target_port,
                            Arc::clone(&forward_failure),
                        )
                        .await;
                    });
                }
                Err(_) => {
                    healthy.store(false, Ordering::Release);
                    record_forward_failure(
                        &forward_failure,
                        "The local tunnel listener failed.",
                    );
                    break;
                }
            },
            changed = cancel.changed() => {
                if changed.is_err() || *cancel.borrow() {
                    break;
                }
            }
        }
    }
}

async fn forward_connection(
    ssh: Arc<SshHandle>,
    mut stream: TcpStream,
    originator: SocketAddr,
    target_host: String,
    target_port: u16,
    forward_failure: Arc<Mutex<Option<String>>>,
) -> Result<(), DatabaseError> {
    let channel = match ssh
        .channel_open_direct_tcpip(
            target_host,
            u32::from(target_port),
            originator.ip().to_string(),
            u32::from(originator.port()),
        )
        .await
    {
        Ok(channel) => channel,
        Err(error) => {
            let reason = error.to_string();
            record_forward_failure(&forward_failure, &reason);
            return Err(DatabaseError::SshForward(reason));
        }
    };
    let mut remote = channel.into_stream();
    if let Err(error) = copy_bidirectional(&mut stream, &mut remote).await {
        let reason = error.to_string();
        record_forward_failure(&forward_failure, &reason);
        return Err(DatabaseError::SshForward(reason));
    }
    Ok(())
}

fn record_forward_failure(failure: &Mutex<Option<String>>, message: &str) {
    if let Ok(mut failure) = failure.lock() {
        *failure = Some(message.to_owned());
    }
}

fn client_config() -> Arc<client::Config> {
    Arc::new(client::Config {
        inactivity_timeout: Some(Duration::from_secs(90)),
        keepalive_interval: Some(Duration::from_secs(30)),
        keepalive_max: 3,
        nodelay: true,
        ..Default::default()
    })
}

fn verifier(settings: &ResolvedSshEndpoint) -> HostKeyVerifier {
    HostKeyVerifier {
        host: settings.config.host.clone(),
        port: settings.config.port,
        known_hosts_path: settings
            .config
            .known_hosts_path
            .as_deref()
            .map(PathBuf::from),
    }
}

async fn connect_tcp(
    settings: &ResolvedSshEndpoint,
    timeout: Duration,
) -> Result<SshHandle, DatabaseError> {
    let mut handle = tokio::time::timeout(
        timeout,
        client::connect(
            client_config(),
            (settings.config.host.as_str(), settings.config.port),
            verifier(settings),
        ),
    )
    .await
    .map_err(|_| ssh_timeout())?
    .map_err(map_client_error)?;
    tokio::time::timeout(timeout, authenticate(&mut handle, settings))
        .await
        .map_err(|_| ssh_timeout())??;
    Ok(handle)
}

async fn connect_stream<Stream>(
    settings: &ResolvedSshEndpoint,
    stream: Stream,
    timeout: Duration,
) -> Result<SshHandle, DatabaseError>
where
    Stream: tokio::io::AsyncRead + tokio::io::AsyncWrite + Unpin + Send + 'static,
{
    let mut handle = tokio::time::timeout(
        timeout,
        client::connect_stream(client_config(), stream, verifier(settings)),
    )
    .await
    .map_err(|_| ssh_timeout())?
    .map_err(map_client_error)?;
    tokio::time::timeout(timeout, authenticate(&mut handle, settings))
        .await
        .map_err(|_| ssh_timeout())??;
    Ok(handle)
}

async fn authenticate(
    handle: &mut SshHandle,
    settings: &ResolvedSshEndpoint,
) -> Result<(), DatabaseError> {
    let result = match settings.config.authentication {
        SshAuthentication::Password => {
            let password = settings.password.as_deref().ok_or_else(|| {
                DatabaseError::SshConfiguration("An SSH password is required.".to_owned())
            })?;
            handle
                .authenticate_password(&settings.config.username, password)
                .await
                .map_err(|error| DatabaseError::SshConnection(error.to_string()))?
        }
        SshAuthentication::PrivateKey => {
            let path = settings.config.private_key_path.as_deref().ok_or_else(|| {
                DatabaseError::SshConfiguration("An SSH private-key path is required.".to_owned())
            })?;
            let key = load_secret_key(path, settings.private_key_passphrase.as_deref()).map_err(
                |error| DatabaseError::SshPrivateKey {
                    path: path.to_owned(),
                    reason: error.to_string(),
                },
            )?;
            let hash = handle
                .best_supported_rsa_hash()
                .await
                .map_err(|error| DatabaseError::SshConnection(error.to_string()))?
                .flatten();
            handle
                .authenticate_publickey(
                    &settings.config.username,
                    PrivateKeyWithHashAlg::new(Arc::new(key), hash),
                )
                .await
                .map_err(|error| DatabaseError::SshConnection(error.to_string()))?
        }
    };

    if result.success() {
        Ok(())
    } else {
        Err(DatabaseError::SshAuthentication)
    }
}

fn map_client_error(error: ClientError) -> DatabaseError {
    match error {
        ClientError::UnknownHostKey => DatabaseError::SshUnknownHostKey,
        ClientError::HostKeyChanged => DatabaseError::SshHostKeyMismatch,
        ClientError::KnownHosts(message) => DatabaseError::SshKnownHosts(message),
        ClientError::Russh(error) => DatabaseError::SshConnection(error.to_string()),
    }
}

fn ssh_timeout() -> DatabaseError {
    DatabaseError::SshConnection("The SSH connection timed out.".to_owned())
}

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use super::SshTunnel;
    use crate::{database::test_support, error::DatabaseError};

    #[test]
    #[ignore = "requires the local SSH and PostgreSQL integration environment"]
    fn closed_tunnel_fails_its_health_check() {
        tauri::async_runtime::block_on(async {
            let tunnel = SshTunnel::start(
                &test_support::ssh_password_config(),
                "postgres",
                5432,
                Duration::from_secs(10),
            )
            .await
            .expect("integration SSH tunnel should start");
            tunnel.health().await.expect("new tunnel should be healthy");
            tunnel.close().await;
            let error = tunnel
                .health()
                .await
                .expect_err("closed tunnel should fail its health check");
            assert!(matches!(error, DatabaseError::SshDisconnected));
        });
    }
}
