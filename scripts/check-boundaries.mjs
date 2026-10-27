import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const roots = ["packages/project-core", "packages/plugin-sdk", "packages/platform-ports", "packages/design-tokens", "packages/ui-web", "plugins"];
const violations = [];

async function inspect(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) { await inspect(path); continue; }
    if (!/\.[cm]?[jt]sx?$/.test(entry.name)) continue;
    const source = await readFile(path, "utf8");
    const imports = source.matchAll(/(?:\bfrom\s*|\bimport\s*\(|\bimport\s+|\brequire\s*\()\s*["']([^"']+)["']/g);
    for (const [, specifier] of imports) {
      const isReact = specifier === "react" || specifier.startsWith("react/");
      const platformCode = specifier.startsWith("@tauri-apps/") || specifier.startsWith("node:") || specifier.includes("apps/desktop") || specifier.includes("src-tauri");
      if (platformCode || (isReact && !path.startsWith("packages/ui-web/"))) {
        violations.push(`${path}: forbidden dependency ${specifier}`);
      }
    }
  }
}

for (const root of roots) await inspect(root);
if (violations.length) {
  console.error(violations.join("\n"));
  process.exitCode = 1;
} else {
  console.log("Workspace boundaries: OK");
}
