use crate::project::{open_project_impl, validate_relative_path, ProjectManifestV1};
use serde::Serialize;
use serde_json::Value;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use uuid::Uuid;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportArtifacts {
    pub video_relative_path: String,
    pub cover_relative_path: String,
}

fn tool_path(name: &str) -> PathBuf {
    let variable = if name == "ffmpeg" { "AI_VIDEO_FFMPEG" } else { "AI_VIDEO_FFPROBE" };
    std::env::var_os(variable).map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("binaries").join(name))
}

fn run_ffmpeg(binary: &Path, args: &[&str], output: &Path) -> Result<(), String> {
    let result = Command::new(binary).args(["-nostdin", "-hide_banner", "-loglevel", "error", "-y"])
        .args(args).arg(output).output()
        .map_err(|err| format!("无法启动随应用提供的 ffmpeg：{err}"))?;
    if !result.status.success() {
        let detail = String::from_utf8_lossy(&result.stderr);
        return Err(format!("视频处理失败：{}", detail.chars().take(800).collect::<String>()));
    }
    if !output.is_file() { return Err("ffmpeg 未生成预期文件".into()); }
    Ok(())
}

fn has_audio(binary: &Path, source: &Path) -> Result<bool, String> {
    let result = Command::new(binary)
        .args(["-v", "error", "-select_streams", "a", "-show_entries", "stream=codec_type", "-of", "json"])
        .arg(source).output().map_err(|err| format!("无法启动 ffprobe：{err}"))?;
    if !result.status.success() { return Err("无法读取源视频的音轨".into()); }
    let value: Value = serde_json::from_slice(&result.stdout).map_err(|err| err.to_string())?;
    Ok(value["streams"].as_array().is_some_and(|streams| !streams.is_empty()))
}

fn ass_time(ms: u64) -> String {
    let centiseconds = ms / 10;
    format!("{}:{:02}:{:02}.{:02}", centiseconds / 360000, (centiseconds / 6000) % 60, (centiseconds / 100) % 60, centiseconds % 100)
}

fn ass_text(text: &str) -> String {
    text.replace('\\', "\\\\").replace('{', "\\{").replace('}', "\\}").replace("\r\n", "\n").replace('\n', "\\N")
}

fn write_ass(path: &Path, manifest: &ProjectManifestV1) -> Result<(), String> {
    let mut body = String::from("[Script Info]\nScriptType: v4.00+\nPlayResX: 1080\nPlayResY: 1920\nWrapStyle: 2\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Default,Arial,54,&H00FFFFFF,&H000000FF,&H00000000,&H88000000,0,0,0,0,100,100,0,0,1,3,1,2,60,60,170,1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n");
    for caption in &manifest.captions {
        body.push_str(&format!("Dialogue: 0,{},{},Default,,0,0,0,,{}\n", ass_time(caption.start_ms), ass_time(caption.end_ms), ass_text(&caption.text)));
    }
    fs::write(path, body).map_err(|err| format!("无法写入字幕：{err}"))
}

fn validate_export(manifest: &ProjectManifestV1, root: &Path) -> Result<u64, String> {
    if manifest.clips.is_empty() { return Err("时间线为空，请先添加片段".into()); }
    let mut total_ms = 0u64;
    let canonical_root = fs::canonicalize(root).map_err(|err| format!("项目目录不可读取：{err}"))?;
    for (index, clip) in manifest.clips.iter().enumerate() {
        let asset = manifest.assets.iter().find(|asset| asset.id == clip.asset_id)
            .ok_or_else(|| format!("第 {} 个片段的素材不存在", index + 1))?;
        if asset.missing { return Err(format!("第 {} 个片段的素材已丢失", index + 1)); }
        if asset.kind != "image" && asset.kind != "video" { return Err(format!("第 {} 个片段不是画面素材", index + 1)); }
        validate_relative_path(&asset.relative_path)?;
        let source = fs::canonicalize(root.join(&asset.relative_path)).map_err(|_| format!("第 {} 个片段的素材文件已丢失", index + 1))?;
        if !source.starts_with(&canonical_root) { return Err("素材路径越过项目目录".into()); }
        let max_ms = if asset.kind == "image" { 5000 } else { asset.duration_ms.unwrap_or(0) };
        if clip.out_ms <= clip.in_ms || clip.out_ms > max_ms || !clip.volume.is_finite() || !(0.0..=1.0).contains(&clip.volume) {
            return Err(format!("第 {} 个片段的裁剪或音量参数无效", index + 1));
        }
        total_ms = total_ms.checked_add(clip.out_ms - clip.in_ms).ok_or("时间线过长")?;
    }
    for caption in &manifest.captions {
        if caption.start_ms >= caption.end_ms || caption.end_ms > total_ms { return Err("字幕时间超出成片范围".into()); }
    }
    if manifest.cover_time_ms.unwrap_or(0) >= total_ms { return Err("封面时间超出成片范围".into()); }
    Ok(total_ms)
}

