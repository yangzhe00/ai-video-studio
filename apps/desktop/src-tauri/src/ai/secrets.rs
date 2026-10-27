use keyring_core::{Entry, Error as KeyringError};
use serde::{Deserialize, Serialize};
use std::sync::LazyLock;

const SERVICE: &str = "com.yangzhe.aivideostudio.api";

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum ProviderId { Hedra, Runway, Deepseek }

impl ProviderId {
    fn account(self) -> &'static str {
        match self { Self::Hedra => "hedra", Self::Runway => "runway", Self::Deepseek => "deepseek" }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderKeyStatus { provider: ProviderId, configured: bool }

pub trait SecretStore {
    fn set(&self, provider: ProviderId, key: &str) -> Result<(), String>;
    fn get(&self, provider: ProviderId) -> Result<Option<String>, String>;
    fn remove(&self, provider: ProviderId) -> Result<(), String>;
}

pub struct KeychainStore;

static KEYCHAIN_READY: LazyLock<Result<(), String>> = LazyLock::new(|| {
    let store = apple_native_keyring_store::keychain::Store::new().map_err(|err| format!("无法连接 macOS 钥匙串：{err}"))?;
    keyring_core::set_default_store(store);
    Ok(())
});

fn entry(provider: ProviderId) -> Result<Entry, String> {
    KEYCHAIN_READY.as_ref().map_err(Clone::clone)?;
    Entry::new(SERVICE, provider.account()).map_err(|err| format!("无法访问钥匙串：{err}"))
}

impl SecretStore for KeychainStore {
    fn set(&self, provider: ProviderId, key: &str) -> Result<(), String> {
        if key.trim().is_empty() { return Err("API Key 不能为空".into()); }
        entry(provider)?.set_password(key).map_err(|err| format!("无法保存 API Key 到钥匙串：{err}"))
    }
    fn get(&self, provider: ProviderId) -> Result<Option<String>, String> {
        match entry(provider)?.get_password() {
            Ok(key) => Ok(Some(key)),
            Err(KeyringError::NoEntry) => Ok(None),
            Err(err) => Err(format!("无法读取钥匙串状态：{err}")),
        }
    }
    fn remove(&self, provider: ProviderId) -> Result<(), String> {
        match entry(provider)?.delete_credential() {
            Ok(()) | Err(KeyringError::NoEntry) => Ok(()),
            Err(err) => Err(format!("无法从钥匙串移除 API Key：{err}")),
        }
    }
}

fn statuses(store: &impl SecretStore) -> Result<Vec<ProviderKeyStatus>, String> {
    [ProviderId::Hedra, ProviderId::Runway, ProviderId::Deepseek].into_iter()
        .map(|provider| Ok(ProviderKeyStatus { provider, configured: store.get(provider)?.is_some() }))
        .collect()
}

#[tauri::command]
pub fn set_provider_key(provider: ProviderId, key: String) -> Result<(), String> {
    KeychainStore.set(provider, &key)
}

#[tauri::command]
pub fn remove_provider_key(provider: ProviderId) -> Result<(), String> {
    KeychainStore.remove(provider)
}

#[tauri::command]
pub fn provider_key_status() -> Result<Vec<ProviderKeyStatus>, String> {
    statuses(&KeychainStore)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;
    use std::sync::Mutex;

    #[derive(Default)]
    struct FakeStore(Mutex<HashMap<&'static str, String>>);
    impl SecretStore for FakeStore {
        fn set(&self, provider: ProviderId, key: &str) -> Result<(), String> {
            self.0.lock().unwrap().insert(provider.account(), key.into()); Ok(())
        }
        fn get(&self, provider: ProviderId) -> Result<Option<String>, String> {
            Ok(self.0.lock().unwrap().get(provider.account()).cloned())
        }
        fn remove(&self, provider: ProviderId) -> Result<(), String> {
            self.0.lock().unwrap().remove(provider.account()); Ok(())
        }
    }
    #[test]
    fn secrets_set_remove_and_status_without_project_file() {
        let store = FakeStore::default();
        assert!(!statuses(&store).unwrap()[0].configured);
        store.set(ProviderId::Hedra, "test-secret").unwrap();
        assert!(statuses(&store).unwrap()[0].configured);
        store.remove(ProviderId::Hedra).unwrap();
        assert!(!statuses(&store).unwrap()[0].configured);
    }
}
