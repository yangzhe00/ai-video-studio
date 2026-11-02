// Local acceptance fixture. Bind only to loopback and never point clients at a real provider.
import { createServer } from "node:http";
import { appendFileSync } from "node:fs";

const port = Number(process.env.MOCK_IDEA_PORT ?? 18795);
const logPath = process.env.MOCK_IDEA_LOG;
const mode = process.env.MOCK_IDEA_MODE ?? "valid";
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid MOCK_IDEA_PORT");
if (!["valid", "duplicate", "malformed", "http500", "hang", "disconnect"].includes(mode)) throw new Error("Invalid MOCK_IDEA_MODE");

let calls = 0;
const variants = [
  { title: "暖心叙事", description: "突出端菜的完整动作", prompt: "小狗在温暖的厨房端起一盘菜，走到餐桌前放下，单镜头跟拍。" },
  { title: "轻快喜剧", description: "突出轻巧有趣的节奏", prompt: "小狗在厨房端着菜轻快转身，将餐盘放在桌上，镜头平稳推近。" },
  { title: "电影特写", description: "突出表情与食物细节", prompt: "特写小狗认真端着热气腾腾的菜走向餐桌，镜头从餐盘缓慢移到小狗表情。" },
];
const server = createServer(async (request, response) => {
  if (request.method === "GET" && request.url === "/__counts") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ calls, mode }));
    return;
  }
  if (request.method !== "POST" || request.url !== "/chat/completions") {
    response.writeHead(404); response.end(); return;
  }
  calls++;
  let body = "";
  for await (const chunk of request) body += chunk;
  let parsed;
  try { parsed = JSON.parse(body); } catch { parsed = {}; }
  const entry = { time: new Date().toISOString(), call: calls, mode, model: parsed.model ?? null,
    userInput: parsed.messages?.find?.(message => message.role === "user")?.content ?? null };
  if (logPath) appendFileSync(logPath, `${JSON.stringify(entry)}\n`);
  if (mode === "hang") return;
  if (mode === "disconnect") { response.destroy(); return; }
  if (mode === "http500") { response.writeHead(500); response.end("provider unavailable"); return; }
  response.writeHead(200, { "content-type": "application/json" });
  if (mode === "malformed") { response.end(JSON.stringify({ choices: [{ message: { content: "not json" } }] })); return; }
  const result = mode === "duplicate" ? [variants[0], variants[0], variants[2]] : variants;
  response.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ variants: result }) } }], usage: { total_tokens: 42 } }));
});
server.listen(port, "127.0.0.1", () => {
  process.stdout.write(`mock Chat Completions listening on http://127.0.0.1:${port} mode=${mode}\n`);
});