pub fn export_project_impl(root: &Path, output_name: &str, ffmpeg: &Path, ffprobe: &Path) -> Result<ExportArtifacts, String> {
    if output_name.is_empty() || output_name.len() > 80 || !output_name.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_') {
        return Err("导出文件名只能使用英文字母、数字、横线和下划线".into());
    }
    let manifest = open_project_impl(root)?;
    let total_ms = validate_export(&manifest, root)?;
    let exports = root.join("exports");
    fs::create_dir_all(&exports).map_err(|err| format!("无法创建导出目录：{err}"))?;
    if exports.join(format!("{output_name}.mp4")).exists() || exports.join(format!("{output_name}-cover.png")).exists() {
        return Err("同名导出文件已存在，请更换名称".into());
    }
    let temp = exports.join(format!(".export-{}", Uuid::new_v4()));
    fs::create_dir(&temp).map_err(|err| format!("无法创建导出临时目录：{err}"))?;
    let result = (|| {
        let mut concat = String::new();
        let filter = "scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2,setsar=1,format=yuv420p";
        for (index, clip) in manifest.clips.iter().enumerate() {
            let asset = manifest.assets.iter().find(|asset| asset.id == clip.asset_id).unwrap();
            let source = root.join(&asset.relative_path);
            let segment = temp.join(format!("segment-{index:04}.mp4"));
            let source_s = source.to_string_lossy().into_owned();
            let segment_seconds = format!("{:.3}", (clip.out_ms - clip.in_ms) as f64 / 1000.0);
            let start_seconds = format!("{:.3}", clip.in_ms as f64 / 1000.0);
            let volume = format!("volume={:.3}", clip.volume);
            let audio_present = asset.kind == "video" && has_audio(ffprobe, &source)?;
            let mut args = Vec::<&str>::new();
            if asset.kind == "image" { args.extend(["-loop", "1", "-framerate", "30"]); }
            else { args.extend(["-ss", &start_seconds]); }
            args.extend(["-i", &source_s]);
            if !audio_present { args.extend(["-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=44100"]); }
            args.extend(["-t", &segment_seconds, "-vf", filter, "-map", "0:v:0"]);
            if audio_present { args.extend(["-map", "0:a:0", "-af", &volume]); }
            else { args.extend(["-map", "1:a:0"]); }
            args.extend(["-r", "30", "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-pix_fmt", "yuv420p", "-c:a", "aac", "-ar", "44100", "-ac", "2", "-shortest", "-movflags", "+faststart"]);
            run_ffmpeg(ffmpeg, &args, &segment)?;
            concat.push_str(&format!("file 'segment-{index:04}.mp4'\n"));
        }
        let list = temp.join("concat.txt");
        fs::write(&list, concat).map_err(|err| err.to_string())?;
        let joined = temp.join("joined.mp4");
        run_ffmpeg(ffmpeg, &["-f", "concat", "-safe", "0", "-i", &list.to_string_lossy(), "-c", "copy"], &joined)?;
        let subtitled = temp.join("final.mp4");
        if manifest.captions.is_empty() {
            fs::copy(&joined, &subtitled).map_err(|err| err.to_string())?;
        } else {
            let subtitle_path = std::env::temp_dir().join(format!("ai-video-captions-{}.ass", Uuid::new_v4()));
            write_ass(&subtitle_path, &manifest)?;
            let subtitle_filter = format!("subtitles={}", subtitle_path.to_string_lossy());
            let subtitle_result = run_ffmpeg(ffmpeg, &["-i", &joined.to_string_lossy(), "-vf", &subtitle_filter, "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-c:a", "copy", "-movflags", "+faststart"], &subtitled);
            let _ = fs::remove_file(subtitle_path);
            subtitle_result?;
        }
        let cover = temp.join("cover.png");
        let cover_seconds = format!("{:.3}", manifest.cover_time_ms.unwrap_or(0).min(total_ms.saturating_sub(100)) as f64 / 1000.0);
        run_ffmpeg(ffmpeg, &["-ss", &cover_seconds, "-i", &subtitled.to_string_lossy(), "-frames:v", "1"], &cover)?;
        let video_relative_path = format!("exports/{output_name}.mp4");
        let cover_relative_path = format!("exports/{output_name}-cover.png");
        let video_destination = root.join(&video_relative_path);
        let cover_destination = root.join(&cover_relative_path);
        if video_destination.exists() || cover_destination.exists() { return Err("同名导出文件已存在，请更换名称".into()); }
        fs::rename(subtitled, &video_destination).map_err(|err| format!("无法保存视频：{err}"))?;
        if let Err(err) = fs::rename(cover, &cover_destination) {
            let _ = fs::remove_file(&video_destination);
            return Err(format!("无法保存封面：{err}"));
        }
        Ok(ExportArtifacts { video_relative_path, cover_relative_path })
    })();
    let _ = fs::remove_dir_all(temp);
    result
}

