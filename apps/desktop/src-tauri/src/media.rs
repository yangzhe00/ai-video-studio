use crate::project::{open_project_impl, validate_relative_path, MediaAsset};
use serde_json::Value;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use tauri::ipc::Response;
use uuid::Uuid;

fn ffprobe_path() -> PathBuf {
    std::env::var_os("AI_VIDEO_FFPROBE")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("binaries/ffprobe"))
}

pub(crate) fn probe(source: &Path, binary: &Path) -> Result<(String, Option<u64>, Option<u32>, Option<u32>), String> {
    let result = Command::new(binary)
        .args(["-v", "error", "-show_entries", "stream=codec_type,width,height:format=format_name,duration", "-of", "json"])
        .arg(source)
        .output()
        .map_err(|err| format!("无法运行随应用提供的 ffprobe：{err}"))?;
    if !result.status.success() {
        return Err("无法识别或读取这个素材文件，请选择有效的照片、视频或音频".into());
    }
    let value: Value = serde_json::from_slice(&result.stdout).map_err(|_| "素材探测结果无效".to_string())?;
    let streams = value["streams"].as_array().ok_or("素材中没有可读取的媒体流")?;
    let picture = streams.iter().find(|stream| stream["codec_type"] == "video");
    let sound = streams.iter().find(|stream| stream["codec_type"] == "audio");
    let seconds = value["format"]["duration"].as_str().and_then(|raw| raw.parse::<f64>().ok());
    let duration_ms = seconds.filter(|n| n.is_finite() && *n > 0.0).map(|n| (n * 1000.0).round() as u64);
    // ffprobe's image2 demuxer assigns a synthetic frame duration to still photos.
    // The container format, rather than duration alone, distinguishes these from videos.
    let image_container = value["format"]["format_name"].as_str().is_some_and(|names| {
        names.split(',').any(|name| name == "image2" || name.ends_with("_pipe"))
    });
    let (kind, width, height) = if let Some(stream) = picture {
        let width = stream["width"].as_u64().and_then(|value| u32::try_from(value).ok());
        let height = stream["height"].as_u64().and_then(|value| u32::try_from(value).ok());
        if width.unwrap_or(0) == 0 || height.unwrap_or(0) == 0 { return Err("画面尺寸无效".into()); }
        (if image_container || duration_ms.is_none() { "image" } else { "video" }, width, height)
    } else if sound.is_some() && duration_ms.is_some() {
        ("audio", None, None)
    } else {
        return Err("素材没有可用的图像、视频或音频流".into());
    };
    Ok((kind.into(), if kind == "image" { None } else { duration_ms }, width, height))
}

pub fn import_asset_impl(root: &Path, source: &Path, binary: &Path) -> Result<MediaAsset, String> {
    if !root.join("project.json").is_file() { return Err("请先打开有效项目".into()); }
    if !source.is_file() { return Err("请选择一个素材文件，不能选择文件夹".into()); }
    let (kind, duration_ms, width, height) = probe(source, binary)?;
    let extension = source.extension().and_then(|ext| ext.to_str()).unwrap_or("bin").to_ascii_lowercase();
    let extension_matches = match kind.as_str() {
        "image" => ["png", "jpg", "jpeg", "webp", "heic", "heif", "bmp", "tif", "tiff"].contains(&extension.as_str()),
        "video" => ["mp4", "mov", "m4v", "webm", "mkv"].contains(&extension.as_str()),
        "audio" => ["mp3", "wav", "m4a", "aac", "flac", "ogg"].contains(&extension.as_str()),
        _ => false,
    };
    if !extension_matches { return Err("文件扩展名与媒体内容不匹配，或格式暂不受支持".into()); }
    let safe_extension = if extension.len() <= 8 && extension.chars().all(|ch| ch.is_ascii_alphanumeric()) { extension } else { "bin".into() };
    let id = Uuid::new_v4().to_string();
    let relative_path = format!("media/source/{id}.{safe_extension}");
    let destination = root.join(&relative_path);
    fs::create_dir_all(root.join("media/source")).map_err(|err| format!("无法准备素材目录：{err}"))?;
    fs::copy(source, &destination).map_err(|err| format!("无法复制素材：{err}"))?;
    Ok(MediaAsset { id, kind, relative_path, duration_ms, width, height, missing: false })
}

pub fn audit_assets_impl(root: &Path, assets: Vec<MediaAsset>) -> Vec<MediaAsset> {
    assets.into_iter().map(|mut asset| {
        asset.missing = validate_relative_path(&asset.relative_path).is_err() || !root.join(&asset.relative_path).is_file();
        asset
    }).collect()
}

#[tauri::command]
pub fn import_asset(root: PathBuf, source: PathBuf) -> Result<MediaAsset, String> {
    import_asset_impl(&root, &source, &ffprobe_path())
}

