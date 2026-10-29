use base64::{engine::general_purpose::STANDARD, Engine as _};
use reqwest::blocking::Client;
use reqwest::redirect::Policy;
use serde_json::{json, Value};
use std::fs::{self, File};
use std::io::{self, Read};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::Duration;
use uuid::Uuid;

use super::local_config::kling_api_key;
use super::types::{GenerationJob, JobState};
use crate::project::{
    open_project_impl, save_project_impl, validate_relative_path, MediaAsset, ProjectManifestV2,
};

const BASE_URL: &str = "https://api-beijing.klingai.com";
const IMAGE_TO_VIDEO: &str = "/image-to-video/kling-2.5-turbo";
const TASKS: &str = "/tasks";
const MAX_IMAGE_BYTES: u64 = 10 * 1024 * 1024;
const MAX_VIDEO_BYTES: u64 = 500 * 1024 * 1024;
static JOB_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

enum SubmitError {
    Rejected,
    Uncertain,
}

fn client() -> Result<Client, String> {
    Client::builder()
        .timeout(Duration::from_secs(40))
        .build()
        .map_err(|_| "无法初始化可灵网络连接".into())
}

fn download_client() -> Result<Client, String> {
    Client::builder()
        .timeout(Duration::from_secs(180))
        .redirect(Policy::custom(|attempt| {
            if attempt.url().scheme() == "https" && attempt.previous().len() < 5 {
                attempt.follow()
            } else {
                attempt.stop()
            }
        }))
        .build()
        .map_err(|_| "无法初始化视频下载连接".into())
}

fn api_data(value: Value) -> Result<Value, String> {
    if value["code"].as_i64() != Some(0) {
        return Err("可灵未接受请求，请检查账户余额、模型权限和素材要求".into());
    }
    value
        .get("data")
        .cloned()
        .ok_or("可灵响应缺少任务数据".into())
}

