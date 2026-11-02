import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repo = "/Volumes/project/代码/ai-video-studio";
const base = dirname(fileURLToPath(import.meta.url));
const output = join(base, "fixtures");
const fromApi = createRequire(join(repo, "apps/api/package.json"));
const ffmpeg = fromApi("@ffmpeg-installer/ffmpeg").path;
const ffprobe = fromApi("@ffprobe-installer/ffprobe").path;
mkdirSync(output, { recursive: true });

function run(name, args) {
  execFileSync(ffmpeg, ["-hide_banner", "-loglevel", "error", "-y", ...args, join(output, name)], { stdio: "inherit" });
}
function video(name, color, frequency) {
  run(name, ["-f", "lavfi", "-i", `color=c=${color}:s=320x180:r=25:d=5`, "-f", "lavfi", "-i",
    `sine=frequency=${frequency}:sample_rate=48000:duration=5`, "-t", "5", "-c:v", "libx264",
    "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "96k",
    "-shortest", "-movflags", "+faststart"]);
}
function audio(name, seconds, frequency, codec) {
  run(name, ["-f", "lavfi", "-i", `sine=frequency=${frequency}:sample_rate=48000:duration=${seconds}`,
    "-t", String(seconds), ...codec]);
}

video("shot-1-red-5s-660hz.mp4", "red", 660);
video("shot-2-green-5s-770hz.mp4", "green", 770);
video("shot-3-blue-5s-880hz.mp4", "blue", 880);
audio("voice-a-3.2s-440hz.wav", 3.2, 440, ["-c:a", "pcm_s16le"]);
audio("voice-b-3s-550hz.mp3", 3, 550, ["-c:a", "libmp3lame", "-q:a", "5"]);
audio("voice-c-2s-460hz.m4a", 2, 460, ["-c:a", "aac", "-b:a", "96k"]);
audio("music-15s-220hz.m4a", 15, 220, ["-c:a", "aac", "-b:a", "96k"]);
writeFileSync(join(output, "fake-voice.mp3"), "This is synthetic text, not audio.\n");
writeFileSync(join(output, "empty-voice.wav"), "");

const names = ["shot-1-red-5s-660hz.mp4", "shot-2-green-5s-770hz.mp4", "shot-3-blue-5s-880hz.mp4",
  "voice-a-3.2s-440hz.wav", "voice-b-3s-550hz.mp3", "voice-c-2s-460hz.m4a",
  "music-15s-220hz.m4a", "fake-voice.mp3", "empty-voice.wav"];
const files = names.map(name => {
  const path = join(output, name);
  const bytes = readFileSync(path);
  const media = bytes.length && !name.startsWith("fake")
    ? JSON.parse(execFileSync(ffprobe, ["-v", "error", "-show_entries", "format=duration:stream=codec_type,codec_name",
      "-of", "json", path], { encoding: "utf8" })) : null;
  return { name, relativePath: join("fixtures", name), sizeBytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"), media };
});
const manifest = {
  generatedBy: "synthetic FFmpeg sources for QA; no user media or supplier requests",
  expectedArrangement: {
    shots: ["shot-1-red-5s-660hz.mp4", "shot-2-green-5s-770hz.mp4", "shot-3-blue-5s-880hz.mp4"],
    durationMs: 15000,
    shotCutsMs: [5000, 10000],
    voice: [
      { file: "voice-a-3.2s-440hz.wav", startMs: 4700, inMs: 0, outMs: 3200, crossesCutMs: 5000 },
      { file: "voice-b-3s-550hz.mp3", startMs: 10300, inMs: 0, outMs: 3000 },
    ],
    music: [{ file: "music-15s-220hz.m4a", startMs: 0, inMs: 0, outMs: 15000 }],
  },
  files,
};
writeFileSync(join(base, "fixture-manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
process.stdout.write(`Generated ${files.length} synthetic fixtures at ${output}\n`);
