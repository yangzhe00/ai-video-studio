import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const evidenceDir = dirname(fileURLToPath(import.meta.url));
const credentials = JSON.parse(readFileSync("/private/tmp/avs-integration-credentials.json", "utf8"));
const base = credentials.baseUrl.replace(/\/$/, "");
let cookie = "";
async function call(path, method = "GET", body, contentType = "application/json") {
  const headers = { ...(cookie ? { cookie } : {}), ...(method === "GET" ? {} : { "x-avs-request": "1" }),
    ...(body == null ? {} : { "content-type": contentType }) };
  const response = await fetch(base + path, { method, headers, body: body == null ? undefined : contentType === "application/json" ? JSON.stringify(body) : body });
  const payload = await response.json().catch(() => ({}));
  return { status: response.status, payload, setCookie: response.headers.get("set-cookie") };
}
const login = await call("/auth/login", "POST", { email: credentials.email, password: credentials.password });
if (login.status !== 200) throw new Error(`Test account login failed: HTTP ${login.status}, code=${String(login.payload.code ?? "none")}, error=${String(login.payload.error ?? "none")}`);
cookie = login.setCookie?.split(";")[0] ?? "";
const list = await call("/projects");
const project = list.payload.projects?.find((item) => item.title === "QA 配音 Agent 2026-10-30");
if (!project) throw new Error("QA project not found in isolated account");
const projectId = project.id;
const detail = await call(`/projects/${projectId}`);
const episode = detail.payload.project?.document?.episodes?.[0];
if (!episode) throw new Error("QA project episode not found");

const photo = await call("/objects", "POST", readFileSync(join(evidenceDir, "fixtures/reference.jpg")), "image/jpeg");
const before = await call(`/projects/${projectId}/runs`);
const invalidTen = await call(`/projects/${projectId}/runs`, "POST", {
  clientRequestId: `qa-ten-${randomUUID()}`, episodeId: episode.id, sourceAssetId: photo.payload.object?.id,
  input: "测试 10 秒新建镜头应被拒绝", durationSec: 10,
});
const after = await call(`/projects/${projectId}/runs`);

const video = await call("/objects", "POST", readFileSync(join(evidenceDir, "fixtures/shot-audio-5s.mp4")), "video/mp4");
if (![200, 201].includes(video.status) || !video.payload.object?.id) throw new Error(`Video upload failed: HTTP ${video.status}`);
const videoId = video.payload.object.id;
const assetCommand = await call(`/projects/${projectId}/commands`, "POST", {
  id: `qa-asset-${randomUUID()}`, resourceType: "asset", resourceId: videoId, baseRevision: 0,
  payload: { id: videoId, kind: "video" },
});
const shotId = `qa-shot-${randomUUID()}`;
const episodeCommand = await call(`/projects/${projectId}/commands`, "POST", {
  id: `qa-episode-${randomUUID()}`, resourceType: "episode", resourceId: episode.id, baseRevision: 1,
  payload: { ...episode, shots: [...(episode.shots ?? []), { id: shotId, runId: shotId, resultAssetId: videoId,
    sourceAssetId: videoId, prompt: "合成蓝色 5 秒测试镜头", durationSec: 5 }], timeline: [videoId] },
});
const edit = episodeCommand.status === 200 ? await call("/video-edits", "POST", { projectId, episodeId: episode.id, shotId }) : null;
const result = {
  environment: "isolated local PostgreSQL API", apiBase: base, paidProviderCall: false,
  loginStatus: login.status, projectListStatus: list.status, projectDetailStatus: detail.status,
  projectId, episodeId: episode.id, photoUploadStatus: photo.status,
  invalidNewTenSeconds: { status: invalidTen.status, code: invalidTen.payload.code ?? null, error: invalidTen.payload.error ?? null,
    runsBefore: before.payload.runs?.length ?? null, runsAfter: after.payload.runs?.length ?? null },
  videoUploadStatus: video.status, videoObjectId: videoId,
  assetCommand: { status: assetCommand.status, code: assetCommand.payload.code ?? null, error: assetCommand.payload.error ?? null },
  episodeCommand: { status: episodeCommand.status, code: episodeCommand.payload.code ?? null, error: episodeCommand.payload.error ?? null },
  edit: edit ? { status: edit.status, code: edit.payload.code ?? null, error: edit.payload.error ?? null, editId: edit.payload.edit?.id ?? null } : null,
};
writeFileSync(join(evidenceDir, "local-api-seed.json"), JSON.stringify(result, null, 2) + "\n");
process.stdout.write(JSON.stringify(result) + "\n");
