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
const result = { environment: "local PostgreSQL API, synthetic two-shot episode, no paid provider call", steps: [] };
let cookie = "";
async function request(path, method = "GET", body, type = "application/json") {
  const response = await fetch(base + path, { method, headers: {
    ...(cookie ? { cookie } : {}), ...(method === "GET" ? {} : { "x-avs-request": "1" }),
    ...(body == null ? {} : { "content-type": type }),
  }, body: body == null ? undefined : type === "application/json" ? JSON.stringify(body) : body });
  const json = response.headers.get("content-type")?.includes("application/json") ? await response.json() : null;
  return { status: response.status, json, response };
}
function record(label, response, extra = {}) {
  const step = { label, status: response.status, code: response.json?.code ?? null, error: response.json?.error ?? null, ...extra };
  result.steps.push(step); return step;
}
async function poll(path, field) {
  for (let attempt = 0; attempt < 30; attempt++) {
    const response = await request(path), item = response.json?.[field];
    if (response.status !== 200 || !item) throw new Error(`${path}: HTTP ${response.status}`);
    if (["succeeded", "failed"].includes(item.state)) return { response, item, attempt };
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  throw new Error(`${path}: timed out`);
}
async function saveObject(id, name) {
  const response = await request(`/objects/${id}`);
  if (response.status !== 200) throw new Error(`Download ${name}: HTTP ${response.status}`);
  const path = join(evidenceDir, name);
  writeFileSync(path, new Uint8Array(await response.response.arrayBuffer()));
  const probe = JSON.parse(execFileSync(ffprobe, ["-v", "error", "-show_entries", "format=duration:stream=codec_type,codec_name", "-of", "json", path], { encoding: "utf8" }));
  return { path, durationSec: Number(probe.format?.duration), streams: probe.streams };
}
try {
  const login = await request("/auth/login", "POST", { email: credentials.email, password: credentials.password });
  record("login", login); if (login.status !== 200) throw new Error("Test login failed");
  cookie = login.response.headers.get("set-cookie")?.split(";")[0] ?? "";
  const before = await request(`/projects/${seed.projectId}`);
  record("project before", before);
  const project = before.json?.project, episode = project?.document?.episodes?.find(item => item.id === seed.episodeId);
  const voice = project?.document?.assets?.find(item => item.kind === "voice" && item.name === "voice-5s.wav");
  if (!episode || !voice) throw new Error("Episode or voice asset missing");
  const second = await request("/objects", "POST", readFileSync(join(evidenceDir, "fixtures/shot-silent-5s.mp4")), "video/mp4");
  record("upload silent second shot", second);
  if (![200, 201].includes(second.status)) throw new Error("Second shot upload failed");
  const secondId = second.json.object.id;
  const secondAsset = await request(`/projects/${seed.projectId}/commands`, "POST", { id: randomUUID(), resourceType: "asset",
    resourceId: secondId, baseRevision: 0, payload: { id: secondId, kind: "video" } });
  record("register second shot asset", secondAsset);
  const musicUpload = await request("/objects", "POST", readFileSync(join(evidenceDir, "fixtures/music-12s.wav")), "audio/wav");
  record("upload music", musicUpload);
  if (![200, 201].includes(musicUpload.status)) throw new Error("Music upload failed");
  const musicId = musicUpload.json.object.id;
  const musicAsset = await request(`/projects/${seed.projectId}/commands`, "POST", { id: randomUUID(), resourceType: "asset",
    resourceId: musicId, baseRevision: 0, payload: { id: musicId, kind: "music", name: "music-12s.wav",
      mimeType: "audio/wav", durationMs: musicUpload.json.object.durationMs } });
  record("register music asset", musicAsset);
  const latest = await request(`/projects/${seed.projectId}`);
  const current = latest.json?.project?.document?.episodes?.find(item => item.id === seed.episodeId);
  const revision = latest.json?.project?.resourceRevisions?.find(item => item.resourceType === "episode" && item.resourceId === seed.episodeId)?.revision ?? 2;
  const shotId = `qa-shot-${randomUUID()}`;
  const timeline = [seed.videoObjectId, secondId];
  const timelineClips = timeline.map((assetId, index) => ({ id: `qa-clip-${randomUUID()}`, assetId,
    inMs: 0, outMs: 5000, volume: 1 }));
  const audio = { originalVolume: 0.4,
    voiceClips: [{ assetId: voice.id, startMs: 3000, inMs: 0, outMs: 5000, volume: 1 }],
    musicClips: [{ assetId: musicId, startMs: 0, inMs: 0, outMs: 10000, volume: 0.2 }] };
  const changed = await request(`/projects/${seed.projectId}/commands`, "POST", { id: randomUUID(), resourceType: "episode",
    resourceId: seed.episodeId, baseRevision: revision,
    payload: { ...current, shots: [...current.shots, { id: shotId, runId: shotId, resultAssetId: secondId,
      sourceAssetId: secondId, prompt: "合成红色 5 秒第二镜头", durationSec: 5 }], timeline, timelineClips, audio } });
  record("save two-shot episode and cross-boundary audio", changed, { episodeRevision: changed.json?.resourceRevision ?? null });
  if (changed.status !== 200) throw new Error("Episode command failed");
  const expectedEpisodeRevision = changed.json.resourceRevision;
  const previewCreated = await request(`/projects/${seed.projectId}/episodes/${seed.episodeId}/previews`, "POST",
    { previewOperationId: randomUUID(), expectedEpisodeRevision });
  record("create episode preview", previewCreated, { previewId: previewCreated.json?.preview?.id ?? null });
  if (![200, 201].includes(previewCreated.status)) throw new Error("Episode preview creation failed");
  const preview = await poll(`/previews/${previewCreated.json.preview.id}`, "preview");
  record("episode preview terminal", preview.response, { state: preview.item.state, error: preview.item.error ?? null,
    outputAssetId: preview.item.outputAssetId ?? null, pollAttempts: preview.attempt });
  if (preview.item.state === "succeeded" && preview.item.outputAssetId) result.previewMedia = await saveObject(preview.item.outputAssetId, `local-episode-mixed-preview${artifactSuffix}.mp4`);
  const exportCreated = await request(`/projects/${seed.projectId}/episodes/${seed.episodeId}/render`, "POST",
    { renderOperationId: randomUUID(), expectedEpisodeRevision });
  record("create episode export", exportCreated, { renderId: exportCreated.json?.episodeRender?.id ?? null });
  if (![200, 201].includes(exportCreated.status)) throw new Error("Episode export creation failed");
  const exported = await poll(`/episode-renders/${exportCreated.json.episodeRender.id}`, "episodeRender");
  record("episode export terminal", exported.response, { state: exported.item.state, error: exported.item.error ?? null,
    outputAssetId: exported.item.outputAssetId ?? null, pollAttempts: exported.attempt });
  if (exported.item.state === "succeeded" && exported.item.outputAssetId) result.exportMedia = await saveObject(exported.item.outputAssetId, `local-episode-mixed-export${artifactSuffix}.mp4`);
  result.audio = audio;
} catch (error) { result.scriptError = String(error); process.exitCode = 1; }
finally {
  writeFileSync(join(evidenceDir, `local-episode-flow${artifactSuffix}.json`), JSON.stringify(result, null, 2) + "\n");
  process.stdout.write(JSON.stringify(result) + "\n");
}
