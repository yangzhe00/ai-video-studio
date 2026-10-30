import { execFile } from "node:child_process";
import { promisify } from "node:util";
import ffmpeg from "@ffmpeg-installer/ffmpeg";
import ffprobe from "@ffprobe-installer/ffprobe";
import type { AudioPlacement, VideoEditRecipeV2 } from "@ai-video/plugin-video-edit/core";

const exec = promisify(execFile);
const ffmpegPath = process.env.API_FFMPEG_PATH || ffmpeg.path;
const ffprobePath = process.env.API_FFPROBE_PATH || ffprobe.path;
const seconds = (ms: number) => (ms / 1000).toFixed(3);

interface Probe { streams?: { codec_type?: string; codec_name?: string }[] }
async function streams(path: string): Promise<NonNullable<Probe["streams"]>> {
  const { stdout } = await exec(ffprobePath, ["-v", "error", "-show_entries", "stream=codec_type,codec_name", "-of", "json", path],
    { encoding: "utf8", timeout: 10_000, maxBuffer: 100_000 });
  return (JSON.parse(stdout) as Probe).streams ?? [];
}

export interface AudioRenderInput { clip: AudioPlacement; path: string }

/** The shot timeline begins at zero after trimming the source video. */
export async function renderVideoWithAudio(recipe: VideoEditRecipeV2, sourcePath: string,
  voices: AudioRenderInput[], music: AudioRenderInput[], outputPath: string, subtitlePath?: string | null): Promise<void> {
  const durationMs = recipe.trimEndMs - recipe.trimStartMs;
  const sourceStreams = await streams(sourcePath);
  if (!sourceStreams.some(stream => stream.codec_type === "video")) throw new Error("原视频没有画面轨");
  const inputs = [...voices, ...music];
  if (inputs.length !== recipe.audioMix.voiceClips.length + recipe.audioMix.musicClips.length) throw new Error("音频素材数量不匹配");
  const filter: string[] = [];
  if (sourceStreams.some(stream => stream.codec_type === "audio")) {
    filter.push(`[0:a:0]atrim=duration=${seconds(durationMs)},asetpts=PTS-STARTPTS,aresample=48000,` +
      `volume=${recipe.audioMix.originalVolume},apad,atrim=duration=${seconds(durationMs)}[original]`);
  } else {
    filter.push(`anullsrc=channel_layout=stereo:sample_rate=48000,atrim=duration=${seconds(durationMs)}[original]`);
  }
  inputs.forEach(({ clip }, index) => {
    filter.push(`[${index + 1}:a:0]atrim=start=${seconds(clip.inMs)}:end=${seconds(clip.outMs)},` +
      `asetpts=PTS-STARTPTS,aresample=48000,aformat=channel_layouts=stereo,volume=${clip.volume},` +
      `adelay=delays=${clip.startMs}|${clip.startMs},` +
      `apad,atrim=duration=${seconds(durationMs)}[audio${index}]`);
  });
  const names = ["[original]", ...inputs.map((_, index) => `[audio${index}]`)];
  filter.push(`${names.join("")}amix=inputs=${names.length}:duration=longest:dropout_transition=0,` +
    `volume=${names.length},alimiter=limit=0.95,loudnorm=I=-16:TP=-1.5:LRA=11[mixed]`);
  const args = ["-hide_banner", "-loglevel", "error", "-y", "-ss", seconds(recipe.trimStartMs), "-i", sourcePath,
    ...inputs.flatMap(input => ["-i", input.path]), "-t", seconds(durationMs),
    "-filter_complex", filter.join(";"), "-map", "0:v:0", "-map", "[mixed]",
    ...(subtitlePath ? ["-vf", `subtitles=${subtitlePath}`] : []),
    "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p", "-c:a", "aac", "-ar", "48000",
    "-movflags", "+faststart", outputPath];
  await exec(ffmpegPath, args, { timeout: 120_000, maxBuffer: 1_000_000 });
  const outputStreams = await streams(outputPath);
  if (!outputStreams.some(stream => stream.codec_type === "video") ||
      !outputStreams.some(stream => stream.codec_type === "audio" && stream.codec_name === "aac")) {
    throw new Error("导出视频缺少画面或 AAC 音轨");
  }
}
