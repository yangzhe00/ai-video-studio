use crate::media::{probe, read_asset_impl};
use crate::project::{open_project_impl, MediaAsset};
use reqwest::blocking::{Client, RequestBuilder};
use reqwest::header::{CONTENT_TYPE, COOKIE, SET_COOKIE};
use serde_json::Value;
use std::fs;
use std::io::{self, Read};
use std::path::PathBuf;
use std::sync::Mutex;
use uuid::Uuid;

pub struct CloudSession(pub Mutex<Option<String>>);

const AVS_REQUEST_HEADER_NAME: &str = "X-AVS-Request";
const AVS_REQUEST_HEADER_VALUE: &str = "1";

fn with_request_marker(request: RequestBuilder, method: &reqwest::Method) -> RequestBuilder {
    if [reqwest::Method::POST, reqwest::Method::PUT, reqwest::Method::PATCH, reqwest::Method::DELETE].contains(method) {
        request.header(AVS_REQUEST_HEADER_NAME, AVS_REQUEST_HEADER_VALUE)
    } else {
        request
    }
}

fn validate_base_url(raw: &str) -> Result<String, String> {
    let url = reqwest::Url::parse(raw).map_err(|_| "云端服务地址无效".to_string())?;
    let host = url.host_str().unwrap_or("");
    let loopback = matches!(host, "localhost" | "127.0.0.1" | "::1" | "[::1]");
    if (url.scheme() != "https" && !(url.scheme() == "http" && loopback)) ||
        !url.username().is_empty() || url.password().is_some() || url.query().is_some() || url.fragment().is_some() {
        return Err("远程云端服务必须使用 HTTPS".into());
    }
    Ok(raw.trim_end_matches('/').to_owned())
}

fn base_url() -> Result<String, String> {
    validate_base_url(&std::env::var("AI_VIDEO_API_BASE_URL").unwrap_or_else(|_| "http://127.0.0.1:8787".into()))
}

fn endpoint(path: &str) -> Result<String, String> {
    if !path.starts_with('/') || path.starts_with("//") || path.contains("..") || path.contains('\\') || path.contains('#') {
        return Err("云端路径无效".into());
    }
    let idea_path = path == "/prompt-ideas" || path.starts_with("/prompt-ideas/");
    if !idea_path && !["/auth/", "/projects", "/runs/", "/objects", "/video-edits", "/renders/", "/tts/", "/episode-renders/", "/agent-edits/", "/previews/"].iter().any(|prefix| path.starts_with(prefix)) {
        return Err("云端接口不允许".into());
    }
    Ok(format!("{}{}", base_url()?, path))
}

fn client() -> Result<Client, String> {
    Client::builder().timeout(std::time::Duration::from_secs(40)).build().map_err(|err| err.to_string())
}

fn media_client() -> Result<Client, String> {
    Client::builder().timeout(std::time::Duration::from_secs(180)).build().map_err(|err| err.to_string())
}

fn cookie(session: &CloudSession) -> Result<Option<String>, String> {
    session.0.lock().map(|value| value.clone()).map_err(|_| "登录状态不可用".into())
}

#[tauri::command]
pub fn cloud_request(session: tauri::State<'_, CloudSession>, method: String, path: String, body: Option<Value>) -> Result<Value, String> {
    let url = endpoint(&path)?;
    let verb = reqwest::Method::from_bytes(method.as_bytes()).map_err(|_| "请求方法无效".to_string())?;
    if ![reqwest::Method::GET, reqwest::Method::POST, reqwest::Method::PUT].contains(&verb) { return Err("请求方法不允许".into()); }
    let mut request = with_request_marker(client()?.request(verb.clone(), url), &verb);
    if let Some(value) = cookie(&session)? { request = request.header(COOKIE, value); }
    if let Some(payload) = body { request = request.json(&payload); }
    let response = request.send().map_err(|err| format!("连接云端失败：{err}"))?;
    let status = response.status();
    let new_cookie = response.headers().get(SET_COOKIE).and_then(|value| value.to_str().ok()).map(|value| value.split(';').next().unwrap_or("").to_owned());
    let payload: Value = response.json().map_err(|err| format!("云端响应无效：{err}"))?;
    if let Some(value) = new_cookie { *session.0.lock().map_err(|_| "登录状态不可用".to_string())? = if value.starts_with("avs_session=;") || value == "avs_session=" { None } else { Some(value) }; }
    if !status.is_success() {
        return Err(payload["error"].as_str().unwrap_or("云端请求失败").to_owned());
    }
    Ok(payload)
}

