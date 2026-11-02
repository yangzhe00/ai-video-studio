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
function amplitude(raw, fromSec, toSec, frequency) {
  const start = Math.round(fromSec * sampleRate), end = Math.round(toSec * sampleRate);
  let real = 0, imaginary = 0;
  for (let index = start; index < end; index++) {
    const value = raw.readFloatLE(index * 4);
    const phase = 2 * Math.PI * frequency * (index - start) / sampleRate;
    real += value * Math.cos(phase);
    imaginary += value * Math.sin(phase);
  }
  return Number((2 * Math.hypot(real, imaginary) / (end - start)).toFixed(5));
}
function inspect(name) {
  const path = join(evidenceDir, name);
  const bytes = readFileSync(path);
  const probe = JSON.parse(execFileSync(ffprobe, ["-v", "error", "-show_entries", "format=duration:stream=codec_type,codec_name", "-of", "json", path], { encoding: "utf8" }));
  const raw = execFileSync(ffmpeg, ["-hide_banner", "-loglevel", "error", "-i", path, "-vn", "-ac", "1", "-ar", String(sampleRate), "-f", "f32le", "pipe:1"], { maxBuffer: 4_000_000 });
  return { name, sizeBytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex"),
    durationSec: Number(probe.format?.duration), streams: probe.streams,
    beforeVoice: { source660Hz: amplitude(raw, 0.1, 0.4, 660), voice440Hz: amplitude(raw, 0.1, 0.4, 440) },
    afterVoice: { source660Hz: amplitude(raw, 1, 1.3, 660), voice440Hz: amplitude(raw, 1, 1.3, 440) } };
}
const preview = inspect(process.argv[2] ?? "local-shot-mixed-preview.mp4");
const exported = inspect(process.argv[3] ?? "local-shot-mixed-export.mp4");
const result = { preview, exported, identicalBytes: preview.sha256 === exported.sha256 };
writeFileSync(join(evidenceDir, process.argv[4] ?? "local-media-analysis.json"), JSON.stringify(result, null, 2) + "\n");
process.stdout.write(JSON.stringify(result) + "\n");
