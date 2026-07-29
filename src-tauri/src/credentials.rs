#[cfg(any(test, not(any(target_os = "macos", target_os = "windows"))))]
use std::{collections::HashMap, sync::Mutex};

use thiserror::Error;

#[cfg(any(target_os = "macos", target_os = "windows"))]
const SERVICE_NAME: &str = "com.weapon.plume.database";

#[derive(Debug, Error)]
pub enum CredentialError {
    #[error("The credential store is unavailable: {0}")]
    Unavailable(String),
    #[error("The saved credential '{0}' was not found.")]
    NotFound(String),
}

pub trait CredentialStore: Send + Sync {
    fn set(&self, reference: &str, password: &str) -> Result<(), CredentialError>;
    fn get(&self, reference: &str) -> Result<String, CredentialError>;
    fn delete(&self, reference: &str) -> Result<(), CredentialError>;
}

#[cfg(any(target_os = "macos", target_os = "windows"))]
#[derive(Default)]
pub struct SystemCredentialStore;

#[cfg(any(target_os = "macos", target_os = "windows"))]
impl SystemCredentialStore {
    fn entry(reference: &str) -> Result<keyring::Entry, CredentialError> {
        keyring::Entry::new(SERVICE_NAME, reference)
            .map_err(|error| CredentialError::Unavailable(error.to_string()))
    }
}

#[cfg(any(target_os = "macos", target_os = "windows"))]
impl CredentialStore for SystemCredentialStore {
    fn set(&self, reference: &str, password: &str) -> Result<(), CredentialError> {
        Self::entry(reference)?
            .set_password(password)
            .map_err(|error| CredentialError::Unavailable(error.to_string()))
    }

    fn get(&self, reference: &str) -> Result<String, CredentialError> {
        Self::entry(reference)?
            .get_password()
            .map_err(|error| match error {
                keyring::Error::NoEntry => CredentialError::NotFound(reference.to_owned()),
                error => CredentialError::Unavailable(error.to_string()),
            })
    }

    fn delete(&self, reference: &str) -> Result<(), CredentialError> {
        match Self::entry(reference)?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(error) => Err(CredentialError::Unavailable(error.to_string())),
        }
    }
}

#[cfg(any(test, not(any(target_os = "macos", target_os = "windows"))))]
#[derive(Default)]
pub struct MemoryCredentialStore {
    entries: Mutex<HashMap<String, String>>,
}

#[cfg(any(test, not(any(target_os = "macos", target_os = "windows"))))]
impl CredentialStore for MemoryCredentialStore {
    fn set(&self, reference: &str, password: &str) -> Result<(), CredentialError> {
        self.entries
            .lock()
            .map_err(|error| CredentialError::Unavailable(error.to_string()))?
            .insert(reference.to_owned(), password.to_owned());
        Ok(())
    }

    fn get(&self, reference: &str) -> Result<String, CredentialError> {
        self.entries
            .lock()
            .map_err(|error| CredentialError::Unavailable(error.to_string()))?
            .get(reference)
            .cloned()
            .ok_or_else(|| CredentialError::NotFound(reference.to_owned()))
    }

    fn delete(&self, reference: &str) -> Result<(), CredentialError> {
        self.entries
            .lock()
            .map_err(|error| CredentialError::Unavailable(error.to_string()))?
            .remove(reference);
        Ok(())
    }
}

pub fn platform_credential_store() -> Box<dyn CredentialStore> {
    #[cfg(any(target_os = "macos", target_os = "windows"))]
    {
        Box::new(SystemCredentialStore)
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        Box::new(MemoryCredentialStore::default())
    }
}

#[cfg(test)]
mod tests {
    use super::{CredentialStore, MemoryCredentialStore};

    #[test]
    fn memory_store_supports_the_complete_lifecycle() {
        let store = MemoryCredentialStore::default();
        store
            .set("profile-1", "first")
            .expect("credential should save");
        assert_eq!(store.get("profile-1").unwrap(), "first");

        store
            .set("profile-1", "updated")
            .expect("credential should update");
        assert_eq!(store.get("profile-1").unwrap(), "updated");

        store.delete("profile-1").expect("credential should delete");
        assert!(store.get("profile-1").is_err());
    }

    #[cfg(any(target_os = "macos", target_os = "windows"))]
    #[test]
    #[ignore = "writes a temporary credential to the operating-system credential store"]
    fn system_store_supports_a_real_round_trip() {
        use uuid::Uuid;

        use super::SystemCredentialStore;

        let reference = format!("integration-test-{}", Uuid::new_v4());
        let store = SystemCredentialStore;
        store.set(&reference, "plume-keyring-test").unwrap();
        let round_trip = store.get(&reference);
        let cleanup = store.delete(&reference);
        assert_eq!(round_trip.unwrap(), "plume-keyring-test");
        cleanup.expect("temporary system credential should be removed");
        assert!(store.get(&reference).is_err());
    }
}
