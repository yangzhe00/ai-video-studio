import { createReadStream, constants as fsConstants } from "node:fs";
import { copyFile, mkdir, stat, writeFile, rename } from "node:fs/promises";
import { createHash } from "node:crypto";
import { basename, join, resolve } from "node:path";

function arg(name) {
  const index = process.argv.indexOf(name);
  return index < 0 ? undefined : process.argv[index + 1];
}

const source = arg("--dmg");
const version = arg("--version");
const output = arg("--out-dir");
if (!source || !version || !output || !/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/.test(version)) {
  throw new Error("Usage: node deploy/dmg/release-manifest.mjs --dmg <verified.dmg> --version <semver> --out-dir <directory>");
}
if (basename(source) !== `AI Video Studio_${version}_aarch64.dmg`) {
  throw new Error("Source DMG name and version do not match the Tauri release artifact");
}

async function digest(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

const sourcePath = resolve(source);
const outDir = resolve(output);
const sourceInfo = await stat(sourcePath);
if (!sourceInfo.isFile() || sourceInfo.size === 0) throw new Error("DMG must be a nonempty file");
await mkdir(outDir, { recursive: true });
const filename = `AI-Video-Studio-${version}-macos-arm64.dmg`;
const destination = join(outDir, filename);
try {
  await copyFile(sourcePath, destination, fsConstants.COPYFILE_EXCL);
} catch (error) {
  if (error?.code !== "EEXIST") throw error;
  if (await digest(sourcePath) !== await digest(destination)) throw new Error("Versioned download already exists with different bytes");
}
const downloadedInfo = await stat(destination);
const sha256 = await digest(destination);
if (downloadedInfo.size !== sourceInfo.size || sha256 !== await digest(sourcePath)) {
  throw new Error("Copied DMG differs from verified source");
}
const release = {
  version,
  platform: "macos-arm64",
  filename,
  bytes: downloadedInfo.size,
  sha256,
  publishedAt: new Date().toISOString(),
};
const manifest = join(outDir, "latest.json");
const temporary = join(outDir, `.latest-${process.pid}.json`);
await writeFile(temporary, `${JSON.stringify(release, null, 2)}\n`, { flag: "wx" });
await rename(temporary, manifest);
process.stdout.write(`${JSON.stringify({ manifest, ...release })}\n`);
