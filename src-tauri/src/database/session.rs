use std::{collections::HashMap, sync::Arc};

use tokio::sync::RwLock;
use tokio_postgres::Client;
use uuid::Uuid;

use crate::{
    database::connection::{ConnectionTestRequest, open},
    error::DatabaseError,
};

struct ServerSession {
    settings: ConnectionTestRequest,
    clients: RwLock<HashMap<String, Arc<Client>>>,
}

#[derive(Default)]
pub struct ConnectionRegistry {
    sessions: RwLock<HashMap<String, Arc<ServerSession>>>,
}

impl ConnectionRegistry {
    pub async fn insert(&self, settings: ConnectionTestRequest, client: Client) -> String {
        let session_id = Uuid::new_v4().to_string();
        let primary_database = settings.database.clone();
        let session = ServerSession {
            settings,
            clients: RwLock::new(HashMap::from([(primary_database, Arc::new(client))])),
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
    use super::ConnectionRegistry;

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
}
