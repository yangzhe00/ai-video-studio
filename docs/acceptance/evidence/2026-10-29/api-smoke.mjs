// Run against the isolated local API and mock Chat Completions server only.
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";

const base = process.env.ACCEPTANCE_API_BASE ?? "http://127.0.0.1:18796";
const mock = process.env.ACCEPTANCE_MOCK_BASE ?? "http://127.0.0.1:18795";
const dataDir = process.env.API_DATA_DIR;
if (!dataDir) throw new Error("API_DATA_DIR must point at the isolated acceptance database");
const run = crypto.randomUUID().slice(0, 8);
async function request(path, method = "GET", body, cookie) {
  const response = await fetch(base + path, { method, headers: {
    ...(body === undefined ? {} : { "content-type": "application/json" }),
    ...(cookie ? { cookie } : {}),
  }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: response.status, body: await response.json(), cookie: response.headers.get("set-cookie")?.split(";")[0] ?? "" };
}
const before = await (await fetch(mock + "/__counts")).json();
const a = await request("/auth/register", "POST", { email: `acceptance-a-${run}@example.test`, password: "acceptance-password-123" });
const b = await request("/auth/register", "POST", { email: `acceptance-b-${run}@example.test`, password: "acceptance-password-123" });
assert.equal(a.status, 201); assert.equal(b.status, 201);
assert.equal((await request("/prompt-ideas")).status, 401);
assert.deepEqual((await request("/projects", "GET", undefined, a.cookie)).body.projects, []);

const intent = { clientRequestId: `acceptance-${run}`, input: "小狗做饭并上菜" };
const [first, concurrent] = await Promise.all([
  request("/prompt-ideas", "POST", intent, a.cookie),
  request("/prompt-ideas", "POST", intent, a.cookie),
]);
const id = first.body.ideaSet.id;
assert.equal(concurrent.body.ideaSet.id, id);
assert.equal(first.body.ideaSet.state, "ready");
assert.equal(first.body.ideaSet.variants.length, 3);
const replay = await request("/prompt-ideas", "POST", intent, a.cookie);
assert.equal(replay.body.ideaSet.id, id);
assert.equal((await request("/prompt-ideas", "POST", { ...intent, input: "另一想法" }, a.cookie)).status, 409);
const after = await (await fetch(mock + "/__counts")).json();
assert.equal(after.calls - before.calls, 1, "concurrent and replayed requests must make exactly one model call");

const selected = await request(`/prompt-ideas/${id}/selection`, "POST", { variantId: "variant-2", editedPrompt: "小狗从厨房端菜上桌，暖光近景。" }, a.cookie);
assert.equal(selected.body.ideaSet.editedPrompt, "小狗从厨房端菜上桌，暖光近景。");
assert.equal((await request(`/prompt-ideas/${id}`, "GET", undefined, a.cookie)).body.ideaSet.selectedVariantId, "variant-2");
assert.equal((await request(`/prompt-ideas/${id}`, "GET", undefined, b.cookie)).status, 404);
assert.deepEqual((await request("/prompt-ideas", "GET", undefined, b.cookie)).body.ideaSets, []);
assert.deepEqual((await request("/projects", "GET", undefined, a.cookie)).body.projects, []);

const db = new DatabaseSync(join(dataDir, "studio.sqlite"));
const counts = {
  projects: db.prepare("SELECT COUNT(*) AS n FROM projects").get().n,
  agentRuns: db.prepare("SELECT COUNT(*) AS n FROM agent_runs").get().n,
  operations: db.prepare("SELECT COUNT(*) AS n FROM operations").get().n,
  aQuota: { ...db.prepare("SELECT demo_used, demo_reserved FROM accounts WHERE id=?").get(a.body.account.id) },
};
db.close();
assert.deepEqual(counts, { projects: 0, agentRuns: 0, operations: 0, aQuota: { demo_used: 0, demo_reserved: 0 } });
process.stdout.write(JSON.stringify({ result: "PASS", run, modelCallsAdded: after.calls - before.calls,
  ideaId: id, variantCount: first.body.ideaSet.variants.length, selectionRestored: true,
  bAccessStatus: 404, counts, mock: true }, null, 2) + "\n");
