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
  it("keeps a previously mixed shot as source audio without adding it a second time", async () => {
    const dir = mkdtempSync(join(tmpdir(), "avs-old-mixed-shot-"));
    try {
      const source = join(dir, "mixed.mp4"), output = join(dir, "episode.mp4");
      execFileSync(ffmpeg.path, ["-v", "error", "-y", "-f", "lavfi", "-i", "color=c=blue:s=64x64:r=12:d=1",
        "-f", "lavfi", "-i", "sine=frequency=660:sample_rate=48000:duration=1",
        "-shortest", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", source]);
      await renderEpisodeMedia([{ path: source, mime: "video/mp4", inMs: 0, outMs: 1000, volume: 1 }],
        undefined, [], [], output, { width: 160, height: 284 });
      const ratio = toneAt(output, 0.2, 660) / toneAt(source, 0.2, 660);
      expect(ratio).toBeGreaterThan(0.6);
      expect(ratio).toBeLessThan(1.25);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }, 30_000);

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
        { path: first, mime: "video/mp4", inMs: 0, outMs: 5000, volume: 0 },
        { path: second, mime: "video/mp4", inMs: 0, outMs: 5000, volume: 1 },
      ], audio, [{ clip: audio.voiceClips[0], path: voice }], [{ clip: audio.musicClips[0], path: music }],
      output, { width: 160, height: 284 });
      const probe = JSON.parse(execFileSync(ffprobe.path, ["-v", "error", "-show_entries",
        "format=duration:stream=codec_type,codec_name", "-of", "json", output], { encoding: "utf8" })) as {
        format: { duration: string }; streams: { codec_type: string; codec_name: string }[] };
      expect(Number(probe.format.duration)).toBeCloseTo(10, 1);
      expect(probe.streams).toEqual(expect.arrayContaining([{ codec_type: "audio", codec_name: "aac" }]));
      expect(toneAt(output, 1, 660)).toBeLessThan(0.005);
      expect(toneAt(output, 1, 220)).toBeGreaterThan(0.01);
      expect(toneAt(output, 4, 440)).toBeGreaterThan(0.03);
      expect(toneAt(output, 6, 440)).toBeGreaterThan(0.03);
      expect(toneAt(output, 6, 220)).toBeGreaterThan(0.01);
      expect(toneAt(output, 9, 220)).toBeGreaterThan(0.01);
      expect(toneAt(output, 9, 440)).toBeLessThan(0.005);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }, 30_000);

  it("renders independent original-audio segments and keeps silence where one is deleted", async () => {
    const dir = mkdtempSync(join(tmpdir(), "avs-original-segments-"));
    try {
      const source = join(dir, "source.mp4"), output = join(dir, "episode.mp4");
      execFileSync(ffmpeg.path, ["-v", "error", "-y", "-f", "lavfi", "-i", "color=c=blue:s=64x64:r=12:d=3",
        "-f", "lavfi", "-i", "sine=frequency=660:sample_rate=48000:duration=3",
        "-shortest", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", source]);
      const audio = { version: 3 as const, originalVolume: 1, voiceClips: [], musicClips: [], originalClips: [
        { id: "original-left-0001", visualClipId: "visual-0001", assetId: "video-0001",
          inMs: 0, outMs: 1300, volume: 1, muted: false },
        { id: "original-right-0001", visualClipId: "visual-0001", assetId: "video-0001",
          inMs: 1300, outMs: 3000, volume: 1, muted: true },
      ] };
      await renderEpisodeMedia([{ id: "visual-0001", assetId: "video-0001", path: source,
        mime: "video/mp4", inMs: 0, outMs: 3000, volume: 0.3 }], audio, [], [], output,
        { width: 160, height: 284 });
      expect(toneAt(output, 0.5, 660)).toBeGreaterThan(0.03);
      expect(toneAt(output, 2, 660)).toBeLessThan(0.005);
      const gainOutput = join(dir, "gain.mp4");
      const gainVisuals = [
        { id: "visual-left-0001", assetId: "video-0001", path: source, mime: "video/mp4" as const,
          inMs: 0, outMs: 1500, volume: 0.3 },
        { id: "visual-right-001", assetId: "video-0001", path: source, mime: "video/mp4" as const,
          inMs: 1500, outMs: 3000, volume: 1 },
      ];
      await renderEpisodeMedia(gainVisuals, { ...audio, originalClips: gainVisuals.map((clip, index) => ({
        id: `original-gain-${index}`, visualClipId: clip.id, assetId: clip.assetId,
        inMs: clip.inMs, outMs: clip.outMs, volume: index === 0 ? 0.3 : 1, muted: false,
      })) }, [], [], gainOutput, { width: 160, height: 284 });
      const gainRatio = toneAt(gainOutput, 0.5, 660) / toneAt(gainOutput, 2.1, 660);
      expect(gainRatio).toBeGreaterThan(0.2);
      expect(gainRatio).toBeLessThan(0.45);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }, 30_000);

  it("keeps split source timing at 7.3 seconds and closes the visual gap to 12.3 seconds", async () => {
    const dir = mkdtempSync(join(tmpdir(), "avs-episode-split-"));
    try {
      const paths = [440, 660, 880].map((frequency, index) => {
        const path = join(dir, `source-${index}.mp4`);
        execFileSync(ffmpeg.path, ["-v", "error", "-y", "-f", "lavfi", "-i",
          `color=c=${["blue", "red", "green"][index]}:s=64x64:r=12:d=5`,
          "-f", "lavfi", "-i", `sine=frequency=${frequency}:sample_rate=48000:duration=5`,
          "-shortest", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", path]);
        return path;
      });
      const visuals = [
        { id: "visual-first-0001", assetId: "video-first-0001", path: paths[0], mime: "video/mp4" as const,
          inMs: 0, outMs: 5000, volume: 1 },
        { id: "visual-second-left", assetId: "video-second-001", path: paths[1], mime: "video/mp4" as const,
          inMs: 0, outMs: 2300, volume: 1 },
        { id: "visual-second-right", assetId: "video-second-001", path: paths[1], mime: "video/mp4" as const,
          inMs: 2300, outMs: 5000, volume: 1 },
        { id: "visual-third-0001", assetId: "video-third-0001", path: paths[2], mime: "video/mp4" as const,
          inMs: 0, outMs: 5000, volume: 1 },
      ];
      const originalClips = visuals.map(clip => ({ id: `original-${clip.id}`, visualClipId: clip.id,
        assetId: clip.assetId, inMs: clip.inMs, outMs: clip.outMs, volume: 1, muted: false }));
      const audio = { version: 3 as const, originalVolume: 1, originalClips, voiceClips: [], musicClips: [] };
      const splitOutput = join(dir, "split.mp4");
      await renderEpisodeMedia(visuals, audio, [], [], splitOutput, { width: 160, height: 284 });
      const duration = (path: string) => Number(JSON.parse(execFileSync(ffprobe.path,
        ["-v", "error", "-show_entries", "format=duration", "-of", "json", path],
        { encoding: "utf8" })).format.duration);
      expect(duration(splitOutput)).toBeCloseTo(15, 1);
      expect(toneAt(splitOutput, 7.1, 660)).toBeGreaterThan(0.02);
      expect(toneAt(splitOutput, 7.7, 660)).toBeGreaterThan(0.02);
      const closed = join(dir, "closed.mp4");
      await renderEpisodeMedia([visuals[0], visuals[1], visuals[3]],
        { ...audio, originalClips: [originalClips[0], originalClips[1], originalClips[3]] },
        [], [], closed, { width: 160, height: 284 });
      expect(duration(closed)).toBeCloseTo(12.3, 1);
      expect(toneAt(closed, 7.1, 660)).toBeGreaterThan(0.02);
      expect(toneAt(closed, 7.8, 880)).toBeGreaterThan(0.02);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }, 60_000);
});
