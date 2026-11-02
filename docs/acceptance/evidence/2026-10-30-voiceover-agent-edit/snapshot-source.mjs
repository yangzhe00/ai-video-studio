import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const output = process.argv[2];
if (!output) throw new Error("Pass an output JSON path");
const roots = [
  "apps/api/src", "apps/web/src", "apps/desktop/src", "apps/desktop/src-tauri/src", "apps/mobile/src",
  "packages/api-contracts/src", "packages/project-schema/src", "packages/project-core/src", "packages/ui-web/src",
  "packages/components/src", "plugins/video-edit/src", "plugins/canvas/src", "deploy/postgres",
  "apps/api/package.json", "apps/web/package.json", "apps/desktop/package.json", "apps/mobile/package.json",
  "apps/desktop/src-tauri/tauri.conf.json", "package.json", "pnpm-lock.yaml",
];
const files = [];
function visit(path) {
  if (!existsSync(path)) return;
  if (statSync(path).isDirectory()) {
    for (const name of readdirSync(path).sort()) visit(join(path, name));
    return;
  }
  const bytes = readFileSync(path);
  files.push({ path: relative(repoRoot, path), sizeBytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") });
}
for (const root of roots) visit(join(repoRoot, root));
files.sort((a, b) => a.path.localeCompare(b.path));
const aggregate = createHash("sha256").update(files.map((file) => `${file.path}\t${file.sha256}\n`).join("")).digest("hex");
const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repoRoot, encoding: "utf8" }).trim();
const dirtyPaths = execFileSync("git", ["status", "--porcelain"], { cwd: repoRoot, encoding: "utf8" }).trim().split("\n").filter(Boolean).length;
const manifest = { capturedAt: new Date().toISOString(), gitHead: head, gitDirtyPathCount: dirtyPaths,
  relevantFileCount: files.length, relevantSourceSha256: aggregate, roots, files };
writeFileSync(resolve(output), JSON.stringify(manifest, null, 2) + "\n");
process.stdout.write(JSON.stringify({ gitHead: head, gitDirtyPathCount: dirtyPaths, relevantFileCount: files.length, relevantSourceSha256: aggregate }) + "\n");
