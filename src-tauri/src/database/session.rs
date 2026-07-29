use std::{collections::HashMap, sync::Arc};

use serde::Serialize;
use tokio::sync::RwLock;
use tokio_postgres::Client;
use uuid::Uuid;

use crate::{
    database::connection::{ConnectionTestRequest, OpenConnection, open},
    error::DatabaseError,
};

struct ServerSession {
    settings: ConnectionTestRequest,
    clients: RwLock<HashMap<String, Arc<Client>>>,
    tunnel: Option<crate::database::ssh::SshTunnel>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionHealth {
    pub session_id: String,
    pub state: &'static str,
    pub database_count: usize,
}

#[derive(Default)]
pub struct ConnectionRegistry {
    sessions: RwLock<HashMap<String, Arc<ServerSession>>>,
}

impl ConnectionRegistry {
    pub async fn insert(&self, connection: OpenConnection) -> String {
        let session_id = Uuid::new_v4().to_string();
        let primary_database = connection.settings.database.clone();
        let session = ServerSession {
            settings: connection.settings,
            clients: RwLock::new(HashMap::from([(
                primary_database,
                Arc::new(connection.client),
            )])),
            tunnel: connection.tunnel,
        };

        self.sessions
            .write()
            .await
            .insert(session_id.clone(), Arc::new(session));
        session_id
    }

    pub async fn primary_client(&self, session_id: &str) -> Result<Arc<Client>, DatabaseError> {
        let session = self.session(session_id).await?;
        session
            .clients
            .read()
            .await
            .get(&session.settings.database)
            .cloned()
            .ok_or_else(|| DatabaseError::SessionNotFound(session_id.to_owned()))
    }

    pub async fn database_client(
        &self,
        session_id: &str,
        database: &str,
    ) -> Result<Arc<Client>, DatabaseError> {
        let session = self.session(session_id).await?;

        if let Some(client) = session.clients.read().await.get(database).cloned() {
            return Ok(client);
        }

        let request = session.settings.for_database(database);
        let connection = open(&request).await?;
        let client = Arc::new(connection.client);
        let mut clients = session.clients.write().await;

        Ok(clients
            .entry(database.to_owned())
            .or_insert_with(|| Arc::clone(&client))
            .clone())
    }

    pub async fn health(&self, session_id: &str) -> Result<SessionHealth, DatabaseError> {
        let session = self.session(session_id).await?;
        if let Some(tunnel) = session.tunnel.as_ref() {
            tunnel.health().await?;
        }
        let client = session
            .clients
            .read()
            .await
            .get(&session.settings.database)
            .cloned()
            .ok_or_else(|| DatabaseError::SessionNotFound(session_id.to_owned()))?;

        client.simple_query("SELECT 1").await?;
        let database_count = session.clients.read().await.len();
        Ok(SessionHealth {
            session_id: session_id.to_owned(),
            state: "connected",
            database_count,
        })
    }

    pub async fn remove(&self, session_id: &str) -> Result<(), DatabaseError> {
        let session = self
            .sessions
            .write()
            .await
            .remove(session_id)
            .ok_or_else(|| DatabaseError::SessionNotFound(session_id.to_owned()))?;
        if let Some(tunnel) = session.tunnel.as_ref() {
            tunnel.close().await;
        }
        Ok(())
    }

    #[cfg(test)]
    async fn len(&self) -> usize {
        self.sessions.read().await.len()
    }

    async fn session(&self, session_id: &str) -> Result<Arc<ServerSession>, DatabaseError> {
        self.sessions
            .read()
            .await
            .get(session_id)
            .cloned()
            .ok_or_else(|| DatabaseError::SessionNotFound(session_id.to_owned()))
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use super::ConnectionRegistry;
    use crate::database::{connection::open, test_support};

    #[test]
    fn missing_session_returns_an_explicit_error() {
        let error = tauri::async_runtime::block_on(async {
            ConnectionRegistry::default()
                .primary_client("missing")
                .await
                .expect_err("unknown session should fail")
        });

        assert!(error.to_string().contains("no longer available"));
    }

    #[test]
    fn removing_a_missing_session_returns_an_explicit_error() {
        let error = tauri::async_runtime::block_on(async {
            ConnectionRegistry::default()
                .remove("missing")
                .await
                .expect_err("unknown session should fail")
        });

        assert!(error.to_string().contains("no longer available"));
    }

    #[test]
    #[ignore = "requires the local PostgreSQL integration environment"]
    fn opens_an_independent_client_for_another_database() {
        tauri::async_runtime::block_on(async {
            let request = test_support::connection_request();
            let primary_database = request.database.clone();
            let connection = open(&request)
                .await
                .expect("primary integration test connection should open");
            let registry = ConnectionRegistry::default();
            let session_id = registry.insert(connection).await;

            let primary = registry
                .primary_client(&session_id)
                .await
                .expect("primary client should be registered");
            let secondary_database = test_support::secondary_database();
            let secondary = registry
                .database_client(&session_id, &secondary_database)
                .await
                .expect("secondary database client should open");
            let connected_database: String = secondary
                .query_one("SELECT current_database()", &[])
                .await
                .expect("secondary database should answer")
                .get(0);
            let fixture_count: i64 = secondary
                .query_one("SELECT count(*) FROM plume_fixture.items", &[])
                .await
                .expect("secondary fixture data should be available")
                .get(0);

            assert_eq!(connected_database, secondary_database);
            assert_eq!(fixture_count, 2);
            assert!(!Arc::ptr_eq(&primary, &secondary));
            assert_eq!(
                primary
                    .query_one("SELECT current_database()", &[])
                    .await
                    .expect("primary database should remain connected")
                    .get::<_, String>(0),
                primary_database
            );

            let health = registry
                .health(&session_id)
                .await
                .expect("connected session should be healthy");
            assert_eq!(health.state, "connected");
            assert_eq!(health.database_count, 2);

            let replacement_request = test_support::connection_request();
            let replacement = open(&replacement_request)
                .await
                .expect("replacement connection should open");
            let replacement_id = registry.insert(replacement).await;
            registry
                .remove(&session_id)
                .await
                .expect("old session should disconnect after replacement opens");
            assert_eq!(registry.len().await, 1);
            assert!(registry.primary_client(&session_id).await.is_err());
            assert!(registry.health(&replacement_id).await.is_ok());

            registry.remove(&replacement_id).await.unwrap();
            assert_eq!(registry.len().await, 0);
        });
    }

    #[test]
    #[ignore = "requires the local SSH and PostgreSQL integration environment"]
    fn manages_a_tunneled_session_and_secondary_database_client() {
        tauri::async_runtime::block_on(async {
            let mut request = test_support::connection_request();
            request.host = "postgres".to_owned();
            request.port = 5432;
            request.ssh_config = Some(test_support::ssh_password_config());
            let connection = open(&request)
                .await
                .expect("tunneled integration connection should open");
            let registry = ConnectionRegistry::default();
            let session_id = registry.insert(connection).await;

            let secondary = registry
                .database_client(&session_id, &test_support::secondary_database())
                .await
                .expect("secondary client should reuse the existing tunnel endpoint");
            let database: String = secondary
                .query_one("SELECT current_database()", &[])
                .await
                .expect("secondary database should answer through SSH")
                .get(0);
            assert_eq!(database, test_support::secondary_database());
            assert_eq!(
                registry.health(&session_id).await.unwrap().database_count,
                2
            );

            registry.remove(&session_id).await.unwrap();
            assert!(registry.health(&session_id).await.is_err());
        });
    }
}