fn source_image(
    root: &Path,
    manifest: &ProjectManifestV2,
    shot_id: &str,
) -> Result<(String, String, u8), String> {
    let shot = manifest
        .shots
        .iter()
        .find(|shot| shot.id == shot_id)
        .ok_or("分镜不存在")?;
    if shot.speaking {
        return Err("有台词的分镜需要配音和口型流程，本阶段仅支持无声图生视频".into());
    }
    if shot.model_id != "kling-v2-5-turbo" || ![5, 10].contains(&shot.duration_sec) {
        return Err("当前可灵图生视频仅支持 5 秒或 10 秒无声镜头".into());
    }
    if shot.prompt.chars().count() > 2500 {
        return Err("提示词超过可灵的 2500 字限制".into());
    }
    let asset = manifest
        .assets
        .iter()
        .find(|asset| asset.id == shot.source_asset_id && asset.kind == "image" && !asset.missing)
        .ok_or("参考照片不存在或已丢失")?;
    if let (Some(width), Some(height)) = (asset.width, asset.height) {
        if width < 300
            || height < 300
            || 5 * u64::from(width) < 2 * u64::from(height)
            || 5 * u64::from(height) < 2 * u64::from(width)
        {
            return Err("可灵参考照片的宽高需至少 300 像素，比例需在 1:2.5 至 2.5:1 之间".into());
        }
    }
    validate_relative_path(&asset.relative_path)?;
    let path = root.join(&asset.relative_path);
    let canonical_root = fs::canonicalize(root).map_err(|_| "无法读取项目目录")?;
    let canonical_file = fs::canonicalize(&path).map_err(|_| "参考照片已丢失")?;
    if !canonical_file.starts_with(canonical_root) {
        return Err("参考照片不在项目目录内".into());
    }
    let extension = path
        .extension()
        .and_then(|extension| extension.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    if !["jpg", "jpeg", "png"].contains(&extension.as_str()) {
        return Err("可灵当前接入只支持 JPG 或 PNG 参考照片".into());
    }
    let size = fs::metadata(&canonical_file)
        .map_err(|_| "无法读取参考照片")?
        .len();
    if size == 0 || size > MAX_IMAGE_BYTES {
        return Err("参考照片必须在 10 MB 以内".into());
    }
    let image = fs::read(canonical_file).map_err(|_| "无法读取参考照片")?;
    Ok((
        STANDARD.encode(image),
        shot.prompt.clone(),
        shot.duration_sec,
    ))
}

fn submit_request(
    client: &Client,
    base_url: &str,
    key: &str,
    payload: Value,
) -> Result<Value, SubmitError> {
    let response = client
        .post(format!("{base_url}{IMAGE_TO_VIDEO}"))
        .bearer_auth(key)
        .json(&payload)
        .send()
        .map_err(|_| SubmitError::Uncertain)?;
    let status = response.status();
    if status.is_client_error() {
        return Err(SubmitError::Rejected);
    }
    if !status.is_success() {
        return Err(SubmitError::Uncertain);
    }
    let body: Value = response.json().map_err(|_| SubmitError::Uncertain)?;
    api_data(body).map_err(|_| SubmitError::Rejected)
}

fn persist_job(
    root: &Path,
    manifest: &mut ProjectManifestV2,
    job_id: &str,
    state: JobState,
    remote_id: Option<String>,
) -> Result<(), String> {
    let job = manifest
        .jobs
        .iter_mut()
        .find(|job| job.id == job_id)
        .ok_or("本地生成任务不存在")?;
    job.state = state;
    if remote_id.is_some() {
        job.remote_id = remote_id;
    }
    save_project_impl(root, manifest)
}

fn submit_impl(
    root: &Path,
    shot_id: &str,
    client: &Client,
    base_url: &str,
    key: &str,
) -> Result<ProjectManifestV2, String> {
    let mut manifest = open_project_impl(root)?;
    let (image, prompt, duration) = source_image(root, &manifest, shot_id)?;
    if manifest.jobs.iter().any(|job| {
        job.shot_id == shot_id
            && job.provider == "kling"
            && !matches!(
                job.state,
                JobState::Failed | JobState::Succeeded | JobState::Draft
            )
    }) {
        return Err("该分镜已有待查询的可灵任务；请先查询状态，不能重复提交".into());
    }
    let job_id = Uuid::new_v4().to_string();
    manifest.jobs.push(GenerationJob {
        id: job_id.clone(),
        shot_id: shot_id.into(),
        provider: "kling".into(),
        model_id: "kling-v2-5-turbo".into(),
        state: JobState::Submitting,
        remote_id: None,
        estimated_usd: 0.0,
        actual_usd: None,
        output_asset_id: None,
    });
    save_project_impl(root, &manifest)?;
    let payload = json!({
        "contents": [
            { "type": "prompt", "text": prompt },
            { "type": "first_frame", "url": image }
        ],
        "settings": { "resolution": "720p", "duration": duration },
        "options": { "external_task_id": job_id },
    });
    match submit_request(client, base_url, key, payload) {
        Ok(data) => {
            let remote_id = data["id"]
                .as_str()
                .filter(|id| !id.is_empty())
                .map(str::to_owned);
            let state = if remote_id.is_some() {
                JobState::Queued
            } else {
                JobState::Unknown
            };
            persist_job(root, &mut manifest, &job_id, state, remote_id)?;
        }
        Err(SubmitError::Rejected) => {
            persist_job(root, &mut manifest, &job_id, JobState::Failed, None)?
        }
        Err(SubmitError::Uncertain) => {
            persist_job(root, &mut manifest, &job_id, JobState::Unknown, None)?
        }
    }
    Ok(manifest)
}

fn query_request(
    client: &Client,
    base_url: &str,
    key: &str,
    task_id: &str,
    is_external_id: bool,
) -> Result<Value, String> {
    let response = client
        .get(format!("{base_url}{TASKS}"))
        .query(&[if is_external_id {
            ("external_task_ids", task_id)
        } else {
            ("task_ids", task_id)
        }])
        .bearer_auth(key)
        .send()
        .map_err(|_| "网络不可用，任务已保留；恢复网络后再次查询即可".to_string())?;
    if !response.status().is_success() {
        return Err("暂未查到可灵任务；本地不会重新提交，请稍后再查询或到可灵控制台核对".into());
    }
    let body: Value = response
        .json()
        .map_err(|_| "可灵任务响应无法解析；稍后再次查询".to_string())?;
    api_data(body)?
        .as_array()
        .and_then(|tasks| tasks.first())
        .cloned()
        .ok_or("暂未查到可灵任务；本地不会重新提交，请稍后再查询或到可灵控制台核对".into())
}

fn download_video(root: &Path, job_id: &str, url: &str) -> Result<String, String> {
    if !url.starts_with("https://") {
        return Err("可灵返回了不安全的视频下载地址".into());
    }
    let directory = root.join("media/generated");
    fs::create_dir_all(&directory).map_err(|_| "无法准备生成素材目录")?;
    let relative_path = format!("media/generated/{job_id}.mp4");
    let destination = root.join(&relative_path);
    if destination.is_file() {
        return Ok(relative_path);
    }
    let temp = directory.join(format!(".{job_id}.tmp"));
    let result = (|| -> Result<(), String> {
        let response = download_client()?
            .get(url)
            .send()
            .map_err(|_| "视频下载中断；可再次查询任务继续下载")?;
        if !response.status().is_success() {
            return Err("视频下载失败；可再次查询任务继续下载".into());
        }
        let mut file = File::create(&temp).map_err(|_| "无法写入生成视频")?;
        let mut limited = response.take(MAX_VIDEO_BYTES + 1);
        let written = io::copy(&mut limited, &mut file)
            .map_err(|_| "视频下载中断；可再次查询任务继续下载")?;
        if written == 0 || written > MAX_VIDEO_BYTES {
            return Err("生成视频为空或超过 500 MB".into());
        }
        file.sync_all().map_err(|_| "无法保存生成视频")?;
        fs::rename(&temp, &destination).map_err(|_| "无法保存生成视频")?;
        Ok(())
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temp);
    }
    result.map(|()| relative_path)
}

fn refresh_impl(
    root: &Path,
    job_id: &str,
    client: &Client,
    base_url: &str,
    key: &str,
) -> Result<ProjectManifestV2, String> {
    let mut manifest = open_project_impl(root)?;
    let job = manifest
        .jobs
        .iter()
        .find(|job| job.id == job_id && job.provider == "kling")
        .ok_or("可灵任务不存在")?
        .clone();
    if job.state == JobState::Succeeded {
        return Ok(manifest);
    }
    if job.state == JobState::Failed {
        return Err("该任务已失败；只有用户明确再次生成才会产生新请求".into());
    }
    let data = query_request(
        client,
        base_url,
        key,
        job.remote_id.as_deref().unwrap_or(&job.id),
        job.remote_id.is_none(),
    )?;
    let remote_id = data["id"]
        .as_str()
        .filter(|id| !id.is_empty())
        .map(str::to_owned);
    match data["status"].as_str().unwrap_or("") {
        "submitted" => persist_job(root, &mut manifest, job_id, JobState::Queued, remote_id)?,
        "processing" => persist_job(root, &mut manifest, job_id, JobState::Running, remote_id)?,
        "failed" => persist_job(root, &mut manifest, job_id, JobState::Failed, remote_id)?,
        "succeeded" => {
            let url = data["outputs"]
                .as_array()
                .and_then(|outputs| outputs.iter().find(|output| output["type"] == "video"))
                .and_then(|output| output["url"].as_str())
                .ok_or("可灵报告成功但没有视频地址，请稍后再次查询")?;
            persist_job(
                root,
                &mut manifest,
                job_id,
                JobState::DownloadPending,
                remote_id,
            )?;
            let relative_path = download_video(root, job_id, url)?;
            let asset_id = Uuid::new_v4().to_string();
            let duration_ms = manifest
                .shots
                .iter()
                .find(|shot| shot.id == job.shot_id)
                .map(|shot| u64::from(shot.duration_sec) * 1000);
            manifest.assets.push(MediaAsset {
                id: asset_id.clone(),
                kind: "video".into(),
                relative_path,
                duration_ms,
                width: None,
                height: None,
                missing: false,
            });
            let updated_job = manifest
                .jobs
                .iter_mut()
                .find(|item| item.id == job_id)
                .expect("job exists");
            updated_job.output_asset_id = Some(asset_id);
            updated_job.state = JobState::Succeeded;
            save_project_impl(root, &manifest)?;
        }
        _ => return Err("可灵返回了未知任务状态；本地不会重新提交".into()),
    }
    Ok(manifest)
}

#[tauri::command]
pub async fn submit_kling_image_video(
    root: PathBuf,
    shot_id: String,
) -> Result<ProjectManifestV2, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = JOB_LOCK
            .get_or_init(|| Mutex::new(()))
            .lock()
            .map_err(|_| "任务锁不可用")?;
        let key = kling_api_key()?;
        submit_impl(&root, &shot_id, &client()?, BASE_URL, &key)
    })
    .await
    .map_err(|_| "任务线程意外中断".to_string())?
}

