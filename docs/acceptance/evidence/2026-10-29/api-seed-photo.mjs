// Work around an unavailable browser file chooser in local acceptance only.
// Uploads a synthetic PNG to the isolated test account/project through the public API.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const base = "http://127.0.0.1:18796";
const email = "web-acceptance-20261029@example.test";
const password = "acceptance-password-123";
const fixture = new URL("./test-reference.png", import.meta.url);
async function json(path, method = "GET", body, cookie) {
  const response = await fetch(base + path, { method, headers: {
    ...(body === undefined ? {} : { "content-type": "application/json" }),
    ...(cookie ? { cookie } : {}),
  }, body: body === undefined ? undefined : JSON.stringify(body) });
  const result = await response.json();
  assert.ok(response.ok, `${path}: ${JSON.stringify(result)}`);
  return { result, cookie: response.headers.get("set-cookie")?.split(";")[0] ?? "" };
}
const login = await json("/auth/login", "POST", { email, password });
const cookie = login.cookie;
const projects = (await json("/projects", "GET", undefined, cookie)).result.projects;
const project = projects.find(item => item.title === "验收-小狗晚餐");
assert.ok(project);
const bytes = await readFile(fixture);
const uploaded = await fetch(base + "/objects", { method: "POST", headers: { cookie, "content-type": "image/png" }, body: bytes });
const objectPayload = await uploaded.json();
assert.ok(uploaded.ok, JSON.stringify(objectPayload));
const objectId = objectPayload.object.id;
const command = await json(`/projects/${project.id}/commands`, "POST", {
  id: crypto.randomUUID(), resourceType: "asset", resourceId: objectId, baseRevision: 0,
  payload: { id: objectId, kind: "image", name: "test-reference.png" },
}, cookie);
assert.ok(command.result.project.document.assets.some(item => item.id === objectId));
process.stdout.write(JSON.stringify({ result: "PASS", projectId: project.id, objectId,
  fixture: "synthetic test-reference.png", source: "isolated API seed, not browser upload", mock: true }, null, 2) + "\n");
