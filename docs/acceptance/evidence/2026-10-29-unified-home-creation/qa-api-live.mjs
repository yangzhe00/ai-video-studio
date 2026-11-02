// Isolated local acceptance helper. Uses HTTP auth and mock services only.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";

const base = "http://127.0.0.1:18796";
const mock = "http://127.0.0.1:18795";

async function request(path, method = "GET", body, cookie, mime = "application/json") {
  const response = await fetch(base + path, { method, headers: {
    ...(body === undefined ? {} : { "content-type": mime }),
    ...(cookie ? { cookie } : {}),
  }, body: body === undefined ? undefined : mime === "application/json" ? JSON.stringify(body) : body });
  return { status: response.status, payload: await response.json(), cookie: response.headers.get("set-cookie")?.split(";")[0] ?? "" };
}

async function register(label) {
  const result = await request("/auth/register", "POST", { email: `qa-${label}-${randomUUID()}@example.test`, password: "qa-password-123456" });
  assert.equal(result.status, 201, JSON.stringify(result.payload));
  return result;
}

function brief(id, text) {
  return { id, source: "manual", originalText: text, finalText: text, createdAt: 100, updatedAt: 100 };
}

async function verify() {
  const a = await register("api-a");
  const b = await register("api-b");
  const id = randomUUID(), episodeId = randomUUID(), briefId = randomUUID();
  const firstBrief = brief(briefId, "第一幕：小狗做饭。第二幕：小狗上菜。");
  const creation = { id, title: "QA 响应丢失恢复", initialEpisodeId: episodeId, initialBrief: firstBrief };
  const created = await request("/projects", "POST", creation, a.cookie);
  assert.equal(created.status, 201, JSON.stringify(created.payload));
  const replay = await request("/projects", "POST", creation, a.cookie);
  assert.equal(replay.status, 200);
  assert.equal(replay.payload.project.id, id);
  assert.equal(replay.payload.project.document.briefs.length, 1);
  assert.equal((await request("/projects", "POST", { ...creation, title: "不同意图" }, a.cookie)).status, 409);
  assert.equal((await request(`/projects/${id}`, "GET", undefined, b.cookie)).status, 404);

  const secondId = randomUUID(), second = brief(secondId, "新增补充镜头");
  const command = { id: randomUUID(), resourceType: "brief", resourceId: secondId, baseRevision: 0, payload: second };
  const appended = await request(`/projects/${id}/commands`, "POST", command, a.cookie);
  assert.equal(appended.status, 200, JSON.stringify(appended.payload));
  assert.equal((await request(`/projects/${id}/commands`, "POST", command, a.cookie)).payload.replayed, true);
  const newer = { ...second, finalText: "第二稿", updatedAt: 101 };
  const edited = await request(`/projects/${id}/commands`, "POST", { ...command, id: randomUUID(), baseRevision: 1, payload: newer }, a.cookie);
  assert.equal(edited.status, 200);
  const stale = await request(`/projects/${id}/commands`, "POST", { ...command, id: randomUUID(), baseRevision: 1,
    payload: { ...second, finalText: "过期覆盖", updatedAt: 102 } }, a.cookie);
  assert.equal(stale.status, 409);
  assert.equal(stale.payload.conflict.resourceRevision, 2);
  assert.equal(stale.payload.conflict.resource.finalText, "第二稿");
  assert.equal((await request(`/projects/${id}`, "GET", undefined, a.cookie)).payload.project.document.episodes[0].id, episodeId);

  const before = await (await fetch(mock + "/__counts")).json();
  const intent = { clientRequestId: randomUUID(), input: "猫咪端菜" };
  const [one, same] = await Promise.all([request("/prompt-ideas", "POST", intent, a.cookie), request("/prompt-ideas", "POST", intent, a.cookie)]);
  assert.equal(one.payload.ideaSet.id, same.payload.ideaSet.id);
  assert.equal(one.payload.ideaSet.variants.length, 3);
  assert.equal((await request("/prompt-ideas", "POST", intent, a.cookie)).payload.ideaSet.id, one.payload.ideaSet.id);
  const after = await (await fetch(mock + "/__counts")).json();
  assert.equal(after.calls - before.calls, 1);
  assert.equal((await request(`/prompt-ideas/${one.payload.ideaSet.id}`, "GET", undefined, b.cookie)).status, 404);
  console.log(JSON.stringify({ result: "PASS", createReplay: id, oneBriefAfterReplay: true, appendReplay: true,
    staleConflict: stale.payload.conflict, accountIsolation: true, mockCallsAdded: after.calls - before.calls }, null, 2));
}