#[tauri::command]
pub fn cloud_upload_asset(session: tauri::State<'_, CloudSession>, root: PathBuf, asset_id: String) -> Result<Value, String> {
    let manifest = open_project_impl(&root)?;
    let asset = manifest.assets.iter().find(|item| item.id == asset_id).ok_or("本地素材不存在")?;
    let source = root.join(&asset.relative_path);
    if fs::metadata(&source).map_err(|err| err.to_string())?.len() > 20_000_000 {
        return Err("该素材超过云端单文件 20 MB 上传限制".into());
    }
    let mime = match asset.relative_path.rsplit('.').next().unwrap_or("").to_ascii_lowercase().as_str() {
        "jpg" | "jpeg" => "image/jpeg", "png" => "image/png", "webp" => "image/webp", "mp4" => "video/mp4",
        "mp3" => "audio/mpeg", "wav" => "audio/wav", "m4a" => "audio/mp4",
        _ => return Err("云端暂不支持此素材格式".into()),
    };
    let bytes = read_asset_impl(&root, &asset_id)?;
    let mut request = with_request_marker(media_client()?.post(endpoint("/objects")?), &reqwest::Method::POST)
        .header(CONTENT_TYPE, mime).body(bytes);
    if let Some(value) = cookie(&session)? { request = request.header(COOKIE, value); }
    let response = request.send().map_err(|err| format!("上传素材失败：{err}"))?;
    let status = response.status();
    let payload: Value = response.json().map_err(|err| format!("上传响应无效：{err}"))?;
    if !status.is_success() { return Err(payload["error"].as_str().unwrap_or("上传失败").to_owned()); }
    Ok(payload)
}

