import { createHash } from "node:crypto";

const base = new URL(process.argv[2] ?? "https://39.108.55.176/");
if (base.protocol !== "https:" && base.hostname !== "127.0.0.1" && base.hostname !== "localhost") {
  throw new Error("Use HTTPS for a public site");
}
const url = (path) => new URL(path, base);
const check = (condition, message) => { if (!condition) throw new Error(message); };

async function request(path, options) {
  const response = await fetch(url(path), { redirect: "manual", ...options });
  return response;
}

const home = await request("/");
check(home.status === 200, `Home status: ${home.status}`);
const homeHtml = await home.text();
check(homeHtml.includes("AI Video Studio") && homeHtml.includes("/studio/"), "Home is not the expected marketing page");

const studio = await request("/studio/");
check(studio.status === 200, `Studio status: ${studio.status}`);
const studioHtml = await studio.text();
check(studioHtml.includes("/studio/assets/"), "Studio assets are not rooted under /studio/");

const studioRefresh = await request("/studio/project/route-check");
check(studioRefresh.status === 200 && (await studioRefresh.text()).includes("/studio/assets/"), "Studio deep-link refresh failed");

const health = await request("/api/health");
check(health.status === 200 && (await health.json()).ok === true, "API health failed");

const manifestResponse = await request("/downloads/latest.json");
check(manifestResponse.status === 200, `Download manifest status: ${manifestResponse.status}`);
const manifest = await manifestResponse.json();
check(manifest.platform === "macos-arm64", "Unexpected download platform");
check(/^AI-Video-Studio-\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?-macos-arm64\.dmg$/.test(manifest.filename), "Unsafe download filename");
check(Number.isSafeInteger(manifest.bytes) && manifest.bytes > 0, "Invalid DMG byte count");
check(/^[0-9a-f]{64}$/.test(manifest.sha256), "Invalid DMG hash");
const path = `/downloads/${manifest.filename}`;

const missing = await request("/downloads/missing.dmg");
check(missing.status === 404, `Missing download returned ${missing.status}, expected 404`);
check(!(await missing.text()).includes("AI Video Studio"), "Missing download returned an HTML app shell");

const ranged = await request(path, { headers: { Range: "bytes=0-1023" } });
check(ranged.status === 206, `Range status: ${ranged.status}`);
const rangeBytes = new Uint8Array(await ranged.arrayBuffer());
check(rangeBytes.length === Math.min(1024, manifest.bytes), "Incorrect range length");
check(ranged.headers.get("content-range")?.startsWith("bytes 0-") === true, "Missing Content-Range header");

const download = await request(path);
check(download.status === 200, `DMG status: ${download.status}`);
check(download.headers.get("content-type")?.includes("application/x-apple-diskimage") === true, "Wrong DMG content type");
check(download.headers.get("content-disposition")?.includes("attachment") === true, "DMG is not an attachment");
const body = new Uint8Array(await download.arrayBuffer());
check(body.length === manifest.bytes, `DMG size mismatch: ${body.length} vs ${manifest.bytes}`);
const sha256 = createHash("sha256").update(body).digest("hex");
check(sha256 === manifest.sha256, "Downloaded DMG hash differs from manifest");

process.stdout.write(`${JSON.stringify({ base: base.href, home: home.status, studio: studio.status, api: health.status, missing: missing.status, range: ranged.status, filename: manifest.filename, bytes: body.length, sha256 }, null, 2)}\n`);
