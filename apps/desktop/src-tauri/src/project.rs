use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Component, Path, PathBuf};
use uuid::Uuid;
use crate::ai::types::{GenerationJob, ShotDraft};

const PROJECT_FILE: &str = "project.json";

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MediaAsset {
    pub id: String,
    pub kind: String,
    pub relative_path: String,
    pub duration_ms: Option<u64>,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub missing: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TimelineClip {
    pub id: String,
    pub asset_id: String,
    pub in_ms: u64,
    pub out_ms: u64,
    pub volume: f32,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Caption {
    pub id: String,
    pub start_ms: u64,
    pub end_ms: u64,
    pub text: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProjectManifestV2 {
    pub version: u8,
    pub id: String,
    pub title: String,
    pub assets: Vec<MediaAsset>,
    pub clips: Vec<TimelineClip>,
    pub captions: Vec<Caption>,
    pub publishing_copy: String,
    pub cover_time_ms: Option<u64>,
    #[serde(default)]
    pub shots: Vec<ShotDraft>,
    #[serde(default)]
    pub jobs: Vec<GenerationJob>,
    #[serde(default)]
    pub budget_usd: Option<f64>,
    #[serde(default)]
    pub studio: Option<serde_json::Value>,
    #[serde(default)]
    pub extensions: Option<serde_json::Value>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CreationBrief {
    pub id: String,
    pub source: String,
    pub original_text: String,
    pub final_text: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub idea_set_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub variant_id: Option<String>,
    pub created_at: u64,
    pub updated_at: u64,
}

fn valid_brief_id(id: &str) -> bool {
    (8..=80).contains(&id.len()) && id.bytes().all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
}

fn validate_creation_brief(brief: &CreationBrief) -> Result<(), String> {
    if !valid_brief_id(&brief.id) ||
        [brief.original_text.as_str(), brief.final_text.as_str()].iter().any(|text|
            text.trim().is_empty() || text.chars().count() > 10_000) ||
        brief.created_at > 9_007_199_254_740_991 || brief.updated_at > 9_007_199_254_740_991 ||
        brief.updated_at < brief.created_at {
        return Err("创作原文格式无效".into());
    }
    match brief.source.as_str() {
        "manual" if brief.idea_set_id.is_none() && brief.variant_id.is_none() => Ok(()),
        "agent" if brief.idea_set_id.as_deref().is_some_and(valid_brief_id) &&
            brief.variant_id.as_deref().is_some_and(valid_brief_id) => Ok(()),
        _ => Err("创作原文来源无效".into()),
    }
}

fn validate_title(title: &str) -> Result<(), String> {
    if title.trim().is_empty() || title == "." || title == ".." || title.contains(['/', '\\']) {
        return Err("请输入不含路径分隔符的项目名称".into());
    }
    Ok(())
}

pub(crate) fn validate_relative_path(relative_path: &str) -> Result<(), String> {
    let path = Path::new(relative_path);
    if path.as_os_str().is_empty() || !path.components().all(|part| matches!(part, Component::Normal(_))) {
        return Err(format!("项目素材路径不安全：{relative_path}"));
    }
    Ok(())
}

fn validate_manifest(manifest: &ProjectManifestV2) -> Result<(), String> {
    if manifest.version != 2 {
        return Err(format!("不支持的项目版本：{}", manifest.version));
    }
    validate_title(&manifest.title)?;
    if let Some(briefs) = manifest.extensions.as_ref().and_then(|extensions| extensions.get("creationBriefs")) {
        let briefs: Vec<CreationBrief> = serde_json::from_value(briefs.clone()).map_err(|_| "创作原文列表无效".to_string())?;
        for brief in &briefs { validate_creation_brief(brief)?; }
    }
    for asset in &manifest.assets {
        validate_relative_path(&asset.relative_path)?;
    }
    if manifest.budget_usd.is_some_and(|budget| !budget.is_finite() || budget < 0.0) {
        return Err("项目预算无效".into());
    }
    for shot in &manifest.shots {
        if shot.prompt.trim().is_empty() || !(4..=12).contains(&shot.duration_sec) {
            return Err("镜头提示词或时长无效".into());
        }
        if shot.speaking && shot.script.as_deref().is_none_or(|script| script.trim().is_empty()) {
            return Err("说话镜头缺少台词".into());
        }
    }
    for job in &manifest.jobs {
        if !job.estimated_usd.is_finite() || job.estimated_usd < 0.0 || job.actual_usd.is_some_and(|actual| !actual.is_finite() || actual < 0.0) {
            return Err("任务费用无效".into());
        }
    }
    Ok(())
}

pub fn create_project_impl(root: &Path, title: String) -> Result<ProjectManifestV2, String> {
    create_project_with_brief_impl(root, title, None)
}

pub fn create_project_with_brief_impl(root: &Path, title: String, initial_brief: Option<CreationBrief>) -> Result<ProjectManifestV2, String> {
    validate_title(&title)?;
    if let Some(brief) = &initial_brief { validate_creation_brief(brief)?; }
    if fs::symlink_metadata(root).is_ok() {
        return Err("项目目录已存在，请选择其他名称或打开现有项目".into());
    }
    let parent = root.parent().filter(|path| !path.as_os_str().is_empty()).unwrap_or(Path::new("."));
    let name = root.file_name().ok_or("项目目录名称无效")?.to_string_lossy();
    let staging = parent.join(format!(".{name}.{}.creating", Uuid::new_v4()));
    fs::create_dir(&staging).map_err(|err| format!("无法创建项目暂存目录：{err}"))?;
    let manifest = ProjectManifestV2 {
        version: 2,
        id: Uuid::new_v4().to_string(),
        title,
        assets: Vec::new(),
        clips: Vec::new(),
        captions: Vec::new(),
        publishing_copy: String::new(),
        cover_time_ms: None,
        shots: Vec::new(),
        jobs: Vec::new(),
        budget_usd: None,
        studio: None,
        extensions: initial_brief.map(|brief| serde_json::json!({ "creationBriefs": [brief] })),
    };
    let write = (|| {
        fs::create_dir_all(staging.join("media/source")).map_err(|err| err.to_string())?;
        fs::create_dir_all(staging.join("media/generated")).map_err(|err| err.to_string())?;
        fs::create_dir_all(staging.join("exports")).map_err(|err| err.to_string())?;
        save_project_impl(&staging, &manifest)?;
        if fs::symlink_metadata(root).is_ok() {
            return Err("项目目录已存在，请选择其他名称或打开现有项目".into());
        }
        fs::rename(&staging, root).map_err(|err| format!("无法完成项目创建：{err}"))
    })();
    if write.is_err() { let _ = fs::remove_dir_all(&staging); }
    write?;
    Ok(manifest)
}

pub fn open_project_impl(root: &Path) -> Result<ProjectManifestV2, String> {
    let bytes = fs::read(root.join(PROJECT_FILE)).map_err(|err| format!("无法读取项目：{err}"))?;
    let mut manifest: ProjectManifestV2 = serde_json::from_slice(&bytes).map_err(|err| format!("项目文件格式错误：{err}"))?;
    if manifest.version == 1 { manifest.version = 2; }
    validate_manifest(&manifest)?;
    Ok(manifest)
}

pub fn save_project_impl(root: &Path, manifest: &ProjectManifestV2) -> Result<(), String> {
    validate_manifest(manifest)?;
    if !root.is_dir() {
        return Err("项目目录不存在".into());
    }
    let bytes = serde_json::to_vec_pretty(manifest).map_err(|err| err.to_string())?;
    let temp = root.join(format!(".{PROJECT_FILE}.{}.tmp", Uuid::new_v4()));
    fs::write(&temp, bytes).map_err(|err| format!("无法保存项目：{err}"))?;
    fs::rename(&temp, root.join(PROJECT_FILE)).map_err(|err| format!("无法替换项目文件：{err}"))?;
    Ok(())
}

fn copy_project_files(source: &Path, destination: &Path) -> Result<(), String> {
    fs::create_dir(destination).map_err(|err| format!("无法创建备份目录：{err}"))?;
    for entry in fs::read_dir(source).map_err(|err| format!("无法读取项目目录：{err}"))? {
        let entry = entry.map_err(|err| err.to_string())?;
        let kind = entry.file_type().map_err(|err| err.to_string())?;
        if kind.is_symlink() { return Err("项目包含符号链接，无法安全备份".into()); }
        let target = destination.join(entry.file_name());
        if kind.is_dir() { copy_project_files(&entry.path(), &target)?; }
        else if kind.is_file() { fs::copy(entry.path(), target).map_err(|err| format!("备份项目文件失败：{err}"))?; }
        else { return Err("项目包含不支持的文件类型，无法安全备份".into()); }
    }
    Ok(())
}

pub fn backup_project_impl(root: &Path) -> Result<PathBuf, String> {
    if !root.is_dir() || !root.join(PROJECT_FILE).is_file() { return Err("项目目录或项目文件不存在".into()); }
    let parent = root.parent().ok_or("无法确定项目备份位置")?;
    let name = root.file_name().and_then(|part| part.to_str()).ok_or("项目目录名称无效")?;
    let destination = parent.join(format!("{name}-backup-{}", Uuid::new_v4()));
    let result = copy_project_files(root, &destination);
    if result.is_err() { let _ = fs::remove_dir_all(&destination); }
    result.map(|_| destination)
}

#[tauri::command]
pub async fn backup_project(root: PathBuf) -> Result<PathBuf, String> {
    tauri::async_runtime::spawn_blocking(move || backup_project_impl(&root))
        .await.map_err(|err| format!("备份任务失败：{err}"))?
}

#[tauri::command]
pub fn create_project(root: PathBuf, title: String, initial_brief: Option<CreationBrief>) -> Result<ProjectManifestV2, String> {
    create_project_with_brief_impl(&root, title, initial_brief)
}

#[tauri::command]
pub fn open_project(root: PathBuf) -> Result<ProjectManifestV2, String> {
    open_project_impl(&root)
}

#[tauri::command]
pub fn save_project(root: PathBuf, manifest: ProjectManifestV2) -> Result<(), String> {
    save_project_impl(&root, &manifest)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ai::types::{JobState, ShotDraft, GenerationJob};

    fn test_root() -> PathBuf {
        std::env::temp_dir().join(format!("ai-video-project-{}", Uuid::new_v4()))
    }

    fn test_brief(text: &str) -> CreationBrief {
        CreationBrief { id: "brief-native-0001".into(), source: "manual".into(),
            original_text: text.into(), final_text: text.into(), idea_set_id: None, variant_id: None,
            created_at: 10, updated_at: 10 }
    }

    #[test]
    fn project_first_write_contains_brief_without_a_followup_save() {
        let root = test_root();
        let brief = test_brief("🐶做饭\n然后上菜");
        let created = create_project_with_brief_impl(&root, "原子项目".into(), Some(brief.clone())).unwrap();
        let on_disk: serde_json::Value = serde_json::from_slice(&fs::read(root.join(PROJECT_FILE)).unwrap()).unwrap();
        assert_eq!(on_disk["extensions"]["creationBriefs"][0], serde_json::to_value(&brief).unwrap());
        assert_eq!(open_project_impl(&root).unwrap(), created);
        assert!(root.join("media/source").is_dir());
        let original = fs::read(root.join(PROJECT_FILE)).unwrap();
        assert!(create_project_with_brief_impl(&root, "别的项目".into(), Some(test_brief("覆盖"))).is_err());
        assert_eq!(fs::read(root.join(PROJECT_FILE)).unwrap(), original);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn invalid_initial_brief_never_creates_the_project_directory() {
        let root = test_root();
        let mut brief = test_brief("正文");
        brief.source = "agent".into();
        assert!(create_project_with_brief_impl(&root, "项目".into(), Some(brief)).is_err());
        assert!(!root.exists());
    }

    #[test]
    fn backup_preserves_project_and_media_before_conflict_resolution() {
        let root = test_root();
        let _ = create_project_impl(&root, "演示项目".into()).unwrap();
        let media = root.join("media/source/photo.jpg");
        fs::write(&media, b"original-photo").unwrap();
        let backup = backup_project_impl(&root).unwrap();
        fs::write(&media, b"changed-photo").unwrap();
        assert_eq!(fs::read(backup.join("media/source/photo.jpg")).unwrap(), b"original-photo");
        assert!(backup.join(PROJECT_FILE).is_file());
        fs::remove_dir_all(root).unwrap();
        fs::remove_dir_all(backup).unwrap();
    }

    #[test]
    fn project_create_save_open_and_move() {
        let root = test_root();
        let mut manifest = create_project_impl(&root, "演示项目".into()).unwrap();
        assert_eq!(manifest.version, 2);
        assert!(root.join("media/source").is_dir());
        manifest.publishing_copy = "第一条视频".into();
        manifest.studio = Some(serde_json::json!({"version": 1, "activeEpisodeId": "ep-1", "characters": [], "episodes": [{"id": "ep-1", "title": "第 1 集", "nodes": [], "edges": [], "clips": [], "captions": []}]}));
        manifest.extensions = Some(serde_json::json!({"canvas": {"version": 1, "episodeGraphs": {"ep-1": {"nodes": [], "edges": [], "viewport": {"x": 0, "y": 0, "zoom": 1}}}}, "futurePlugin": {"data": "preserved"}}));
        save_project_impl(&root, &manifest).unwrap();
        let moved = test_root();
        fs::rename(&root, &moved).unwrap();
        assert_eq!(open_project_impl(&moved).unwrap(), manifest);
        fs::remove_dir_all(moved).unwrap();
    }

    #[test]
    fn project_rejects_parent_path() {
        let root = test_root();
        let mut manifest = create_project_impl(&root, "安全项目".into()).unwrap();
        manifest.assets.push(MediaAsset {
            id: "a".into(), kind: "video".into(), relative_path: "../outside.mp4".into(),
            duration_ms: Some(1000), width: None, height: None, missing: false,
        });
        assert!(save_project_impl(&root, &manifest).is_err());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn project_migrates_v1_in_memory_without_implicit_write() {
        let root = test_root();
        let manifest = create_project_impl(&root, "旧项目".into()).unwrap();
        let mut legacy = serde_json::to_value(&manifest).unwrap();
        legacy["version"] = 1.into();
        let object = legacy.as_object_mut().unwrap();
        object.remove("shots"); object.remove("jobs"); object.remove("budgetUsd");
        fs::write(root.join(PROJECT_FILE), serde_json::to_vec(&legacy).unwrap()).unwrap();
        let migrated = open_project_impl(&root).unwrap();
        assert_eq!(migrated.version, 2);
        assert!(migrated.shots.is_empty() && migrated.jobs.is_empty());
        let on_disk: serde_json::Value = serde_json::from_slice(&fs::read(root.join(PROJECT_FILE)).unwrap()).unwrap();
        assert_eq!(on_disk["version"], 1);
        save_project_impl(&root, &migrated).unwrap();
        let on_disk: serde_json::Value = serde_json::from_slice(&fs::read(root.join(PROJECT_FILE)).unwrap()).unwrap();
        assert_eq!(on_disk["version"], 2);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn project_persists_shot_and_job_but_rejects_unknown_job_state() {
        let root = test_root();
        let mut manifest = create_project_impl(&root, "生成项目".into()).unwrap();
        manifest.shots.push(ShotDraft { id: "shot-1".into(), source_asset_id: "asset-1".into(), prompt: "在雨中跳舞".into(), duration_sec: 5, speaking: false, script: None, accepted_audio_asset_id: None, model_id: "seedance-15-pro".into() });
        manifest.jobs.push(GenerationJob { id: "job-1".into(), shot_id: "shot-1".into(), provider: "hedra".into(), model_id: "seedance-15-pro".into(), state: JobState::Queued, remote_id: Some("remote-123".into()), estimated_usd: 0.125, actual_usd: None, output_asset_id: None });
        save_project_impl(&root, &manifest).unwrap();
        assert_eq!(open_project_impl(&root).unwrap(), manifest);
        let mut invalid = serde_json::to_value(&manifest).unwrap();
        invalid["jobs"][0]["state"] = "unexpected".into();
        fs::write(root.join(PROJECT_FILE), serde_json::to_vec(&invalid).unwrap()).unwrap();
        assert!(open_project_impl(&root).is_err());
        fs::remove_dir_all(root).unwrap();
    }
}
