import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ffmpeg from "@ffmpeg-installer/ffmpeg";
import ffprobe from "@ffprobe-installer/ffprobe";
import { describe, expect, it } from "vitest";
import { renderEpisodeMedia } from "./episode-media.ts";

function toneAt(path: string, second: number, frequency: number): number {
  const pcm = execFileSync(ffmpeg.path, ["-v", "error", "-ss", String(second), "-i", path,
    "-t", "0.2", "-vn", "-ac", "1", "-ar", "8000", "-f", "s16le", "-"]);
  const count = pcm.length / 2;
  let real = 0, imaginary = 0;
  for (let index = 0; index < count; index++) {
    const sample = pcm.readInt16LE(index * 2) / 32768;
    const angle = 2 * Math.PI * frequency * index / 8000;
    real += sample * Math.cos(angle);
    imaginary -= sample * Math.sin(angle);
  }
  return 2 * Math.hypot(real, imaginary) / count;
}

describe("episode media audio timeline", () => {
  it("keeps cross-shot voice through second 8 and music through second 10", async () => {
    const dir = mkdtempSync(join(tmpdir(), "avs-episode-audio-timeline-"));
    try {
      const first = join(dir, "first.mp4"), second = join(dir, "second.mp4");
      const voice = join(dir, "voice.wav"), music = join(dir, "music.wav"), output = join(dir, "episode.mp4");
      execFileSync(ffmpeg.path, ["-v", "error", "-y", "-f", "lavfi", "-i", "color=c=blue:s=64x64:r=12:d=5",
        "-f", "lavfi", "-i", "sine=frequency=660:sample_rate=48000:duration=5",
        "-shortest", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-ac", "1", first]);
      execFileSync(ffmpeg.path, ["-v", "error", "-y", "-f", "lavfi", "-i", "color=c=red:s=64x64:r=12:d=5",
        "-c:v", "libx264", "-pix_fmt", "yuv420p", second]);
      for (const [path, frequency, duration] of [[voice, 440, 5], [music, 220, 12]] as const) {
        execFileSync(ffmpeg.path, ["-v", "error", "-y", "-f", "lavfi", "-i",
          `sine=frequency=${frequency}:sample_rate=48000:duration=${duration}`, path]);
      }
      const audio = { originalVolume: 0.4,
        voiceClips: [{ assetId: "voice", startMs: 3000, inMs: 0, outMs: 5000, volume: 1 }],
        musicClips: [{ assetId: "music", startMs: 0, inMs: 0, outMs: 10000, volume: 0.2 }] };
      await renderEpisodeMedia([
        { path: first, mime: "video/mp4", inMs: 0, outMs: 5000 },
        { path: second, mime: "video/mp4", inMs: 0, outMs: 5000 },
      ], audio, [{ clip: audio.voiceClips[0], path: voice }], [{ clip: audio.musicClips[0], path: music }],
      output, { width: 160, height: 284 });
      const probe = JSON.parse(execFileSync(ffprobe.path, ["-v", "error", "-show_entries",
        "format=duration:stream=codec_type,codec_name", "-of", "json", output], { encoding: "utf8" })) as {
        format: { duration: string }; streams: { codec_type: string; codec_name: string }[] };
      expect(Number(probe.format.duration)).toBeCloseTo(10, 1);
      expect(probe.streams).toEqual(expect.arrayContaining([{ codec_type: "audio", codec_name: "aac" }]));
      expect(toneAt(output, 1, 660)).toBeGreaterThan(0.03);
      expect(toneAt(output, 4, 440)).toBeGreaterThan(0.03);
      expect(toneAt(output, 6, 440)).toBeGreaterThan(0.03);
      expect(toneAt(output, 6, 220)).toBeGreaterThan(0.01);
      expect(toneAt(output, 9, 220)).toBeGreaterThan(0.01);
      expect(toneAt(output, 9, 440)).toBeLessThan(0.005);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }, 30_000);
});
