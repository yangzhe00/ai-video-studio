import assert from "node:assert/strict";
import { test } from "node:test";
import { verifyPublic } from "./verify-public.mjs";

const base = new URL("http://127.0.0.1:8787/");
function responses(downloadLink = '<a id="download-link" aria-disabled="true">下载准备中</a>', manifestStatus = 404) {
  const route = new Map([
    ["/downloads/latest.json", new Response("", { status: manifestStatus })],
    ["/", new Response(`<html>AI Video Studio <a href="/studio/">创作</a>${downloadLink}</html>`, { status: 200 })],
    ["/studio/", new Response('<script src="/studio/assets/app.js"></script>', { status: 200 })],
    ["/studio/project/route-check", new Response('<script src="/studio/assets/app.js"></script>', { status: 200 })],
    ["/api/health", Response.json({ ok: true })],
    ["/downloads/missing.dmg", new Response("", { status: 404 })],
  ]);
  return async (path) => {
    assert.ok(route.has(path), `Unexpected route ${path}`);
    return route.get(path).clone();
  };
}

test("publishes the website with a disabled download when no DMG exists", async () => {
  const result = await verifyPublic(base, responses());
  assert.equal(result.downloads, "disabled");
  assert.equal(result.api, 200);
});

test("rejects a live download link when the DMG manifest is missing", async () => {
  await assert.rejects(verifyPublic(base, responses('<a id="download-link" href="/downloads/old.dmg" aria-disabled="false">下载</a>')), /CTA is not disabled/);
});

test("rejects an unexpected manifest response", async () => {
  await assert.rejects(verifyPublic(base, responses(undefined, 500)), /manifest status/);
});

test("does not permit plaintext public origins", async () => {
  await assert.rejects(verifyPublic(new URL("http://example.com/"), responses()), /requires HTTPS/);
});
