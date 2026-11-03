import { execFile } from "node:child_process";
import { mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import ffmpeg from "@ffmpeg-installer/ffmpeg";
import ffprobe from "@ffprobe-installer/ffprobe";
import type { AudioPlacement, VideoEditRecipeV2 } from "@ai-video/plugin-video-edit/core";
import type { OriginalAudioClipV3 } from "@ai-video/api-contracts";
import { renderVideoWithAudio, type AudioRenderInput } from "./audio-render.ts";

const exec = promisify(execFile);
const ffmpegPath = process.env.API_FFMPEG_PATH || ffmpeg.path;
const ffprobePath = process.env.API_FFPROBE_PATH || ffprobe.path;
const seconds = (ms: number) => (ms / 1000).toFixed(3);

export interface EpisodeVisualInput { id?: string; assetId?: string; path: string;
  mime: "video/mp4" | "image/jpeg" | "image/png" | "image/webp"; inMs: number; outMs: number; volume: number }

interface EpisodeAudioInput { version?: 2 | 3; originalVolume: number;
  originalClips?: OriginalAudioClipV3[]; voiceClips: AudioPlacement[]; musicClips: AudioPlacement[] }

async function hasAudio(path: string): Promise<boolean> {
  const { stdout } = await exec(ffprobePath, ["-v", "error", "-show_entries", "stream=codec_type", "-of", "json", path],
    { encoding: "utf8", timeout: 10_000, maxBuffer: 100_000 });
  return (JSON.parse(stdout) as { streams?: { codec_type?: string }[] }).streams?.some(stream => stream.codec_type === "audio") ?? false;
}

export async function renderEpisodeMedia(visuals: EpisodeVisualInput[],
  audio: EpisodeAudioInput | undefined,
  voices: AudioRenderInput[], music: AudioRenderInput[], output: string,
  size: { width: number; height: number } = { width: 720, height: 1280 }): Promise<void> {
  if (!visuals.length || visuals.length > 100) throw new Error("分集镜头数量无效");
  const durationMs = visuals.reduce((total, clip) => total + clip.outMs - clip.inMs, 0);
  if (!Number.isSafeInteger(durationMs) || durationMs <= 0 || durationMs > 20 * 60_000) throw new Error("分集时长超出限制");
  if (audio && (voices.length !== audio.voiceClips.length || music.length !== audio.musicClips.length)) throw new Error("分集音频素材数量不匹配");
  const folder = mkdtempSync(join(tmpdir(), "avs-episode-media-"));
  try {
    const segments: string[] = [];
    for (let index = 0; index < visuals.length; index++) {
      const visual = visuals[index];
      const length = visual.outMs - visual.inMs;
      if (!Number.isSafeInteger(length) || length <= 0) throw new Error("分集镜头裁剪无效");
      const segment = join(folder, `segment-${index}.mp4`);
      const videoInput = visual.mime === "video/mp4"
        ? ["-ss", seconds(visual.inMs), "-i", visual.path]
        : ["-loop", "1", "-framerate", "30", "-i", visual.path];
      const sourceAudio = visual.mime === "video/mp4" && await hasAudio(visual.path);
      const originals = audio?.version === 3 ? (audio.originalClips ?? []).filter(clip => clip.visualClipId === visual.id) : [];
      const active = originals.filter(clip => !clip.muted && clip.volume > 0);
      if (active.length && !sourceAudio) throw new Error("镜头原声片段引用了没有声音的源视频");
      const splitOriginal = audio?.version === 3;
      const silentInput = splitOriginal || !sourceAudio
        ? ["-f", "lavfi", "-i", `anullsrc=channel_layout=stereo:sample_rate=48000:d=${seconds(length)}`] : [];
      const audioMap = splitOriginal || !sourceAudio ? "1:a:0" : "0:a:0";
      const audioFilters: string[] = [];
      if (splitOriginal && active.length) {
        audioFilters.push(`[1:a:0]atrim=duration=${seconds(length)},asetpts=PTS-STARTPTS[silence]`);
        for (const [partIndex, clip] of active.entries()) {
          if (clip.assetId !== visual.assetId || clip.inMs < visual.inMs || clip.outMs > visual.outMs)
            throw new Error("镜头原声片段超出所属画面的源时间范围");
          const start = clip.inMs - visual.inMs;
          audioFilters.push(`[0:a:0]atrim=start=${seconds(start)}:end=${seconds(clip.outMs - visual.inMs)},` +
            `asetpts=PTS-STARTPTS,aresample=48000,aformat=channel_layouts=stereo,volume=${clip.volume},` +
            `adelay=delays=${start}|${start}[part${partIndex}]`);
        }
        audioFilters.push(`[silence]${active.map((_, partIndex) => `[part${partIndex}]`).join("")}` +
          `amix=inputs=${active.length + 1}:duration=first:dropout_transition=0:normalize=0,` +
          `atrim=duration=${seconds(length)}[original]`);
      }
      const filter = `scale=${size.width}:${size.height}:force_original_aspect_ratio=decrease,` +
        `pad=${size.width}:${size.height}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30,format=yuv420p`;
      await exec(ffmpegPath, ["-hide_banner", "-loglevel", "error", "-y", ...videoInput, ...silentInput,
        "-t", seconds(length), "-map", "0:v:0", "-map", audioFilters.length ? "[original]" : audioMap,
        ...(audioFilters.length ? ["-filter_complex", audioFilters.join(";")] : []),
        "-vf", filter, ...(audioFilters.length ? [] : ["-af", `aresample=48000,volume=${splitOriginal ? 1 : visual.volume},apad`]),
        "-c:v", "libx264", "-preset", "veryfast",
        "-pix_fmt", "yuv420p", "-c:a", "aac", "-ar", "48000", "-ac", "2", segment],
      { timeout: 120_000, maxBuffer: 1_000_000 });
      segments.push(segment);
    }
    const concatList = join(folder, "concat.txt");
    writeFileSync(concatList, segments.map(path => `file '${path.replaceAll("'", "'\\''")}'`).join("\n") + "\n");
    const base = join(folder, "base.mp4");
    await exec(ffmpegPath, ["-hide_banner", "-loglevel", "error", "-y", "-f", "concat", "-safe", "0",
      "-i", concatList, "-c", "copy", "-movflags", "+faststart", base],
    { timeout: 120_000, maxBuffer: 1_000_000 });
    if (!audio) renameSync(base, output);
    else {
      const recipe: VideoEditRecipeV2 = { version: 2, id: "episode-render", projectId: "episode-render",
        episodeId: "episode-render", shotId: "episode-render", sourceAssetId: "episode-render",
        sourceDurationMs: durationMs, trimStartMs: 0, trimEndMs: durationMs,
        captions: [], coverSourceMs: 0, revision: 1, audioMix: audio };
      await renderVideoWithAudio(recipe, base, voices, music, output);
    }
    const data = readFileSync(output);
    if (!data.length || data.length > 100_000_000 || !await hasAudio(output)) throw new Error("分集成片无效或缺少音轨");
  } finally { rmSync(folder, { recursive: true, force: true }); }
}
