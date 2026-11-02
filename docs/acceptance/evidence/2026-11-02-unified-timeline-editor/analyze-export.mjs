import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const mediaPath = process.argv[2];
const outArg = process.argv.indexOf("--out");
if (!mediaPath) {
  process.stderr.write("Usage: node analyze-export.mjs /absolute/path/video.mp4 [--out /absolute/path/report.json]\n");
  process.exit(2);
}
const fromApi = createRequire(join("/Volumes/project/代码/ai-video-studio", "apps/api/package.json"));
const ffmpeg = fromApi("@ffmpeg-installer/ffmpeg").path;
const ffprobe = fromApi("@ffprobe-installer/ffprobe").path;
const absolutePath = resolve(mediaPath);
const bytes = readFileSync(absolutePath);
const probe = JSON.parse(execFileSync(ffprobe, ["-v", "error", "-show_streams", "-show_format", "-of", "json", absolutePath], { encoding: "utf8" }));
const sampleRate = 8000;
const pcm = execFileSync(ffmpeg, ["-hide_banner", "-loglevel", "error", "-i", absolutePath,
  "-vn", "-ac", "1", "-ar", String(sampleRate), "-f", "s16le", "-"], { maxBuffer: 64 * 1024 * 1024 });
const sampleCount = pcm.length / 2;
const windowSamples = Math.round(sampleRate * 0.1);
const frequencies = [220, 440, 550, 660, 770, 880];

function toneDb(startSeconds, frequency) {
  const start = Math.max(0, Math.round(startSeconds * sampleRate));
  if (start + windowSamples > sampleCount) return null;
  const k = Math.round(frequency * windowSamples / sampleRate);
  const coeff = 2 * Math.cos(2 * Math.PI * k / windowSamples);
  let prev = 0, prev2 = 0;
  for (let i = 0; i < windowSamples; i += 1) {
    const sample = pcm.readInt16LE((start + i) * 2) / 32768;
    const next = sample + coeff * prev - prev2;
    prev2 = prev;
    prev = next;
  }
  const power = prev2 * prev2 + prev * prev - coeff * prev * prev2;
  const amplitude = 2 * Math.sqrt(Math.max(power, 0)) / windowSamples;
  return Math.round(20 * Math.log10(Math.max(amplitude, 1e-8)) * 10) / 10;
}

const checkpoints = [0.1, 4.5, 4.8, 5.1, 7.8, 9.8, 10.1, 10.4, 13.2, 14.5].map(second => ({
  second,
  tonesDbfs: Object.fromEntries(frequencies.map(frequency => [String(frequency), toneDb(second, frequency)])),
}));
function onsetInRange(frequency, from, to, thresholdDbfs = -38) {
  for (let second = from; second <= to; second += 0.02) {
    const db = toneDb(second, frequency);
    if (db !== null && db >= thresholdDbfs) return Math.round(second * 1000) / 1000;
  }
  return null;
}
const report = {
  file: absolutePath,
  sizeBytes: bytes.length,
  sha256: createHash("sha256").update(bytes).digest("hex"),
  probe: { format: probe.format, streams: probe.streams?.map(stream => ({
    index: stream.index, codec_type: stream.codec_type, codec_name: stream.codec_name,
    duration: stream.duration, sample_rate: stream.sample_rate, channels: stream.channels,
    width: stream.width, height: stream.height,
  })) },
  analysis: {
    method: "mono 8 kHz PCM, 100 ms Goertzel windows; dBFS are measurement aids, not automatic acceptance",
    checkpoints,
    firstDetectedInWindow: {
      voiceA440: onsetInRange(440, 4.4, 5.2),
      voiceB550: onsetInRange(550, 10.0, 10.8),
      shot2_770: onsetInRange(770, 4.7, 5.3),
      shot3_880: onsetInRange(880, 9.7, 10.3),
    },
  },
};
const json = JSON.stringify(report, null, 2) + "\n";
if (outArg >= 0) {
  if (!process.argv[outArg + 1]) throw new Error("--out requires a path");
  writeFileSync(resolve(process.argv[outArg + 1]), json);
} else process.stdout.write(json);