#[tauri::command]
pub fn audit_assets(root: PathBuf, assets: Vec<MediaAsset>) -> Vec<MediaAsset> {
    audit_assets_impl(&root, assets)
}

pub fn read_asset_impl(root: &Path, asset_id: &str) -> Result<Vec<u8>, String> {
    let manifest = open_project_impl(root)?;
    let asset = manifest.assets.iter().find(|asset| asset.id == asset_id).ok_or("素材不在当前项目中")?;
    validate_relative_path(&asset.relative_path)?;
    let canonical_root = fs::canonicalize(root).map_err(|err| format!("无法读取项目目录：{err}"))?;
    let canonical_asset = fs::canonicalize(root.join(&asset.relative_path)).map_err(|err| format!("素材文件已丢失：{err}"))?;
    if !canonical_asset.starts_with(canonical_root) { return Err("素材路径越过项目目录".into()); }
    let size = fs::metadata(&canonical_asset).map_err(|err| err.to_string())?.len();
    if size > 100 * 1024 * 1024 { return Err("该素材超过 100 MB，暂无法在当前预览器中打开".into()); }
    fs::read(canonical_asset).map_err(|err| format!("无法读取素材：{err}"))
}

#[tauri::command]
pub fn read_asset(root: PathBuf, asset_id: String) -> Result<Response, String> {
    Ok(Response::new(read_asset_impl(&root, &asset_id)?))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::project::{create_project_impl, save_project_impl};

    #[test]
    fn media_rejects_folder_and_marks_deleted_asset() {
        let root = std::env::temp_dir().join(format!("ai-video-media-{}", Uuid::new_v4()));
        create_project_impl(&root, "媒体测试".into()).unwrap();
        assert!(import_asset_impl(&root, &root, Path::new("/missing/ffprobe")).unwrap_err().contains("文件夹"));
        let assets = vec![MediaAsset { id: "a".into(), kind: "video".into(), relative_path: "media/source/removed.mp4".into(), duration_ms: Some(1000), width: Some(100), height: Some(100), missing: false }];
        assert!(audit_assets_impl(&root, assets)[0].missing);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn media_imports_real_fixtures_when_provided() {
        let (Ok(png), Ok(mp4), Ok(probe_binary)) = (
            std::env::var("AI_VIDEO_TEST_PNG"),
            std::env::var("AI_VIDEO_TEST_MP4"),
            std::env::var("AI_VIDEO_FFPROBE"),
        ) else { return; };
        let root = std::env::temp_dir().join(format!("ai-video-media-{}", Uuid::new_v4()));
        let mut manifest = create_project_impl(&root, "导入测试".into()).unwrap();
        let image = import_asset_impl(&root, Path::new(&png), Path::new(&probe_binary)).unwrap();
        assert_eq!(image.kind, "image");
        assert_eq!((image.width, image.height), (Some(320), Some(240)));
        let video = import_asset_impl(&root, Path::new(&mp4), Path::new(&probe_binary)).unwrap();
        assert_eq!(video.kind, "video");
        assert_eq!(video.duration_ms, Some(1000));
        assert_eq!(fs::read(&mp4).unwrap(), fs::read(root.join(&video.relative_path)).unwrap());
        manifest.assets = vec![image, video.clone()];
        save_project_impl(&root, &manifest).unwrap();
        assert_eq!(read_asset_impl(&root, &video.id).unwrap(), fs::read(&mp4).unwrap());
        fs::remove_file(root.join(&video.relative_path)).unwrap();
        assert!(audit_assets_impl(&root, vec![video])[0].missing);
        let fake = root.join("fake.mp4");
        fs::write(&fake, "not a video").unwrap();
        assert!(import_asset_impl(&root, &fake, Path::new(&probe_binary)).is_err());
        fs::copy(&png, &fake).unwrap();
        assert!(import_asset_impl(&root, &fake, Path::new(&probe_binary)).unwrap_err().contains("扩展名"));
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn media_imports_jpeg_even_when_ffprobe_reports_frame_duration() {
        let (Ok(jpg), Ok(probe_binary)) = (
            std::env::var("AI_VIDEO_TEST_JPG"),
            std::env::var("AI_VIDEO_FFPROBE"),
        ) else {
            return;
        };
        let root = std::env::temp_dir().join(format!("ai-video-jpeg-{}", Uuid::new_v4()));
        create_project_impl(&root, "照片导入测试".into()).unwrap();
        let image = import_asset_impl(&root, Path::new(&jpg), Path::new(&probe_binary)).unwrap();
        assert_eq!(image.kind, "image");
        assert_eq!(image.duration_ms, None);
        assert!(image.width.unwrap_or(0) > 0 && image.height.unwrap_or(0) > 0);
        fs::remove_dir_all(root).unwrap();
    }
}