#[tauri::command]
pub fn export_project(root: PathBuf, output_name: String) -> Result<ExportArtifacts, String> {
    export_project_impl(&root, &output_name, &tool_path("ffmpeg"), &tool_path("ffprobe"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::project::{create_project_impl, save_project_impl, MediaAsset, TimelineClip, Caption};

    #[test]
    fn export_rejects_empty_and_missing_timeline() {
        let root = std::env::temp_dir().join(format!("ai-video-export-{}", Uuid::new_v4()));
        let mut manifest = create_project_impl(&root, "导出测试".into()).unwrap();
        assert!(export_project_impl(&root, "empty", Path::new("/missing/ffmpeg"), Path::new("/missing/ffprobe")).unwrap_err().contains("时间线为空"));
        manifest.assets.push(MediaAsset { id: "a".into(), kind: "video".into(), relative_path: "media/source/missing.mp4".into(), duration_ms: Some(1000), width: Some(320), height: Some(240), missing: false });
        manifest.clips.push(TimelineClip { id: "c".into(), asset_id: "a".into(), in_ms: 0, out_ms: 1000, volume: 1.0 });
        save_project_impl(&root, &manifest).unwrap();
        assert!(export_project_impl(&root, "missing", Path::new("/missing/ffmpeg"), Path::new("/missing/ffprobe")).unwrap_err().contains("素材文件已丢失"));
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn export_real_fixture_when_provided() {
        let (Ok(source), Ok(photo), Ok(ffmpeg), Ok(ffprobe)) = (
            std::env::var("AI_VIDEO_TEST_MP4"), std::env::var("AI_VIDEO_TEST_PNG"), std::env::var("AI_VIDEO_FFMPEG"), std::env::var("AI_VIDEO_FFPROBE")
        ) else { return; };
        let root = std::env::temp_dir().join(format!("ai-video-中文-{}", Uuid::new_v4()));
        let mut manifest = create_project_impl(&root, "导出测试".into()).unwrap();
        fs::copy(&source, root.join("media/source/video.mp4")).unwrap();
        fs::copy(&photo, root.join("media/source/photo.png")).unwrap();
        manifest.assets.push(MediaAsset { id: "a".into(), kind: "video".into(), relative_path: "media/source/video.mp4".into(), duration_ms: Some(1000), width: Some(320), height: Some(240), missing: false });
        manifest.clips.push(TimelineClip { id: "c".into(), asset_id: "a".into(), in_ms: 0, out_ms: 1000, volume: 0.5 });
        manifest.assets.push(MediaAsset { id: "b".into(), kind: "image".into(), relative_path: "media/source/photo.png".into(), duration_ms: None, width: Some(320), height: Some(240), missing: false });
        manifest.clips.push(TimelineClip { id: "d".into(), asset_id: "b".into(), in_ms: 0, out_ms: 1000, volume: 1.0 });
        manifest.captions.push(Caption { id: "s".into(), start_ms: 0, end_ms: 900, text: "妈妈说：\"你好\"\n第二行".into() });
        save_project_impl(&root, &manifest).unwrap();
        let output = export_project_impl(&root, "demo", Path::new(&ffmpeg), Path::new(&ffprobe)).unwrap();
        assert!(root.join(&output.video_relative_path).is_file());
        assert!(root.join(&output.cover_relative_path).is_file());
        let probe = Command::new(&ffprobe).args(["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "json"])
            .arg(root.join(&output.video_relative_path)).output().unwrap();
        assert!(probe.status.success());
        let details: Value = serde_json::from_slice(&probe.stdout).unwrap();
        assert_eq!(details["streams"][0]["width"], 1080);
        assert_eq!(details["streams"][0]["height"], 1920);
        fs::remove_dir_all(root).unwrap();
    }
}
