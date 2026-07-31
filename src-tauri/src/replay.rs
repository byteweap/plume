use std::collections::HashSet;

use thiserror::Error;
use tokio::sync::Mutex;

#[derive(Default)]
pub struct OperationReplayGuard {
    claimed: Mutex<HashSet<String>>,
}

impl OperationReplayGuard {
    pub async fn claim(&self, operation_id: &str) -> Result<(), ReplayProtectionError> {
        let mut claimed = self.claimed.lock().await;
        if !claimed.insert(operation_id.to_owned()) {
            return Err(ReplayProtectionError::AlreadyClaimed);
        }
        Ok(())
    }
}

#[derive(Debug, Error)]
pub enum ReplayProtectionError {
    #[error("The operation ID has already been submitted.")]
    AlreadyClaimed,
}

#[cfg(test)]
mod tests {
    use super::{OperationReplayGuard, ReplayProtectionError};

    #[test]
    fn operation_ids_are_claimed_once_for_the_process_lifetime() {
        tauri::async_runtime::block_on(async {
            let guard = OperationReplayGuard::default();

            guard.claim("operation-1").await.expect("first claim");
            guard
                .claim("operation-2")
                .await
                .expect("a distinct operation");
            assert!(matches!(
                guard.claim("operation-1").await,
                Err(ReplayProtectionError::AlreadyClaimed)
            ));
        });
    }
}
