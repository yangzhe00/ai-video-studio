import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile, access, chmod } from "node:fs/promises";
import { constants } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import ffprobe from "@ffprobe-installer/ffprobe";

const execFileAsync = promisify(execFile);
const extension: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "video/mp4": "mp4",
  "audio/mpeg": "mp3", "audio/wav": "wav", "audio/x-wav": "wav", "audio/mp4": "m4a" };
const audioFormats: Record<string, { containers: string[]; codecs: string[] }> = {
  "audio/mpeg": { containers: ["mp3"], codecs: ["mp3"] },
  "audio/wav": { containers: ["wav"], codecs: ["pcm_s16le", "pcm_s24le", "pcm_f32le"] },
  "audio/x-wav": { containers: ["wav"], codecs: ["pcm_s16le", "pcm_s24le", "pcm_f32le"] },
  "audio/mp4": { containers: ["mov", "mp4", "m4a"], codecs: ["aac", "alac"] },
};
export interface MediaInspection { durationMs?: number }

export class MediaInspectError extends Error { constructor(readonly status: number, message: string) { super(message); } }

function unavailable(error: unknown): boolean {
  const candidate = error as { code?: unknown; killed?: unknown } | null;
  return candidate?.killed === true ||
    ["ENOENT", "EACCES", "ENOEXEC", "ETXTBSY", 127].includes(candidate?.code as string | number);
}

export async function inspectMedia(bytes: Buffer, mime: string, probePath = ffprobe.path): Promise<void> {
  const suffix = extension[mime];
  if (!suffix) throw new MediaInspectError(415, "不支持的素材格式");
  const folder = await mkdtemp(join(tmpdir(), "avs-upload-"));
  try {
    const path = join(folder, `source.${suffix}`);
    await writeFile(path, bytes);
    await inspectMediaFile(path, mime, probePath);
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
}

export async function inspectMediaFile(path: string, mime: string, probePath = ffprobe.path): Promise<MediaInspection> {
  if (!extension[mime]) throw new MediaInspectError(415, "不支持的素材格式");
  try {
    try { await access(probePath, constants.X_OK); }
    catch {
      try { await chmod(probePath, 0o755); }
      catch (error) {
        process.stderr.write(`[media-inspect] ffprobe unavailable: ${String((error as { code?: unknown }).code ?? "access")}\n`);
        throw new MediaInspectError(503, "媒体识别服务不可用，请稍后再试");
      }
    }
    const { stdout } = await execFileAsync(probePath, ["-v", "error", "-show_streams", "-show_format", "-of", "json", path],
      { encoding: "utf8", timeout: 10_000, maxBuffer: 1_000_000 });
    let parsed: { streams?: { codec_type?: string; codec_name?: string; width?: number; height?: number }[];
      format?: { format_name?: string; duration?: string } };
    try { parsed = JSON.parse(stdout) as typeof parsed; }
    catch {
      process.stderr.write("[media-inspect] ffprobe returned invalid JSON\n");
      throw new MediaInspectError(503, "媒体识别服务不可用，请稍后再试");
    }
    const duration = Number(parsed.format?.duration);
    const audio = parsed.streams?.find(stream => stream.codec_type === "audio");
    const video = parsed.streams?.find(stream => stream.codec_type === "video");
    const audioRule = audioFormats[mime];
    if (audioRule) {
      const containers = parsed.format?.format_name?.split(",") ?? [];
      if (!audio || video || !audioRule.codecs.includes(audio.codec_name ?? "") ||
          !containers.some(container => audioRule.containers.includes(container)) ||
          !Number.isFinite(duration) || duration <= 0 || duration > 3600) {
        throw new MediaInspectError(400, "音频格式或时长无效");
      }
      return { durationMs: Math.round(duration * 1000) };
    }
    if (!video || !Number.isSafeInteger(video.width) || !Number.isSafeInteger(video.height) ||
        (video.width ?? 0) < 1 || (video.height ?? 0) < 1 || (video.width ?? 0) * (video.height ?? 0) > 33_554_432) {
      throw new MediaInspectError(400, "素材画面尺寸无效或过大");
    }
    if (mime === "video/mp4") {
      if (!parsed.format?.format_name?.split(",").includes("mp4") || !Number.isFinite(duration) || duration <= 0 || duration > 3600) {
        throw new MediaInspectError(400, "视频格式或时长无效");
      }
      return { durationMs: Math.round(duration * 1000) };
    } else {
      const expected = { "image/jpeg": "mjpeg", "image/png": "png", "image/webp": "webp" }[mime];
      if (video.codec_name !== expected) throw new MediaInspectError(400, "素材内容与声明格式不符");
    }
    return {};
  } catch (error) {
    if (error instanceof MediaInspectError) throw error;
    if (unavailable(error)) {
      process.stderr.write(`[media-inspect] ffprobe execution failed: ${String((error as { code?: unknown }).code ?? "timeout")}\n`);
      throw new MediaInspectError(503, "媒体识别服务不可用，请稍后再试");
    }
    throw new MediaInspectError(400, "无法识别媒体内容，请选择有效的照片、视频或录音");
  }
}
