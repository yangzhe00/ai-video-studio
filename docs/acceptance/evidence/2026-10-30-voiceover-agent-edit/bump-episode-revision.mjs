import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const dir = dirname(fileURLToPath(import.meta.url));
const credentials = JSON.parse(readFileSync("/private/tmp/avs-integration-credentials.json", "utf8"));
const seed = JSON.parse(readFileSync(join(dir, "local-api-seed.json"), "utf8"));
const base = credentials.baseUrl.replace(/\/$/, "");
const login = await fetch(base + "/auth/login", { method: "POST", headers: {
  "content-type": "application/json", "x-avs-request": "1" },
  body: JSON.stringify({ email: credentials.email, password: credentials.password }) });
if (login.status !== 200) throw new Error(`login HTTP ${login.status}`);
const cookie = login.headers.get("set-cookie")?.split(";")[0] ?? "";
const detail = await fetch(`${base}/projects/${seed.projectId}`, { headers: { cookie } });
if (detail.status !== 200) throw new Error(`project HTTP ${detail.status}`);
const { project } = await detail.json();
const episode = project.document.episodes.find(item => item.id === seed.episodeId);
const revision = project.resourceRevisions.find(item => item.resourceType === "episode" && item.resourceId === seed.episodeId)?.revision;
if (!episode || !revision) throw new Error("test episode or revision missing");
const response = await fetch(`${base}/projects/${seed.projectId}/commands`, { method: "POST", headers: {
  cookie, "content-type": "application/json", "x-avs-request": "1" },
  body: JSON.stringify({ id: randomUUID(), resourceType: "episode", resourceId: seed.episodeId,
    baseRevision: revision, payload: episode }) });
const result = await response.json();
process.stdout.write(JSON.stringify({ status: response.status, previousRevision: revision,
  newRevision: result.resourceRevision ?? null, error: result.error ?? null }) + "\n");
if (response.status !== 200 || result.resourceRevision !== revision + 1) process.exitCode = 1;
