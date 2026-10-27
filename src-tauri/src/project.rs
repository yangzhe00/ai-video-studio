use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Component, Path, PathBuf};
use uuid::Uuid;

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
pub struct ProjectManifestV1 {
    pub version: u8,
    pub id: String,
    pub title: String,
    pub assets: Vec<MediaAsset>,
    pub clips: Vec<TimelineClip>,
    pub captions: Vec<Caption>,
    pub publishing_copy: String,
    pub cover_time_ms: Option<u64>,
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

fn validate_manifest(manifest: &ProjectManifestV1) -> Result<(), String> {
    if manifest.version != 1 {
        return Err(format!("不支持的项目版本：{}", manifest.version));
    }
    validate_title(&manifest.title)?;
    for asset in &manifest.assets {
        validate_relative_path(&asset.relative_path)?;
    }
    Ok(())
}

pub fn create_project_impl(root: &Path, title: String) -> Result<ProjectManifestV1, String> {
    validate_title(&title)?;
    if root.exists() {
        return Err("项目目录已存在，请选择其他名称或打开现有项目".into());
    }
    fs::create_dir(root).map_err(|err| format!("无法创建项目目录：{err}"))?;
    fs::create_dir_all(root.join("media/source")).map_err(|err| err.to_string())?;
    fs::create_dir_all(root.join("media/generated")).map_err(|err| err.to_string())?;
    fs::create_dir_all(root.join("exports")).map_err(|err| err.to_string())?;

    let manifest = ProjectManifestV1 {
        version: 1,
        id: Uuid::new_v4().to_string(),
        title,
        assets: Vec::new(),
        clips: Vec::new(),
        captions: Vec::new(),
        publishing_copy: String::new(),
        cover_time_ms: None,
    };
    save_project_impl(root, &manifest)?;
    Ok(manifest)
}

pub fn open_project_impl(root: &Path) -> Result<ProjectManifestV1, String> {
    let bytes = fs::read(root.join(PROJECT_FILE)).map_err(|err| format!("无法读取项目：{err}"))?;
    let manifest: ProjectManifestV1 = serde_json::from_slice(&bytes).map_err(|err| format!("项目文件格式错误：{err}"))?;
    validate_manifest(&manifest)?;
    Ok(manifest)
}

pub fn save_project_impl(root: &Path, manifest: &ProjectManifestV1) -> Result<(), String> {
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

#[tauri::command]
pub fn create_project(root: PathBuf, title: String) -> Result<ProjectManifestV1, String> {
    create_project_impl(&root, title)
}

#[tauri::command]
pub fn open_project(root: PathBuf) -> Result<ProjectManifestV1, String> {
    open_project_impl(&root)
}

#[tauri::command]
pub fn save_project(root: PathBuf, manifest: ProjectManifestV1) -> Result<(), String> {
    save_project_impl(&root, &manifest)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_root() -> PathBuf {
        std::env::temp_dir().join(format!("ai-video-project-{}", Uuid::new_v4()))
    }

    #[test]
    fn project_create_save_open_and_move() {
        let root = test_root();
        let mut manifest = create_project_impl(&root, "演示项目".into()).unwrap();
        assert_eq!(manifest.version, 1);
        assert!(root.join("media/source").is_dir());
        manifest.publishing_copy = "第一条视频".into();
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
}