async function seedCanvas() {
  const login = await request("/auth/login", "POST", { email: "qa-unified-20261029@example.test", password: "qa-password-123456" });
  assert.equal(login.status, 200, JSON.stringify(login.payload));
  const cookie = login.cookie;
  const listing = await request("/projects", "GET", undefined, cookie);
  const target = listing.payload.projects.find(project => project.title === "QA 完整剧本画布");
  assert.ok(target, "QA canvas project absent");
  let project = (await request(`/projects/${target.id}`, "GET", undefined, cookie)).payload.project;
  const episodeId = project.document.episodes[0].id;
  const clips = ["blue", "green"];
  const uploaded = [];
  for (const color of clips) {
    const bytes = await readFile(`/private/tmp/avs-unified-qa.oKzfVz/qa-clip-${color}.mp4`);
    const object = await request("/objects", "POST", bytes, cookie, "video/mp4");
    assert.ok([200, 201].includes(object.status), JSON.stringify(object.payload));
    const assetId = object.payload.object.id;
    const asset = await request(`/projects/${target.id}/commands`, "POST", { id: randomUUID(), resourceType: "asset", resourceId: assetId,
      baseRevision: 0, payload: { id: assetId, kind: "video", name: `QA ${color} clip`, durationSec: 2 } }, cookie);
    assert.equal(asset.status, 200, JSON.stringify(asset.payload));
    uploaded.push(assetId);
  }
  project = (await request(`/projects/${target.id}`, "GET", undefined, cookie)).payload.project;
  const canvas = project.document.extensions.canvas;
  const graph = canvas.episodeGraphs[episodeId];
  const videoNodes = graph.nodes.filter(node => node.type === "video");
  assert.equal(videoNodes.length, 2);
  const seeded = { ...graph, nodes: graph.nodes.map(node => node.type === "video"
    ? { ...node, resultAssetId: uploaded[videoNodes.findIndex(candidate => candidate.id === node.id)] } : node) };
  const revision = project.resourceRevisions.find(item => item.resourceType === "canvas" && item.resourceId === episodeId)?.revision ?? 0;
  const result = await request(`/projects/${target.id}/commands`, "POST", { id: randomUUID(), resourceType: "canvas", resourceId: episodeId,
    baseRevision: revision, payload: seeded }, cookie);
  assert.equal(result.status, 200, JSON.stringify(result.payload));
  console.log(JSON.stringify({ result: "SEEDED", projectId: target.id, episodeId, assetIds: uploaded, videoNodeIds: videoNodes.map(node => node.id),
    note: "Local generated MP4 fixtures; no video model generation" }, null, 2));
}

async function probeTimeline() {
  const login = await request("/auth/login", "POST", { email: "qa-unified-20261029@example.test", password: "qa-password-123456" });
  assert.equal(login.status, 200);
  const cookie = login.cookie;
  const listing = await request("/projects", "GET", undefined, cookie);
  const target = listing.payload.projects.find(project => project.title === "QA 完整剧本画布");
  const project = (await request(`/projects/${target.id}`, "GET", undefined, cookie)).payload.project;
  const episode = project.document.episodes[0];
  const asset = project.document.assets.find(item => item.kind === "video");
  const revision = project.resourceRevisions.find(item => item.resourceType === "episode" && item.resourceId === episode.id)?.revision ?? 0;
  const payload = { ...episode, timeline: [asset.id], timelineClips: [{ id: randomUUID(), assetId: asset.id, inMs: 0, outMs: 2000, volume: 1 }] };
  const result = await request(`/projects/${target.id}/commands`, "POST", { id: randomUUID(), resourceType: "episode", resourceId: episode.id,
    baseRevision: revision, payload }, cookie);
  console.log(JSON.stringify({ status: result.status, payload: result.payload }, null, 2));
  assert.equal(result.status, 200);
}

async function forceBriefConflict() {
  const login = await request("/auth/login", "POST", { email: "qa-unified-20261029@example.test", password: "qa-password-123456" });
  assert.equal(login.status, 200);
  const cookie = login.cookie;
  const listing = await request("/projects", "GET", undefined, cookie);
  const target = listing.payload.projects.find(project => project.title === "QA 完整剧本画布");
  const project = (await request(`/projects/${target.id}`, "GET", undefined, cookie)).payload.project;
  const item = project.document.briefs.find(entry => entry.originalText.startsWith("补充镜头"));
  const revision = project.resourceRevisions.find(entry => entry.resourceType === "brief" && entry.resourceId === item.id).revision;
  const updated = { ...item, finalText: "服务端已修改的第二稿", updatedAt: Date.now() };
  const result = await request(`/projects/${target.id}/commands`, "POST", { id: randomUUID(), resourceType: "brief", resourceId: item.id,
    baseRevision: revision, payload: updated }, cookie);
  assert.equal(result.status, 200, JSON.stringify(result.payload));
  console.log(JSON.stringify({ result: "UPDATED", briefId: item.id, revision: revision + 1, finalText: updated.finalText }));
}

async function verifyUnknown() {
  const a = await register("unknown");
  const before = await (await fetch(mock + "/__counts")).json();
  const intent = { clientRequestId: randomUUID(), input: "小狗洗菜" };
  const first = await request("/prompt-ideas", "POST", intent, a.cookie);
  assert.equal(first.payload.ideaSet.state, "unknown", JSON.stringify(first.payload));
  const replay = await request("/prompt-ideas", "POST", intent, a.cookie);
  assert.equal(replay.payload.ideaSet.id, first.payload.ideaSet.id);
  assert.equal(replay.payload.ideaSet.state, "unknown");
  const after = await (await fetch(mock + "/__counts")).json();
  assert.equal(after.calls - before.calls, 1);
  console.log(JSON.stringify({ result: "PASS", ideaSetId: first.payload.ideaSet.id, state: "unknown", modelCallsAdded: 1 }));
}

if (process.argv[2] === "verify") await verify();
else if (process.argv[2] === "seed-canvas") await seedCanvas();
else if (process.argv[2] === "probe-timeline") await probeTimeline();
else if (process.argv[2] === "force-brief-conflict") await forceBriefConflict();
else if (process.argv[2] === "verify-unknown") await verifyUnknown();
else throw new Error("Expected verify or seed-canvas");
