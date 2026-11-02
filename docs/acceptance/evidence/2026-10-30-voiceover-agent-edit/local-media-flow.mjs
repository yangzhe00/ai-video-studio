import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const evidenceDir = dirname(fileURLToPath(import.meta.url));
const credentials = JSON.parse(readFileSync("/private/tmp/avs-integration-credentials.json", "utf8"));
const seed = JSON.parse(readFileSync(join(evidenceDir, process.env.QA_SEED_FILE ?? "local-api-seed.json"), "utf8"));
const artifactSuffix = process.env.QA_ARTIFACT_SUFFIX ?? "";
const requireFromApi = createRequire(join(evidenceDir, "../../../../apps/api/package.json"));
const ffprobe = requireFromApi("@ffprobe-installer/ffprobe").path;
const base = credentials.baseUrl.replace(/\/$/, "");
const result = { environment: "local PostgreSQL API, synthetic media, no paid provider call", steps: [] };
let cookie = "";
async function request(path, method = "GET", body, contentType = "application/json") {
  const response = await fetch(base + path, { method, headers: {
    ...(cookie ? { cookie } : {}), ...(method === "GET" ? {} : { "x-avs-request": "1" }),
    ...(body == null ? {} : { "content-type": contentType }),
  }, body: body == null ? undefined : contentType === "application/json" ? JSON.stringify(body) : body });
  const json = response.headers.get("content-type")?.includes("application/json") ? await response.json() : null;
  return { status: response.status, json, response };
}
function record(label, response, extra = {}) {
  const step = { label, status: response.status, code: response.json?.code ?? null, error: response.json?.error ?? null, ...extra };
  result.steps.push(step);
  return step;
}
async function poll(path, field, limit = 30) {
  for (let attempt = 0; attempt < limit; attempt++) {
    const response = await request(path);
    const item = response.json?.[field];
    if (response.status !== 200 || !item) throw new Error(`${path}: HTTP ${response.status}`);
    if (["succeeded", "failed"].includes(item.state)) return { response, item, attempt };
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  throw new Error(`${path}: timed out`);
}
async function saveObject(id, filename) {
  const response = await request(`/objects/${id}`);
  if (response.status !== 200) throw new Error(`Download ${filename}: HTTP ${response.status}`);
  const path = join(evidenceDir, filename);
  writeFileSync(path, new Uint8Array(await response.response.arrayBuffer()));
  const probe = JSON.parse(execFileSync(ffprobe, ["-v", "error", "-show_entries", "format=duration:stream=codec_type,codec_name", "-of", "json", path], { encoding: "utf8" }));
  return { path, durationSec: Number(probe.format?.duration), streams: probe.streams };
}
try {
  const login = await request("/auth/login", "POST", { email: credentials.email, password: credentials.password });
  record("login", login);
  if (login.status !== 200) throw new Error("Test login failed");
  cookie = login.response.headers.get("set-cookie")?.split(";")[0] ?? "";
  const project = await request(`/projects/${seed.projectId}`);
  record("project detail", project);
  const voice = project.json?.project?.document?.assets?.find(asset => asset.kind === "voice" && asset.name === "voice-5s.wav");
  if (!voice) throw new Error("Browser-uploaded voice asset not found in project");
  const editBefore = await request(`/video-edits/${seed.edit.editId}`);
  record("edit before", editBefore, { revision: editBefore.json?.edit?.recipe?.revision ?? null });
  const revision = editBefore.json?.edit?.recipe?.revision;
  const mix = { type: "set-audio-mix", originalVolume: 0.3,
    voiceClips: [{ assetId: voice.id, startMs: 500, inMs: 0, outMs: 4000, volume: 1 }], musicClips: [] };
  const saved = await request(`/video-edits/${seed.edit.editId}/commands`, "POST",
    { commandId: randomUUID(), expectedRevision: revision, command: mix });
  record("save voice mix", saved, { revision: saved.json?.edit?.recipe?.revision ?? null, voiceAssetId: voice.id });
  if (saved.status !== 200) throw new Error("Voice mix save failed");
  const expectedRevision = saved.json.edit.recipe.revision;
  const previewId = randomUUID();
  const createdPreview = await request(`/video-edits/${seed.edit.editId}/previews`, "POST",
    { previewOperationId: previewId, expectedRevision });
  record("create shot preview", createdPreview, { previewId: createdPreview.json?.preview?.id ?? null });
  if (![200, 201].includes(createdPreview.status)) throw new Error("Preview creation failed");
  const preview = await poll(`/previews/${createdPreview.json.preview.id}`, "preview");
  record("shot preview terminal", preview.response, { state: preview.item.state, error: preview.item.error ?? null,
    outputAssetId: preview.item.outputAssetId ?? null, pollAttempts: preview.attempt });
  if (preview.item.state === "succeeded" && preview.item.outputAssetId) result.previewMedia = await saveObject(preview.item.outputAssetId, `local-shot-mixed-preview${artifactSuffix}.mp4`);
  const renderId = randomUUID();
  const createdRender = await request(`/video-edits/${seed.edit.editId}/render`, "POST",
    { renderOperationId: renderId, expectedRevision });
  record("create shot export", createdRender, { renderId: createdRender.json?.render?.id ?? null });
  if (![200, 201].includes(createdRender.status) && !createdRender.json?.render?.id) throw new Error("Export creation failed");
  const render = await poll(`/renders/${createdRender.json.render.id}`, "render");
  record("shot export terminal", render.response, { state: render.item.state, error: render.item.error ?? null,
    outputAssetId: render.item.outputAssetId ?? null, pollAttempts: render.attempt });
  if (render.item.state === "succeeded" && render.item.outputAssetId) result.exportMedia = await saveObject(render.item.outputAssetId, `local-shot-mixed-export${artifactSuffix}.mp4`);
  const versions = await request(`/video-edits/${seed.edit.editId}/versions`);
  record("versions", versions, { originalAssetId: versions.json?.originalAssetId ?? null,
    versionCount: versions.json?.versions?.length ?? null });
} catch (error) {
  result.scriptError = String(error);
  process.exitCode = 1;
} finally {
  writeFileSync(join(evidenceDir, `local-media-flow${artifactSuffix}.json`), JSON.stringify(result, null, 2) + "\n");
  process.stdout.write(JSON.stringify(result) + "\n");
}
