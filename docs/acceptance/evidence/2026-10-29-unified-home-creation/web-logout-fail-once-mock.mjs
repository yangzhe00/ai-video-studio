import http from "node:http";

let loggedIn = true;
let failNextLogout = true;
const account = { id: "A", email: "A@example.com", demo_quota: 3, demo_reserved: 0, demo_used: 0 };
const send = (res, data, status = 200) => { res.writeHead(status, { "content-type": "application/json; charset=utf-8" }); res.end(JSON.stringify(data)); };
const server = http.createServer((req, res) => {
  const path = new URL(req.url, "http://127.0.0.1").pathname;
  if (path === "/auth/me") return loggedIn ? send(res, { account }) : send(res, { error: "请先登录" }, 401);
  if (path === "/auth/logout") {
    if (failNextLogout) { failNextLogout = false; req.socket.destroy(); return; }
    loggedIn = false;
    return send(res, { ok: true });
  }
  if (path === "/projects") return send(res, { projects: [{ id: "A-project", title: "A 的作品", revision: 1 }] });
  if (path === "/prompt-ideas") return send(res, { ideaSets: [] });
  return send(res, { error: `Unhandled QA fixture path: ${path}` }, 404);
});
server.listen(18800, "127.0.0.1", () => process.stdout.write("QA logout failure fixture listening 127.0.0.1:18800\n"));
