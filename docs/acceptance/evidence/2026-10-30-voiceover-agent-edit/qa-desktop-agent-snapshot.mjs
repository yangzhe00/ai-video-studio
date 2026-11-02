import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const label = process.argv[2];
if (!["before", "after"].includes(label)) throw new Error("Expected before or after");
const dir = dirname(fileURLToPath(import.meta.url));
const session = JSON.parse(readFileSync("/private/tmp/avs-feature-accept-session.json", "utf8"));
const base = "http://127.0.0.1:8788";
const login = await fetch(`${base}/auth/login`, { method: "POST", headers: {
  "content-type": "application/json", "x-avs-request": "1",
}, body: JSON.stringify({ email: session.email, password: session.password }) });
if (login.status !== 200) throw new Error(`Login HTTP ${login.status}`);
const cookie = login.headers.get("set-cookie")?.split(";")[0] ?? "";
const get = async path => {
  const response = await fetch(base + path, { headers: { cookie } });
  return { status: response.status, body: await response.json() };
};
const [edit, account, runs, versions] = await Promise.all([
  get(`/video-edits/${session.editId}`), get("/auth/me"),
  get(`/projects/${session.projectId}/runs`), get(`/video-edits/${session.editId}/versions`),
]);
const output = { label, environment: "isolated desktop API 8788; local mock Agent provider 8789",
  statuses: { login: login.status, edit: edit.status, account: account.status,
    runs: runs.status, versions: versions.status },
  projectId: session.projectId, episodeId: session.episodeId, editId: session.editId,
  revision: edit.body.edit?.recipe?.revision ?? null,
  trimStartMs: edit.body.edit?.recipe?.trimStartMs ?? null,
  trimEndMs: edit.body.edit?.recipe?.trimEndMs ?? null,
  demoReserved: account.body.account?.demo_reserved ?? null,
  demoUsed: account.body.account?.demo_used ?? null,
  videoRunCount: runs.body.runs?.length ?? null,
  versionCount: versions.body.versions?.length ?? null };
writeFileSync(join(dir, `local-desktop-agent-${label}.json`), JSON.stringify(output, null, 2) + "\n");
process.stdout.write(JSON.stringify(output) + "\n");
