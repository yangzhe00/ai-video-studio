import { createRequire } from 'node:module';
import { copyFileSync, chmodSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
const source = require('@ffprobe-installer/ffprobe').path;
const ffmpeg = require('@ffmpeg-installer/ffmpeg').path;
const directory = resolve('src-tauri/binaries');
mkdirSync(directory, { recursive: true });
copyFileSync(source, resolve(directory, 'ffprobe'));
chmodSync(resolve(directory, 'ffprobe'), 0o755);
copyFileSync(ffmpeg, resolve(directory, 'ffmpeg'));
chmodSync(resolve(directory, 'ffmpeg'), 0o755);
console.log('Prepared local FFmpeg/ffprobe for development only. Do not redistribute these binaries.');
