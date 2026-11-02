import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const evidenceDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(evidenceDir, "../../../..");
const requireFromApi = createRequire(join(repoRoot, "apps/api/package.json"));
const ffmpeg = requireFromApi("@ffmpeg-installer/ffmpeg").path;
const ffprobe = requireFromApi("@ffprobe-installer/ffprobe").path;
const outputDir = join(evidenceDir, "fixtures");
mkdirSync(outputDir, { recursive: true });

function make(name, args) {
  execFileSync(ffmpeg, ["-hide_banner", "-loglevel", "error", "-y", ...args, join(outputDir, name)], { stdio: "inherit" });
}

function video(name, color, duration, sourceTone) {
  const args = ["-f", "lavfi", "-i", `color=c=${color}:s=320x180:r=25:d=${duration}`];
  if (sourceTone) args.push("-f", "lavfi", "-i", `sine=frequency=${sourceTone}:sample_rate=48000:duration=${duration}`);
  args.push("-t", String(duration), "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p");
  if (sourceTone) args.push("-c:a", "aac", "-b:a", "96k", "-shortest");
  else args.push("-an");
  args.push("-movflags", "+faststart");
  make(name, args);
}

function audio(name, duration, tone, codecArgs) {
  make(name, ["-f", "lavfi", "-i", `sine=frequency=${tone}:sample_rate=48000:duration=${duration}`, "-t", String(duration), ...codecArgs]);
}

make("reference.jpg", ["-f", "lavfi", "-i", "testsrc=size=320x180:rate=1", "-frames:v", "1", "-q:v", "4"]);
video("shot-silent-5s.mp4", "red", 5, null);
video("shot-audio-5s.mp4", "blue", 5, 660);
video("shot-silent-10s.mp4", "green", 10, null);
video("shot-audio-10s.mp4", "yellow", 10, 550);
audio("voice-short-2s.wav", 2, 440, ["-c:a", "pcm_s16le"]);
audio("voice-5s.wav", 5, 440, ["-c:a", "pcm_s16le"]);
audio("voice-5s.mp3", 5, 440, ["-c:a", "libmp3lame", "-q:a", "5"]);
audio("voice-5s.m4a", 5, 440, ["-c:a", "aac", "-b:a", "96k"]);
audio("voice-long-12s.wav", 12, 440, ["-c:a", "pcm_s16le"]);
audio("music-12s.wav", 12, 220, ["-c:a", "pcm_s16le"]);
writeFileSync(join(outputDir, "broken.mp3"), "This is not an audio file.\n");
writeFileSync(join(outputDir, "empty.wav"), "");

const names = [
  "reference.jpg", "shot-silent-5s.mp4", "shot-audio-5s.mp4", "shot-silent-10s.mp4", "shot-audio-10s.mp4",
  "voice-short-2s.wav", "voice-5s.wav", "voice-5s.mp3", "voice-5s.m4a", "voice-long-12s.wav", "music-12s.wav",
  "broken.mp3", "empty.wav",
];
const files = names.map((name) => {
  const path = join(outputDir, name);
  const bytes = readFileSync(path);
  let media = null;
  if (bytes.length && !name.startsWith("broken")) {
    media = JSON.parse(execFileSync(ffprobe, ["-v", "error", "-show_entries", "format=duration:stream=codec_type,codec_name", "-of", "json", path], { encoding: "utf8" }));
  }
  return { name, sizeBytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex"), media };
});
writeFileSync(join(evidenceDir, "fixture-manifest.json"), JSON.stringify({ source: "synthetic FFmpeg test media", files }, null, 2) + "\n");
process.stdout.write(`Generated ${files.length} fixtures in ${outputDir}\n`);
