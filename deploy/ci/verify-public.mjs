// Read-only public route check. A missing desktop release is valid only while its CTA stays disabled.
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const expect = (condition, message) => { if (!condition) throw new Error(message); };

export async function verifyPublic(base, request = (path) => fetch(new URL(path, base), { redirect: "manual" })) {
  if (base.protocol !== "https:" && !(base.protocol === "http:" && ["localhost", "127.0.0.1"].includes(base.hostname))) {
    throw new Error("Public verification requires HTTPS");
  }
  const manifest = await request("/downloads/latest.json");
  if (manifest.status === 200) {
    const verifier = fileURLToPath(new URL("../site/verify-routes.mjs", import.meta.url));
    const result = spawnSync(process.execPath, [verifier, base.href], { stdio: "inherit" });
    if (result.status !== 0) throw new Error(`Full release verifier failed: ${result.status ?? "signal"}`);
    return { base: base.href, downloads: "verified" };
  }
  expect(manifest.status === 404, `Unexpected download manifest status: ${manifest.status}`);
  const home = await request("/");
  expect(home.status === 200, `Home status: ${home.status}`);
  const html = await home.text();
  const link = html.match(/<a\b[^>]*\bid="download-link"[^>]*>/i)?.[0];
  expect(html.includes("AI Video Studio") && html.includes('/studio/'), "Unexpected homepage");
  expect(Boolean(link) && !/\bhref\s*=/i.test(link) && /aria-disabled="true"/.test(link), "Desktop download CTA is not disabled");
  const studio = await request("/studio/");
  expect(studio.status === 200 && (await studio.text()).includes("/studio/assets/"), "Studio route failed");
  const deep = await request("/studio/project/route-check");
  expect(deep.status === 200 && (await deep.text()).includes("/studio/assets/"), "Studio refresh failed");
  const health = await request("/api/health");
  expect(health.status === 200 && (await health.json()).ok === true, "API health failed");
  const missing = await request("/downloads/missing.dmg");
  expect(missing.status === 404, "Missing DMG did not return 404");
  return { base: base.href, home: home.status, studio: studio.status,
    api: health.status, downloads: "disabled", missing: missing.status };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.stdout.write(JSON.stringify(await verifyPublic(new URL(process.argv[2] ?? "https://39.108.55.176/"))) + "\n");
}
