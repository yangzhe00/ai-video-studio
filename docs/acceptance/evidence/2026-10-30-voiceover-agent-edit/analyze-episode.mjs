import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const evidenceDir = dirname(fileURLToPath(import.meta.url));
const requireFromApi = createRequire(join(evidenceDir, "../../../../apps/api/package.json"));
const ffmpeg = requireFromApi("@ffmpeg-installer/ffmpeg").path;
const ffprobe = requireFromApi("@ffprobe-installer/ffprobe").path;
const sampleRate = 16000;
function peak(raw, frequency) {
  const start = 0, end = raw.length / 4;
  let real = 0, imaginary = 0;
  for (let index = start; index < end; index++) {
    const phase = 2 * Math.PI * frequency * (index - start) / sampleRate;
    const value = raw.readFloatLE(index * 4);
    real += value * Math.cos(phase);
    imaginary += value * Math.sin(phase);
  }
  return Number((2 * Math.hypot(real, imaginary) / (end - start)).toFixed(5));
}
function inspect(name) {
  const path = join(evidenceDir, name), bytes = readFileSync(path);
  const probe = JSON.parse(execFileSync(ffprobe, ["-v", "error", "-show_entries", "format=duration:stream=codec_type,codec_name", "-of", "json", path], { encoding: "utf8" }));
  const windows = [1, 4, 6, 9].map(second => {
    const raw = execFileSync(ffmpeg, ["-hide_banner", "-loglevel", "error", "-i", path, "-ss", String(second),
      "-t", "0.3", "-vn", "-ac", "1", "-ar", String(sampleRate), "-f", "f32le", "pipe:1"], { maxBuffer: 100_000 });
    return { second, decodedSamples: raw.length / 4, music220Hz: peak(raw, 220),
      voice440Hz: peak(raw, 440), source660Hz: peak(raw, 660) };
  });
  return { name, sizeBytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex"),
    durationSec: Number(probe.format?.duration), streams: probe.streams, windows };
}
const preview = inspect(process.argv[2] ?? "local-episode-mixed-preview.mp4");
const exported = inspect(process.argv[3] ?? "local-episode-mixed-export.mp4");
const result = { preview, exported, identicalBytes: preview.sha256 === exported.sha256 };
writeFileSync(join(evidenceDir, process.argv[4] ?? "local-episode-analysis.json"), JSON.stringify(result, null, 2) + "\n");
process.stdout.write(JSON.stringify(result) + "\n");
