import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const evidenceDir = dirname(fileURLToPath(import.meta.url));
const credentials = JSON.parse(readFileSync("/private/tmp/avs-integration-credentials.json", "utf8"));
const seed = JSON.parse(readFileSync(join(evidenceDir, "local-api-seed.json"), "utf8"));
const base = credentials.baseUrl.replace(/\/$/, "");
const result = { environment: "local PostgreSQL API, no configured Agent edit model, no video/TTS provider call", steps: [] };
let cookie = "";
async function request(path, method = "GET", body) {
  const response = await fetch(base + path, { method, headers: {
    ...(cookie ? { cookie } : {}), ...(method === "GET" ? {} : { "x-avs-request": "1" }),
    ...(body == null ? {} : { "content-type": "application/json" }),
  }, body: body == null ? undefined : JSON.stringify(body) });
  const json = response.headers.get("content-type")?.includes("application/json") ? await response.json() : null;
  return { status: response.status, json, response };
}
function record(label, response, extra = {}) {
  const step = { label, status: response.status, code: response.json?.code ?? null, error: response.json?.error ?? null, ...extra };
  result.steps.push(step); return step;
}
async function snapshot(label) {
  const [edit, account, runs, versions] = await Promise.all([
    request(`/video-edits/${seed.edit.editId}`), request("/auth/me"), request(`/projects/${seed.projectId}/runs`),
    request(`/video-edits/${seed.edit.editId}/versions`),
  ]);
  return record(label, edit, { revision: edit.json?.edit?.recipe?.revision ?? null,
    trimStartMs: edit.json?.edit?.recipe?.trimStartMs ?? null, trimEndMs: edit.json?.edit?.recipe?.trimEndMs ?? null,
    demoReserved: account.json?.account?.demo_reserved ?? null, demoUsed: account.json?.account?.demo_used ?? null,
    videoRunCount: runs.json?.runs?.length ?? null, versionCount: versions.json?.versions?.length ?? null });
}
try {
  const login = await request("/auth/login", "POST", { email: credentials.email, password: credentials.password });
  record("login", login); if (login.status !== 200) throw new Error("Test login failed");
  cookie = login.response.headers.get("set-cookie")?.split(";")[0] ?? "";
  const before = await snapshot("before suggestion");
  const created = await request(`/projects/${seed.projectId}/agent-edits`, "POST", { clientRequestId: randomUUID(),
    episodeId: seed.episodeId, instruction: "把已有的 5 秒测试镜头裁剪为 4 秒，不改变其他素材" });
  record("create suggestion", created, { suggestionSetId: created.json?.agentEdit?.id ?? null });
  if (![200, 201].includes(created.status)) throw new Error("Suggestion request failed");
  const setId = created.json.agentEdit.id;
  let ready = created.json.agentEdit, pollAttempts = 0;
  while (["pending", "generating"].includes(ready.state) && pollAttempts < 30) {
    await new Promise(resolve => setTimeout(resolve, 1000));
    const response = await request(`/agent-edits/${setId}`);
    if (response.status !== 200) throw new Error(`Suggestion poll HTTP ${response.status}`);
    ready = response.json.agentEdit; pollAttempts++;
  }
  result.steps.push({ label: "suggestion terminal", state: ready.state, error: ready.error ?? null, pollAttempts,
    revision: ready.revision ?? null, actions: ready.actions?.map(action => ({ id: action.id, type: action.type,
      editId: action.editId ?? null, expectedRevision: action.expectedRevision ?? null,
      startMs: action.startMs ?? null, endMs: action.endMs ?? null, reason: action.reason ?? null })) ?? [] });
  const unconfirmed = await snapshot("before confirmation");
  if (ready.state !== "ready") throw new Error("Suggestion was not ready");
  const acceptable = ready.actions?.find(action => action.type === "set-trim" && action.editId === seed.edit.editId &&
    action.expectedRevision === before.revision && action.startMs === 0 && action.endMs === 4000);
  if (!acceptable) throw new Error("Model did not return the expected safe 5-to-4-second trim; confirmation skipped");
  if (unconfirmed.revision !== before.revision || unconfirmed.demoReserved !== before.demoReserved ||
      unconfirmed.demoUsed !== before.demoUsed || unconfirmed.versionCount !== before.versionCount) {
    throw new Error("Suggestion changed project state before confirmation");
  }
  const confirmBody = { clientRequestId: randomUUID(), expectedRevision: ready.revision,
    acceptedActionIds: [acceptable.id] };
  const confirmed = await request(`/agent-edits/${setId}/confirm`, "POST", confirmBody);
  record("confirm selected trim", confirmed, { confirmedActionIds: confirmed.json?.agentEdit?.confirmedActionIds ?? null });
  const repeated = await request(`/agent-edits/${setId}/confirm`, "POST", confirmBody);
  record("repeat same confirmation", repeated, { confirmedActionIds: repeated.json?.agentEdit?.confirmedActionIds ?? null });
  const after = await snapshot("after confirmation");
  result.assertions = { revisionIncrementedOnce: after.revision === before.revision + 1,
    trimNowFourSeconds: after.trimEndMs === 4000,
    creditsUnchanged: after.demoReserved === before.demoReserved && after.demoUsed === before.demoUsed,
    videoRunsUnchanged: after.videoRunCount === before.videoRunCount,
    noNewRenderedVersion: after.versionCount === before.versionCount,
    duplicateAccepted: confirmed.status === 200 && repeated.status === 200 };
} catch (error) {
  result.scriptError = String(error); process.exitCode = 1;
  if (cookie) {
    try { await snapshot("after failed suggestion"); } catch (snapshotError) {
      result.snapshotError = String(snapshotError);
    }
  }
}
finally {
  writeFileSync(join(evidenceDir, "local-agent-flow.json"), JSON.stringify(result, null, 2) + "\n");
  process.stdout.write(JSON.stringify(result) + "\n");
}
