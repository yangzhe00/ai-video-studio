"""合成服务：ffmpeg 拼 装 9:16 成片（FR-C-04）+ Mock 占位媒体生成。

真实链路：片段视频（可灵产物）+ TTS 音频 + 字幕（drawtext）+ 模板样式 → mp4。
Mock 链路：片段用纯色占位视频、TTS 用静音音轨，保证端到端演示跑通。
"""

import os
import subprocess

from app.core.config import settings
from app.core.errors import AppError
from app.providers.mock.storage import LocalStorageProvider

storage = LocalStorageProvider()


def make_placeholder_video(duration_sec: float) -> str:
    """生成 9:16 纯色占位视频（Mock 片段），返回存储 key。

    720x1280 蓝灰底 + 段落编号文字，供演示预览辨识。
    """
    key = f"clips/{os.urandom(8).hex()}.mp4"
    out = storage.local_path(key)
    os.makedirs(os.path.dirname(out), exist_ok=True)
    duration = max(1.0, min(duration_sec, 60.0))
    cmd = [
        "ffmpeg", "-y",
        "-f", "lavfi", "-i", f"color=c=0x3355aa:s=720x1280:d={duration}:r=24",
        "-vf", "drawtext=text='Mock Clip':fontcolor=white:fontsize=48:x=(w-text_w)/2:y=(h-text_h)/2",
        "-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "veryfast",
        out,
    ]
    _run(cmd)
    return key


def make_placeholder_image(prompt: str) -> str:
    """生成 9:16 占位图（Mock 生图产物），返回存储 key。"""
    key = f"assets/gen_{os.urandom(8).hex()}.png"
    out = storage.local_path(key)
    os.makedirs(os.path.dirname(out), exist_ok=True)
    label = (prompt or "AI 生图")[:18].replace("'", "").replace(":", "")
    cmd = [
        "ffmpeg", "-y",
        "-f", "lavfi", "-i", "color=c=0x6c8ebf:s=720x1280:d=1",
        "-vf", f"drawtext=text='{label}':fontcolor=white:fontsize=40:x=(w-text_w)/2:y=(h-text_h)/2",
        "-frames:v", "1", out,
    ]
    _run(cmd)
    return key


def make_placeholder_audio(duration_sec: float) -> str:
    """生成静音音轨（Mock TTS），返回存储 key。"""
    key = f"tts/{os.urandom(8).hex()}.m4a"
    out = storage.local_path(key)
    os.makedirs(os.path.dirname(out), exist_ok=True)
    duration = max(1.0, min(duration_sec, 120.0))
    cmd = [
        "ffmpeg", "-y",
        "-f", "lavfi", "-i", f"anullsrc=r=44100:cl=mono:d={duration}",
        "-c:a", "aac", out,
    ]
    _run(cmd)
    return key


def compose_video(clips: list[str], audios: list[str], output_key: str, subtitle_texts: list[str] | None = None) -> str:
    """合成 9:16 成片：片段拼接 + 对应音轨，输出 mp4。

    策略：先把每段片段与音轨合并并统一规格（缩放/补齐到 720x1280、时长对齐音频），
    再 concat 拼接。字幕一期随模板用 drawtext 简化实现（句级样式二期增强）。
    """
    if not clips:
        raise AppError("compose_no_clips", "无可合成片段")
    _ = subtitle_texts  # 一期字幕简化：样式随模板，逐句 drawtext 在模板增强时接入

    work_dir = storage.local_path("tmp")
    os.makedirs(work_dir, exist_ok=True)
    merged_parts: list[str] = []

    for i, clip_key in enumerate(clips):
        clip_path = storage.local_path(clip_key)
        audio_path = storage.local_path(audios[i]) if i < len(audios) else None
        part_out = os.path.join(work_dir, f"part_{i}_{os.urandom(4).hex()}.mp4")

        inputs = ["-i", clip_path]
        if audio_path:
            inputs += ["-i", audio_path]
        cmd = [
            "ffmpeg", "-y", *inputs,
            "-vf", "scale=720:1280:force_original_aspect_ratio=decrease,pad=720:1280:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=24",
            "-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "veryfast",
            "-c:a", "aac" if audio_path else "aac",
        ]
        if audio_path:
            # 音频决定段落时长（声画对齐，FR-C-03）
            cmd += ["-map", "0:v:0", "-map", "1:a:0", "-shortest"]
        else:
            cmd += ["-an"]
        cmd += [part_out]
        _run(cmd)
        merged_parts.append(part_out)

    out_path = storage.local_path(output_key)
    os.makedirs(os.path.dirname(out_path), exist_ok=True)

    concat_list = os.path.join(work_dir, f"concat_{os.urandom(4).hex()}.txt")
    with open(concat_list, "w", encoding="utf-8") as f:
        for part in merged_parts:
            f.write(f"file '{part}'\n")
    _run(["ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", concat_list, "-c", "copy", out_path])

    # 清理中间产物
    for part in merged_parts:
        os.remove(part)
    os.remove(concat_list)
    return output_key


def _run(cmd: list[str]) -> None:
    """执行 ffmpeg 命令，非零退出抛供应商故障类错误。"""
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=settings.compose_timeout_sec)
    if result.returncode != 0:
        raise AppError("provider_fault", f"ffmpeg 执行失败: {result.stderr[-500:]}", status_code=500)
