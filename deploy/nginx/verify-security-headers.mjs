// Run against a staging Nginx endpoint after `nginx -t`; no credentials are printed.
const base = process.argv[2];
if (!base || !/^https:\/\//.test(base)) throw new Error("Usage: node verify-security-headers.mjs https://staging-origin");
const url = new URL(base);
if (url.pathname !== "/" || url.search || url.hash) throw new Error("Expected a bare HTTPS origin");

const cases = [
  { path: "/", status: 200, html: true },
  { path: "/studio/", status: 200, html: true },
  { path: "/api/health", status: 200, json: true, noStore: true },
  { path: "/api/objects/nonexistent", status: 401, json: true, noStore: true },
  { path: "/downloads/unknown.dmg", status: 404 },
];
if (process.env.AVS_TEST_OBJECT_ID && process.env.AVS_TEST_COOKIE) {
  cases.push({ path: `/api/objects/${encodeURIComponent(process.env.AVS_TEST_OBJECT_ID)}`, status: 200,
    object: true, noStore: true, cookie: process.env.AVS_TEST_COOKIE });
}
for (const item of cases) {
  const response = await fetch(new URL(item.path, url), { headers: item.cookie ? { cookie: item.cookie } : {} });
  const headers = response.headers;
  if (response.status !== item.status || headers.get("x-content-type-options") !== "nosniff" ||
      headers.get("x-frame-options") !== "DENY" || !headers.get("referrer-policy") ||
      !headers.get("content-security-policy-report-only")) throw new Error(`Header/status check failed: ${item.path}`);
  if (item.html && !headers.get("content-type")?.includes("text/html")) throw new Error(`Expected HTML: ${item.path}`);
  if (item.json && !headers.get("content-type")?.includes("application/json")) throw new Error(`Expected JSON: ${item.path}`);
  if (item.object && !/^(image|video)\//.test(headers.get("content-type") ?? "")) throw new Error("Expected media object");
  if (item.noStore && !headers.get("cache-control")?.includes("no-store")) throw new Error(`Expected no-store: ${item.path}`);
  await response.arrayBuffer();
  process.stdout.write(`${item.path}: ${response.status}, required headers present\n`);
}
