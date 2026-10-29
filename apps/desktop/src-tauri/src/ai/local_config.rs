use std::fs;
use std::path::{Path, PathBuf};

const API_KEY: &str = "KLING_API_KEY";

fn valid_api_key(api_key: String) -> Result<String, String> {
    if api_key.trim().is_empty() {
        return Err("可灵 API Key 为空：请在本地 .env.local 设置 KLING_API_KEY".into());
    }
    Ok(api_key.trim().to_string())
}

fn parse_value(raw: &str) -> &str {
    let value = raw.trim();
    if value.len() >= 2
        && ((value.starts_with('"') && value.ends_with('"'))
            || (value.starts_with('\'') && value.ends_with('\'')))
    {
        &value[1..value.len() - 1]
    } else {
        value
    }
}

fn read_api_key(path: &Path) -> Result<String, String> {
    let content = fs::read_to_string(path)
        .map_err(|err| format!("无法读取本地可灵配置 {}：{err}", path.display()))?;
    let mut api_key = None;
    for line in content.lines() {
        let line = line.trim().trim_start_matches('\u{feff}');
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let Some((name, value)) = line.split_once('=') else {
            continue;
        };
        match name.trim() {
            API_KEY => api_key = Some(parse_value(value).to_string()),
            _ => {}
        }
    }
    valid_api_key(api_key.unwrap_or_default())
}

fn default_env_path() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .ancestors()
        .nth(3)
        .expect("desktop crate has a repository root")
        .join(".env.local")
}

pub fn kling_api_key() -> Result<String, String> {
    if let Ok(api_key) = std::env::var(API_KEY) {
        return valid_api_key(api_key);
    }
    let path = std::env::var_os("AI_VIDEO_ENV_FILE")
        .map(PathBuf::from)
        .unwrap_or_else(default_env_path);
    read_api_key(&path)
}

#[tauri::command]
pub fn kling_api_key_status() -> Result<bool, String> {
    let has_environment = std::env::var_os(API_KEY).is_some();
    let path = std::env::var_os("AI_VIDEO_ENV_FILE")
        .map(PathBuf::from)
        .unwrap_or_else(default_env_path);
    if !has_environment && !path.is_file() {
        return Ok(false);
    }
    kling_api_key().map(|api_key| !api_key.is_empty())
}

#[cfg(test)]
mod tests {
    use super::*;
    use uuid::Uuid;

    #[test]
    fn reads_api_key_from_untracked_env_file() {
        let path = std::env::temp_dir().join(format!("ai-video-env-{}", Uuid::new_v4()));
        fs::write(&path, "# local only\nKLING_API_KEY='api-test'\n").unwrap();
        let api_key = read_api_key(&path).unwrap();
        assert_eq!(api_key, "api-test");
        fs::remove_file(path).unwrap();
    }

    #[test]
    fn rejects_empty_api_key_without_echoing_secrets() {
        let path = std::env::temp_dir().join(format!("ai-video-env-{}", Uuid::new_v4()));
        fs::write(&path, "KLING_API_KEY=\nKLING_SECRET_KEY=secret-test\n").unwrap();
        let error = read_api_key(&path).err().unwrap();
        assert!(error.contains("KLING_API_KEY"));
        assert!(!error.contains("secret-test"));
        fs::remove_file(path).unwrap();
    }
}
