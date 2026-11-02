import { randomUUID, createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const dir = dirname(fileURLToPath(import.meta.url));
const credentials = JSON.parse(readFileSync("/private/tmp/avs-integration-credentials.json", "utf8"));
const seed = JSON.parse(readFileSync(join(dir, "local-api-seed.json"), "utf8"));
const base = credentials.baseUrl.replace(/\/$/, "");
let cookie = "";
const result = { sourceSnapshot: "source-snapshot-restart-before.json", environment: "isolated local PostgreSQL API", steps: [] };

async function request(path, method = "GET", body) {
  const response = await fetch(base + path, { method, headers: {
    ...(cookie ? { cookie } : {}), ...(method === "GET" ? {} : { "x-avs-request": "1" }),
    ...(body ? { "content-type": "application/json" } : {}),
  }, body: body ? JSON.stringify(body) : undefined });
  const json = response.headers.get("content-type")?.includes("application/json") ? await response.json() : null;
  return { response, json };
}
async function poll(path, field) {
  for (let attempt = 0; attempt < 45; attempt++) {
    const { response, json } = await request(path);
    if (response.status !== 200 || !json?.[field]) throw new Error(`${path}: HTTP ${response.status}`);
    if (["succeeded", "failed"].includes(json[field].state)) return json[field];
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  throw new Error(`${path}: timed out`);
}
async function save(id, filename) {
  const { response } = await request(`/objects/${id}`);
  if (response.status !== 200) throw new Error(`download ${filename}: HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  writeFileSync(join(dir, filename), bytes);
  return { filename, bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") };
}
try {
  const login = await request("/auth/login", "POST", { email: credentials.email, password: credentials.password });
  result.steps.push({ step: "login", status: login.response.status });
  if (login.response.status !== 200) throw new Error("login failed");
  cookie = login.response.headers.get("set-cookie")?.split(";")[0] ?? "";
  const detail = await request(`/projects/${seed.projectId}`);
  const project = detail.json?.project;
  const episode = project?.document?.episodes?.find(item => item.id === seed.episodeId);
  if (detail.response.status !== 200 || !episode) throw new Error("test episode missing");
  const expectedEpisodeRevision = project.resourceRevisions?.find(item => item.resourceType === "episode" && item.resourceId === seed.episodeId)?.revision;
  result.episode = { revision: expectedEpisodeRevision, shots: episode.shots?.length, timeline: episode.timeline?.length,
    audio: episode.audio };
  for (const kind of ["preview", "export"]) {
    const path = `/projects/${seed.projectId}/episodes/${seed.episodeId}/${kind === "preview" ? "previews" : "render"}`;
    const body = kind === "preview" ? { previewOperationId: randomUUID(), expectedEpisodeRevision }
      : { renderOperationId: randomUUID(), expectedEpisodeRevision };
    const created = await request(path, "POST", body);
    result.steps.push({ step: `create ${kind}`, status: created.response.status, code: created.json?.code ?? null,
      error: created.json?.error ?? null });
    if (![200, 201].includes(created.response.status)) throw new Error(`${kind} creation failed`);
    const item = created.json[kind === "preview" ? "preview" : "episodeRender"];
    const terminal = await poll(`/${kind === "preview" ? "previews" : "episode-renders"}/${item.id}`,
      kind === "preview" ? "preview" : "episodeRender");
    result.steps.push({ step: `${kind} terminal`, state: terminal.state, error: terminal.error ?? null,
      outputAssetId: terminal.outputAssetId ?? null });
    if (terminal.state !== "succeeded" || !terminal.outputAssetId) throw new Error(`${kind} failed`);
    result[kind] = await save(terminal.outputAssetId, `local-episode-${kind}-after-fix.mp4`);
  }
} catch (error) { result.scriptError = String(error); process.exitCode = 1; }
finally {
  writeFileSync(join(dir, "local-episode-recheck.json"), JSON.stringify(result, null, 2) + "\n");
  process.stdout.write(JSON.stringify(result) + "\n");
}
