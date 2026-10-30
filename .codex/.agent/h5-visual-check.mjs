// Run against a local Web Vite server and Chrome started with --remote-debugging-port=9226.
// API responses below are fixture data for layout checks; no real generation is submitted.
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const output = new URL("./screenshots/", import.meta.url);
await mkdir(fileURLToPath(output), { recursive: true });
const targets = await (await fetch("http://127.0.0.1:9226/json/list")).json();
const target = targets.find(item => item.type === "page");
if (!target) throw new Error("Chrome has no page target");
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { socket.addEventListener("open", resolve, { once: true }); socket.addEventListener("error", reject, { once: true }); });
let nextId = 0;
const pending = new Map();
let signedIn = false;
const project = {
  id: "project-h5", title: "小狗的晚餐", revision: 1, resourceRevisions: [],
  document: { version: 1, episodes: [{ id: "episode-h5", title: "第 1 集", shots: [], timeline: [] }], assets: [], characters: [] },
};
function send(method, params = {}) {
  const id = ++nextId;
  const response = new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
  socket.send(JSON.stringify({ id, method, params }));
  return response;
}
socket.addEventListener("message", event => {
  const message = JSON.parse(event.data);
  if (message.id) {
    const waiter = pending.get(message.id); pending.delete(message.id);
    if (message.error) waiter?.reject(new Error(`${message.error.message}: ${message.error.data ?? ""}`));
    else waiter?.resolve(message.result);
  } else if (message.method === "Fetch.requestPaused") {
    const { requestId, request } = message.params;
    const pathname = new URL(request.url).pathname.replace(/^\/api/, "");
    let status = 200; let body;
    if (pathname === "/auth/me") {
      status = signedIn ? 200 : 401;
      body = signedIn ? { account: { id: "account-h5", email: "preview@example.com", demo_quota: 3, demo_reserved: 0, demo_used: 0 } } : { error: "请先登录" };
    } else if (pathname === "/projects") body = { projects: [{ id: project.id, title: project.title, revision: 1 }] };
    else if (pathname === "/prompt-ideas") body = { ideaSets: [] };
    else if (pathname === `/projects/${project.id}`) body = { project };
    else if (pathname === `/projects/${project.id}/runs`) body = { runs: [] };
    else { status = 404; body = { error: `未配置的测试接口：${pathname}` }; }
    void send("Fetch.fulfillRequest", { requestId, responseCode: status,
      responseHeaders: [{ name: "content-type", value: "application/json; charset=utf-8" }],
      body: Buffer.from(JSON.stringify(body)).toString("base64") }).catch(console.error);
  }
});
await send("Page.enable");
await send("Runtime.enable");
await send("Fetch.enable", { patterns: [{ urlPattern: "*127.0.0.1:1426/api/*" }] });
await send("Network.setCacheDisabled", { cacheDisabled: true });
const evaluate = async expression => {
  const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
  return result.result.value;
};
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitFor(expression, label) {
  for (let i = 0; i < 80; i++) { if (await evaluate(expression)) return; await sleep(100); }
  throw new Error(`Timed out waiting for ${label}`);
}
async function navigate(viewport, authenticated) {
  signedIn = authenticated;
  await evaluate("window.localStorage.setItem('ai-video-studio:skin', 'cream-film')");
  await send("Emulation.setDeviceMetricsOverride", { width: viewport.width, height: viewport.height, deviceScaleFactor: 1, mobile: viewport.width <= 640 });
  await send("Page.navigate", { url: "http://127.0.0.1:1426/" });
  await waitFor(authenticated ? "!!document.querySelector('.avs-project-home')" : "!!document.querySelector('.web-auth-form')", authenticated ? "home" : "login");
  await sleep(300);
}
async function clickButton(text, selector = "button") {
  const clicked = await evaluate(`(() => { const target = [...document.querySelectorAll(${JSON.stringify(selector)})].find(el => el.textContent?.trim().includes(${JSON.stringify(text)})); target?.click(); return !!target; })()`);
  if (!clicked) throw new Error(`Button not found: ${text} in ${selector}`);
  await sleep(250);
}
async function capture(viewport, screen) {
  const metrics = await evaluate(`(() => {
    const viewport = document.documentElement.clientWidth;
    const nav = document.querySelector('.avs-mobile-nav');
    const stage = document.querySelector('.avs-studio-stage');
    const scroller = document.querySelector('.film-generate-scroll, .avs-project-home, .web-project-library, .web-mobile-episode') ?? document.scrollingElement;
    return { width: viewport, scrollWidth: document.documentElement.scrollWidth,
      stageScrollWidth: stage?.scrollWidth ?? null, stageClientWidth: stage?.clientWidth ?? null,
      contentScrollHeight: scroller?.scrollHeight ?? null, contentClientHeight: scroller?.clientHeight ?? null,
      bottomNav: nav ? { top: Math.round(nav.getBoundingClientRect().top), bottom: Math.round(nav.getBoundingClientRect().bottom) } : null,
      screen: document.querySelector('main')?.getAttribute('aria-label') ?? document.querySelector('main')?.className ?? '' };
  })()`);
  const image = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  await writeFile(join(fileURLToPath(output), `${viewport.name}-${screen}.png`), Buffer.from(image.data, "base64"));
  return { device: viewport.name, screen, ...metrics, overflow: metrics.scrollWidth > metrics.width + 1 };
}

