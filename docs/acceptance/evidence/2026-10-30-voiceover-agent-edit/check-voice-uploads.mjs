import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const dir = dirname(fileURLToPath(import.meta.url));
const credentials = JSON.parse(readFileSync("/private/tmp/avs-integration-credentials.json", "utf8"));
const base = credentials.baseUrl.replace(/\/$/, "");
const login = await fetch(base + "/auth/login", { method: "POST", headers: {
  "content-type": "application/json", "x-avs-request": "1" },
  body: JSON.stringify({ email: credentials.email, password: credentials.password }) });
if (login.status !== 200) throw new Error(`login HTTP ${login.status}`);
const cookie = login.headers.get("set-cookie")?.split(";")[0] ?? "";
const cases = [
  ["voice-5s.wav", "audio/wav", [200, 201]],
  ["voice-5s.mp3", "audio/mpeg", [200, 201]],
  ["voice-5s.m4a", "audio/mp4", [200, 201]],
  ["broken.mp3", "audio/mpeg", 400],
  ["empty.wav", "audio/wav", 400],
];
const results = [];
for (const [name, mime, expected] of cases) {
  const bytes = readFileSync(join(dir, "fixtures", name));
  const response = await fetch(base + "/objects", { method: "POST", headers: {
    cookie, "content-type": mime, "x-avs-request": "1" }, body: bytes });
  const body = await response.json();
  results.push({ name, mime, inputBytes: bytes.length, expectedStatus: expected, actualStatus: response.status,
    acceptedMime: body.object?.mime ?? null, durationMs: body.object?.durationMs ?? null,
    errorCode: body.code ?? null, error: body.error ?? null });
}
const output = { environment: "isolated local PostgreSQL API", results,
  pass: results.every(item => (Array.isArray(item.expectedStatus) ? item.expectedStatus : [item.expectedStatus]).includes(item.actualStatus)) };
writeFileSync(join(dir, "local-voice-upload-check.json"), JSON.stringify(output, null, 2) + "\n");
process.stdout.write(JSON.stringify(output) + "\n");
if (!output.pass) process.exitCode = 1;
