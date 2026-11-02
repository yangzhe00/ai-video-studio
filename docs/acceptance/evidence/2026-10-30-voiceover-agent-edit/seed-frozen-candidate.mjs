import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const dir = dirname(fileURLToPath(import.meta.url));
const credentials = JSON.parse(readFileSync("/private/tmp/avs-integration-credentials.json", "utf8"));
const base = credentials.baseUrl.replace(/\/$/, "");
let cookie = "";
async function request(path, method = "GET", body, type = "application/json") {
  const response = await fetch(base + path, { method, headers: {
    ...(cookie ? { cookie } : {}), ...(method === "GET" ? {} : { "x-avs-request": "1" }),
    ...(body == null ? {} : { "content-type": type }),
  }, body: body == null ? undefined : type === "application/json" ? JSON.stringify(body) : body });
  return { status: response.status, body: await response.json(), setCookie: response.headers.get("set-cookie") };
}
function ok(label, result, expected) {
  if (!expected.includes(result.status)) throw new Error(`${label}: HTTP ${result.status}, ${result.body?.error ?? "unknown"}`);
  return result.body;
}

const login = await request("/auth/login", "POST", { email: credentials.email, password: credentials.password });
ok("login", login, [200]);
cookie = login.setCookie?.split(";")[0] ?? "";
const title = `QA Frozen Audio ${randomUUID().slice(0, 8)}`;
const created = await request("/projects", "POST", { title });
const project = ok("project", created, [201]).project;
const projectId = project.id, episode = project.document.episodes[0];
if (!episode) throw new Error("new project has no episode");
const photo = await request("/objects", "POST", readFileSync(join(dir, "fixtures/reference.jpg")), "image/jpeg");
const photoId = ok("photo", photo, [200, 201]).object.id;
const beforeRuns = await request(`/projects/${projectId}/runs`);
const invalidTen = await request(`/projects/${projectId}/runs`, "POST", {
  clientRequestId: randomUUID(), episodeId: episode.id, sourceAssetId: photoId,
  input: "验证新建 10 秒被拒绝", durationSec: 10 });
const afterRuns = await request(`/projects/${projectId}/runs`);
const video = await request("/objects", "POST", readFileSync(join(dir, "fixtures/shot-audio-5s.mp4")), "video/mp4");
const videoId = ok("video", video, [200, 201]).object.id;
ok("video asset", await request(`/projects/${projectId}/commands`, "POST", {
  id: randomUUID(), resourceType: "asset", resourceId: videoId, baseRevision: 0,
  payload: { id: videoId, kind: "video" },
}), [200]);
const voice = await request("/objects", "POST", readFileSync(join(dir, "fixtures/voice-5s.wav")), "audio/wav");
const voiceObject = ok("voice", voice, [200, 201]).object;
ok("voice asset", await request(`/projects/${projectId}/commands`, "POST", {
  id: randomUUID(), resourceType: "asset", resourceId: voiceObject.id, baseRevision: 0,
  payload: { id: voiceObject.id, kind: "voice", name: "voice-5s.wav", mimeType: "audio/wav",
    durationMs: voiceObject.durationMs },
}), [200]);
const shotId = `qa-shot-${randomUUID()}`;
const episodeCommand = await request(`/projects/${projectId}/commands`, "POST", {
  id: randomUUID(), resourceType: "episode", resourceId: episode.id, baseRevision: 1,
  payload: { ...episode, shots: [{ id: shotId, runId: shotId, resultAssetId: videoId,
    sourceAssetId: videoId, prompt: "冻结候选蓝色 5 秒镜头", durationSec: 5 }], timeline: [videoId] },
});
ok("episode", episodeCommand, [200]);
const editResponse = await request("/video-edits", "POST", { projectId, episodeId: episode.id, shotId });
const edit = ok("video edit", editResponse, [201]).edit;
const output = { environment: "fresh project on isolated PostgreSQL API after candidate restart",
  archiveSha256: "648bff4b2475260b0a10b1d81198a542aac2dacdb97d5bba3902e8206d711b2d",
  projectTitle: title, projectId, episodeId: episode.id, videoObjectId: videoId, voiceObjectId: voiceObject.id,
  edit: { editId: edit.id, status: editResponse.status },
  statuses: { project: created.status, photo: photo.status, video: video.status, voice: voice.status,
    episode: episodeCommand.status, invalidNewTen: invalidTen.status,
    runsBefore: beforeRuns.body.runs?.length, runsAfter: afterRuns.body.runs?.length },
  paidProviderCall: false };
writeFileSync(join(dir, "frozen-api-seed.json"), JSON.stringify(output, null, 2) + "\n");
process.stdout.write(JSON.stringify(output) + "\n");