const viewports = [
  { name: "iphone-se", width: 320, height: 568 },
  { name: "iphone-8", width: 375, height: 667 },
  { name: "iphone-14", width: 390, height: 844 },
  { name: "large-phone", width: 412, height: 915 },
  { name: "phone-boundary", width: 640, height: 800 },
  { name: "tablet-boundary", width: 641, height: 900 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "desktop", width: 1440, height: 900 },
];
const results = [];
for (const viewport of viewports) {
  await navigate(viewport, false);
  results.push(await capture(viewport, "login"));
  if (viewport.name === "iphone-se") { await evaluate("window.scrollTo(0, document.body.scrollHeight)"); await sleep(120); results.push(await capture(viewport, "login-bottom")); }
  await navigate(viewport, true);
  results.push(await capture(viewport, "home"));
  if (viewport.name === "iphone-se") { await evaluate("document.querySelector('.avs-project-home').scrollTop = 10000"); await sleep(120); results.push(await capture(viewport, "home-bottom")); }
  await clickButton("全部项目");
  await waitFor("!!document.querySelector('.web-project-library')", "projects");
  if (viewport.name === "iphone-14") {
    results.push(await capture(viewport, "projects"));
    await clickButton("新建项目"); results.push(await capture(viewport, "create-dialog"));
    await clickButton("取消", ".web-create-dialog button");
  }
  await clickButton("小狗的晚餐", ".web-project-card");
  await waitFor("!!document.querySelector('.film-composer')", "creation");
  results.push(await capture(viewport, "generate"));
  if (viewport.name === "iphone-se") { await evaluate("document.querySelector('.film-generate-scroll').scrollTop = 10000"); await sleep(120); results.push(await capture(viewport, "generate-bottom")); }
  if (viewport.name === "iphone-14") {
    const nav = ".avs-mobile-nav button";
    await clickButton("结果", nav); results.push(await capture(viewport, "results"));
    await clickButton("资产", nav); results.push(await capture(viewport, "assets"));
    await clickButton("画布", nav); results.push(await capture(viewport, "canvas"));
    await clickButton("菜单", ".avs-mobile-header button"); results.push(await capture(viewport, "drawer"));
    await evaluate("document.querySelector('.web-account-controls .avs-theme-toggle')?.click()"); await sleep(120);
    await evaluate("document.querySelector('.avs-mobile-scrim')?.click()"); await sleep(120);
    await clickButton("创作", nav); results.push(await capture(viewport, "generate-dark"));
  } else if (viewport.name === "tablet-boundary" || viewport.name === "tablet" || viewport.name === "desktop") {
    await clickButton("画布", ".avs-studio-sidebar nav button");
    results.push(await capture(viewport, "canvas"));
  }
}
await writeFile(new URL("./h5-visual-results.json", import.meta.url), JSON.stringify(results, null, 2));
console.log(JSON.stringify(results, null, 2));
socket.close();
