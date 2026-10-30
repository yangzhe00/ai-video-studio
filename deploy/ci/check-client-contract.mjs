// Release canary: the browser, mobile and native HTTP adapters must all carry the shared request marker.
// Behavior is verified separately by their tests and the private production acceptance gate.
import { readFileSync } from "node:fs";

const required = [
  ["packages/api-contracts/src/index.ts", ["X-AVS-Request", "requestSecurityHeaders"]],
  ["apps/web/src/api.ts", ["requestSecurityHeaders(method)", 'requestSecurityHeaders("POST")']],
  ["apps/mobile/src/api.ts", ["requestSecurityHeaders(method)", 'requestSecurityHeaders("POST")']],
  ["apps/desktop/src-tauri/src/cloud.rs", ["X-AVS-Request", "with_request_marker"]],
  ["apps/api/src/server.ts", ["checkRequestSecurity"]],
];

for (const [path, markers] of required) {
  const source = readFileSync(path, "utf8");
  for (const marker of markers) {
    if (!source.includes(marker)) throw new Error(`Release client security contract missing in ${path}: ${marker}`);
  }
}
process.stdout.write("Cross-client request marker source gate: OK; behavior tests and private acceptance still required\n");