#[tauri::command]
pub async fn refresh_kling_image_video(
    root: PathBuf,
    job_id: String,
) -> Result<ProjectManifestV2, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = JOB_LOCK
            .get_or_init(|| Mutex::new(()))
            .lock()
            .map_err(|_| "任务锁不可用")?;
        let key = kling_api_key()?;
        refresh_impl(&root, &job_id, &client()?, BASE_URL, &key)
    })
    .await
    .map_err(|_| "任务线程意外中断".to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ai::types::ShotDraft;
    use crate::project::create_project_impl;
    use std::net::TcpListener;
    use std::thread;

    fn project_with_photo() -> PathBuf {
        let root = std::env::temp_dir().join(format!("ai-video-kling-{}", Uuid::new_v4()));
        let mut manifest = create_project_impl(&root, "断网测试".into()).unwrap();
        fs::write(root.join("media/source/photo.jpg"), b"test-image").unwrap();
        manifest.assets.push(MediaAsset {
            id: "photo".into(),
            kind: "image".into(),
            relative_path: "media/source/photo.jpg".into(),
            duration_ms: None,
            width: Some(400),
            height: Some(400),
            missing: false,
        });
        manifest.shots.push(ShotDraft {
            id: "shot".into(),
            source_asset_id: "photo".into(),
            prompt: "小狗在厨房做饭".into(),
            duration_sec: 5,
            speaking: false,
            script: None,
            accepted_audio_asset_id: None,
            model_id: "kling-v2-5-turbo".into(),
        });
        save_project_impl(&root, &manifest).unwrap();
        root
    }

    #[test]
    fn lost_submit_response_is_recovered_by_get_without_second_post() {
        let root = project_with_photo();
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let base_url = format!("http://{}", listener.local_addr().unwrap());
        let server = thread::spawn(move || {
            let (mut first, _) = listener.accept().unwrap();
            first
                .set_read_timeout(Some(Duration::from_secs(5)))
                .unwrap();
            let mut buffer = [0u8; 8192];
            let count = first.read(&mut buffer).unwrap();
            let post = String::from_utf8_lossy(&buffer[..count]);
            assert!(post.starts_with("POST /image-to-video/kling-2.5-turbo "));
            assert!(post.contains("\"contents\""));
            assert!(post.contains("\"resolution\":\"720p\""));
            drop(first); // The server accepted the request, but its response was lost.
            let (mut second, _) = listener.accept().unwrap();
            second
                .set_read_timeout(Some(Duration::from_secs(5)))
                .unwrap();
            let count = second.read(&mut buffer).unwrap();
            let get = String::from_utf8_lossy(&buffer[..count]).to_string();
            let body = r#"{"code":0,"data":[{"id":"remote-1","status":"processing"}]}"#;
            let response = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                body.len()
            );
            use std::io::Write;
            second.write_all(response.as_bytes()).unwrap();
            get
        });
        let http = client().unwrap();
        let submitted = submit_impl(&root, "shot", &http, &base_url, "test-key").unwrap();
        assert_eq!(submitted.jobs[0].state, JobState::Unknown);
        let saved = open_project_impl(&root).unwrap();
        assert_eq!(saved.jobs[0].state, JobState::Unknown);
        assert!(submit_impl(&root, "shot", &http, &base_url, "test-key")
            .unwrap_err()
            .contains("不能重复提交"));
        let job_id = saved.jobs[0].id.clone();
        let recovered = refresh_impl(&root, &job_id, &http, &base_url, "test-key").unwrap();
        assert_eq!(recovered.jobs[0].state, JobState::Running);
        assert_eq!(recovered.jobs[0].remote_id.as_deref(), Some("remote-1"));
        assert!(server
            .join()
            .unwrap()
            .starts_with(&format!("GET /tasks?external_task_ids={job_id} ")));
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn downloaded_video_is_registered_after_restart_without_new_generation() {
        let root = project_with_photo();
        let mut manifest = open_project_impl(&root).unwrap();
        manifest.jobs.push(GenerationJob {
            id: "local-job".into(),
            shot_id: "shot".into(),
            provider: "kling".into(),
            model_id: "kling-v2-5-turbo".into(),
            state: JobState::DownloadPending,
            remote_id: Some("remote-2".into()),
            estimated_usd: 0.0,
            actual_usd: None,
            output_asset_id: None,
        });
        save_project_impl(&root, &manifest).unwrap();
        let generated = root.join("media/generated/local-job.mp4");
        fs::create_dir_all(generated.parent().unwrap()).unwrap();
        fs::write(&generated, b"existing-video").unwrap();

        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let base_url = format!("http://{}", listener.local_addr().unwrap());
        let server = thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            stream
                .set_read_timeout(Some(Duration::from_secs(5)))
                .unwrap();
            let mut buffer = [0u8; 8192];
            let count = stream.read(&mut buffer).unwrap();
            let request = String::from_utf8_lossy(&buffer[..count]).to_string();
            let body = r#"{"code":0,"data":[{"id":"remote-2","status":"succeeded","outputs":[{"type":"video","url":"https://example.com/output.mp4"}]}]}"#;
            let response = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                body.len()
            );
            use std::io::Write;
            stream.write_all(response.as_bytes()).unwrap();
            request
        });
        let recovered = refresh_impl(
            &root,
            "local-job",
            &client().unwrap(),
            &base_url,
            "test-key",
        )
        .unwrap();
        assert_eq!(recovered.jobs[0].state, JobState::Succeeded);
        let asset_id = recovered.jobs[0].output_asset_id.as_ref().unwrap();
        assert!(recovered
            .assets
            .iter()
            .any(|asset| asset.id == *asset_id
                && asset.relative_path == "media/generated/local-job.mp4"));
        assert!(server
            .join()
            .unwrap()
            .starts_with("GET /tasks?task_ids=remote-2 "));
        assert_eq!(fs::read(generated).unwrap(), b"existing-video");
        fs::remove_dir_all(root).unwrap();
    }
}