#[tauri::command]
pub fn cloud_download_asset(session: tauri::State<'_, CloudSession>, root: PathBuf, object_id: String, kind: String) -> Result<MediaAsset, String> {
    if !object_id.chars().all(|ch| ch.is_ascii_alphanumeric() || ch == '-') || object_id.len() < 8 || object_id.len() > 80 {
        return Err("云端素材 ID 无效".into());
    }
    if !matches!(kind.as_str(), "image" | "video" | "voice" | "music") { return Err("素材类型无效".into()); }
    open_project_impl(&root)?;
    let mut request = media_client()?.get(endpoint(&format!("/objects/{object_id}"))?);
    if let Some(value) = cookie(&session)? { request = request.header(COOKIE, value); }
    let mut response = request.send().map_err(|err| format!("下载素材失败：{err}"))?;
    if !response.status().is_success() { return Err("云端素材不存在或无权访问".into()); }
    let mime = response.headers().get(CONTENT_TYPE).and_then(|value| value.to_str().ok()).unwrap_or("").to_owned();
    let extension = match (kind.as_str(), mime.as_str()) {
        ("image", "image/jpeg") => "jpg", ("image", "image/png") => "png", ("image", "image/webp") => "webp",
        ("video", "video/mp4") => "mp4",
        ("voice" | "music", "audio/mpeg") => "mp3",
        ("voice" | "music", "audio/wav") => "wav",
        ("voice" | "music", "audio/mp4") => "m4a",
        _ => return Err("云端素材格式不匹配".into()),
    };
    const MAX_DOWNLOAD_BYTES: u64 = 100_000_000;
    if response.content_length().is_some_and(|size| size > MAX_DOWNLOAD_BYTES) {
        return Err("云端素材超过 100 MB 下载限制".into());
    }
    let relative_path = format!("media/cloud/{object_id}.{extension}");
    let destination = root.join(&relative_path);
    fs::create_dir_all(root.join("media/cloud")).map_err(|err| err.to_string())?;
    let temporary = root.join(format!("media/cloud/.{object_id}.{}.{extension}", Uuid::new_v4()));
    let downloaded = (|| -> Result<u64, String> {
        let mut file = fs::File::create(&temporary).map_err(|err| err.to_string())?;
        let mut limited = (&mut response).take(MAX_DOWNLOAD_BYTES + 1);
        let written = io::copy(&mut limited, &mut file).map_err(|err| err.to_string())?;
        if written == 0 || written > MAX_DOWNLOAD_BYTES { return Err("云端素材为空或超过 100 MB".into()); }
        file.sync_all().map_err(|err| err.to_string())?;
        Ok(written)
    })();
    if let Err(error) = downloaded { let _ = fs::remove_file(&temporary); return Err(error); }
    let probe_binary = std::env::var_os("AI_VIDEO_FFPROBE").map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("binaries/ffprobe"));
    let measured = probe(&temporary, &probe_binary);
    if let Err(error) = &measured { let _ = fs::remove_file(&temporary); return Err(error.clone()); }
    let (measured_kind, duration_ms, width, height) = measured?;
    let expected_kind = if kind == "voice" || kind == "music" { "audio" } else { kind.as_str() };
    if measured_kind != expected_kind { let _ = fs::remove_file(&temporary); return Err("云端素材内容与类型不匹配".into()); }
    fs::rename(&temporary, &destination).map_err(|err| err.to_string())?;
    Ok(MediaAsset { id: object_id, kind, relative_path, duration_ms, width, height, missing: false })
}

#[cfg(test)]
mod tests {
    use super::{client, endpoint, validate_base_url, with_request_marker, AVS_REQUEST_HEADER_NAME, AVS_REQUEST_HEADER_VALUE};

    #[test]
    fn state_changes_carry_the_shared_request_marker() {
        let client = client().unwrap();
        for method in [reqwest::Method::POST, reqwest::Method::PUT, reqwest::Method::PATCH, reqwest::Method::DELETE] {
            let request = with_request_marker(client.request(method.clone(), "https://api.example.com/auth/logout"), &method)
                .build().unwrap();
            assert_eq!(request.headers()[AVS_REQUEST_HEADER_NAME], AVS_REQUEST_HEADER_VALUE);
        }
        let get = with_request_marker(client.get("https://api.example.com/objects/photo-1"), &reqwest::Method::GET)
            .build().unwrap();
        assert!(!get.headers().contains_key(AVS_REQUEST_HEADER_NAME));
    }

    #[test]
    fn remote_cloud_requires_https_while_loopback_development_remains_available() {
        assert!(validate_base_url("http://127.0.0.1:8787").is_ok());
        assert!(validate_base_url("http://localhost:8787").is_ok());
        assert!(validate_base_url("https://api.example.com").is_ok());
        assert!(validate_base_url("http://api.example.com").is_err());
        assert!(validate_base_url("https://user:secret@api.example.com").is_err());
    }

    #[test]
    fn idea_paths_are_allowed_without_opening_arbitrary_paths() {
        assert!(endpoint("/prompt-ideas").is_ok());
        assert!(endpoint("/prompt-ideas/idea-123").is_ok());
        assert!(endpoint("/prompt-ideas/idea-123/selection").is_ok());
        assert!(endpoint("/prompt-ideas-other").is_err());
        assert!(endpoint("/admin").is_err());
        assert!(endpoint("/tts/tasks/task-123").is_ok());
        assert!(endpoint("/episode-renders/render-123").is_ok());
        assert!(endpoint("/agent-edits/edit-123/confirm").is_ok());
        assert!(endpoint("/previews/preview-123").is_ok());
    }
}
