// Two-phase local-only crash test: seed with a hanging mock, kill API, wait past timeout+5s,
// restart the API on the same isolated SQLite directory, then verify no provider resubmit.
import assert from "node:assert/strict";

const phase = process.argv[2];
const base = process.env.ACCEPTANCE_API_BASE ?? "http://127.0.0.1:18798";
const mock = process.env.ACCEPTANCE_MOCK_BASE ?? "http://127.0.0.1:18797";
const email = "crash-acceptance@example.test";
const password = "acceptance-password-123";
const intent = { clientRequestId: "crash-acceptance-request-01", input: "小狗端菜上桌" };
async function request(path, method = "GET", body, cookie, signal) {
  const response = await fetch(base + path, { method, signal, headers: {
    ...(body === undefined ? {} : { "content-type": "application/json" }),
    ...(cookie ? { cookie } : {}),
  }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: response.status, body: await response.json(), cookie: response.headers.get("set-cookie")?.split(";")[0] ?? "" };
}
async function count() { return (await (await fetch(mock + "/__counts")).json()).calls; }

if (phase === "seed") {
  const a = await request("/auth/register", "POST", { email, password });
  assert.equal(a.status, 201);
  const before = await count();
  try { await request("/prompt-ideas", "POST", intent, a.cookie, AbortSignal.timeout(300)); }
  catch (error) { assert.equal(error.name, "TimeoutError"); }
  let after = await count();
  for (let i = 0; after === before && i < 20; i++) {
    await new Promise(resolve => setTimeout(resolve, 100));
    after = await count();
  }
  assert.equal(after - before, 1);
  process.stdout.write(JSON.stringify({ phase: "seed", providerCallsAdded: 1, clientResponseLost: true,
    clientRequestId: intent.clientRequestId, next: "Terminate API while mock response hangs; restart same DB after timeout+5s." }, null, 2) + "\n");
} else if (phase === "verify") {
  const a = await request("/auth/login", "POST", { email, password });
  assert.equal(a.status, 200);
  const before = await count();
  const list = await request("/prompt-ideas", "GET", undefined, a.cookie);
  const idea = list.body.ideaSets.find(item => item.clientRequestId === intent.clientRequestId);
  assert.ok(idea);
  assert.equal(idea.state, "unknown");
  const replay = await request("/prompt-ideas", "POST", intent, a.cookie);
  assert.equal(replay.status, 200);
  assert.equal(replay.body.ideaSet.id, idea.id);
  assert.equal(replay.body.ideaSet.state, "unknown");
  assert.equal(await count(), before, "replay must not call the model again");
  process.stdout.write(JSON.stringify({ phase: "verify", result: "PASS", stateAfterRestart: idea.state,
    replayState: replay.body.ideaSet.state, providerCallsAddedByReplay: 0, mock: true }, null, 2) + "\n");
} else throw new Error("Expected seed or verify");
