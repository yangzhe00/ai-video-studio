import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ffmpeg from "@ffmpeg-installer/ffmpeg";
import ffprobe from "@ffprobe-installer/ffprobe";
import { describe, expect, it } from "vitest";
import type { VideoEditRecipeV2 } from "@ai-video/plugin-video-edit/core";
import { renderVideoWithAudio } from "./audio-render.ts";

const recipe = (): VideoEditRecipeV2 => ({ version: 2, id: "edit-001", projectId: "project-001", episodeId: "episode-001",
  shotId: "shot-001", sourceAssetId: "video-001", sourceDurationMs: 3000, trimStartMs: 500,
  trimEndMs: 2500, captions: [], coverSourceMs: 500, revision: 2,
  audioMix: { originalVolume: 0.3, voiceClips: [{ assetId: "voice-001", startMs: 500, inMs: 0, outMs: 1000, volume: 1 }], musicClips: [] } });

describe("cloud audio render", () => {
  it("places voice after the trimmed shot starts and writes an AAC track even with silent source", async () => {
    const folder = mkdtempSync(join(tmpdir(), "avs-audio-render-test-"));
    try {
      const source = join(folder, "source.mp4"), voice = join(folder, "voice.wav"), output = join(folder, "output.mp4");
      execFileSync(ffmpeg.path, ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi",
        "-i", "color=c=black:s=64x64:r=12:d=3", "-c:v", "libx264", "-pix_fmt", "yuv420p", source]);
      execFileSync(ffmpeg.path, ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi",
        "-i", "sine=frequency=1000:duration=1", voice]);
      await renderVideoWithAudio(recipe(), source, [{ clip: recipe().audioMix.voiceClips[0], path: voice }], [], output);
      const info = JSON.parse(execFileSync(ffprobe.path, ["-v", "error", "-show_entries", "stream=codec_type,codec_name", "-of", "json", output],
        { encoding: "utf8" })) as { streams: { codec_type: string; codec_name: string }[] };
      expect(info.streams).toEqual(expect.arrayContaining([{ codec_type: "audio", codec_name: "aac" }]));
      const early = join(folder, "early.pcm"), spoken = join(folder, "spoken.pcm");
      for (const [start, destination] of [["0.1", early], ["0.7", spoken]] as const) {
        execFileSync(ffmpeg.path, ["-hide_banner", "-loglevel", "error", "-y", "-ss", start, "-i", output,
          "-t", "0.2", "-vn", "-ac", "1", "-ar", "8000", "-f", "s16le", destination]);
      }
      const rms = (path: string) => {
        const data = readFileSync(path);
        let energy = 0;
        for (let index = 0; index + 1 < data.length; index += 2) {
          const sample = data.readInt16LE(index); energy += sample * sample;
        }
        return Math.sqrt(energy / (data.length / 2));
      };
      expect(rms(spoken)).toBeGreaterThan(rms(early) + 200);
    } finally { rmSync(folder, { recursive: true, force: true }); }
  });
});
