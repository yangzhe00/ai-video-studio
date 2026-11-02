import http from "node:http";

let session = "A";
const delayed = [];
const account = id => ({ id, email: `${id}@example.com`, demo_quota: 3, demo_reserved: 0, demo_used: 0 });
const idea = (id, input) => ({ id, clientRequestId: `request-${id}`, input, state: "ready",
  variants: [], selectedVariantId: null, editedPrompt: null, createdAt: 1, updatedAt: 1, error: null, errorCode: null });
const send = (res, data, status = 200) => { res.writeHead(status, { "content-type": "application/json; charset=utf-8" }); res.end(JSON.stringify(data)); };

const server = http.createServer((req, res) => {
  const path = new URL(req.url, "http://127.0.0.1").pathname;
  if (path === "/auth/me") return send(res, { account: account("A") });
  if (path === "/auth/logout") { session = "none"; return send(res, { ok: true }); }
  if (path === "/auth/login") {
    session = "B";
    send(res, { account: account("B") });
    setTimeout(() => delayed.splice(0).forEach(({ res: old, data }) => send(old, data)), 750);
    return;
  }
  if (path === "/projects") {
    if (session === "A") { delayed.push({ res, data: { projects: [{ id: "A-project", title: "A 的私有项目", revision: 1 }] } }); return; }
    return send(res, { projects: session === "B" ? [{ id: "B-project", title: "B 的项目", revision: 1 }] : [] });
  }
  if (path === "/prompt-ideas") {
    if (session === "A") { delayed.push({ res, data: { ideaSets: [idea("A-idea", "A 的私有灵感")] } }); return; }
    return send(res, { ideaSets: session === "B" ? [idea("B-idea", "B 的灵感")] : [] });
  }
  return send(res, { error: `Unhandled QA fixture path: ${path}` }, 404);
});
server.listen(18799, "127.0.0.1", () => process.stdout.write("QA fixture listening 127.0.0.1:18799\n"));
