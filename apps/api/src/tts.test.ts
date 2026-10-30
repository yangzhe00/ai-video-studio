import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ffmpeg from "@ffmpeg-installer/ffmpeg";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createTestDb } from "./test-db.ts";
import type { PgDatabase } from "./db.ts";
import type { ApiConfig } from "./config.ts";
import { createTtsTask, estimateTts, getTtsTaskByRequest, TtsWorker } from "./tts.ts";

const fixtures: { db: PgDatabase; dir: string }[] = [];
afterEach(async () => { for (const fixture of fixtures.splice(0)) { await fixture.db.close(); rmSync(fixture.dir, { recursive: true, force: true }); } });

async function setup() {
  const dir = mkdtempSync(join(tmpdir(), "avs-tts-test-"));
  const db = await createTestDb(dir);
  fixtures.push({ db, dir });
  const ownerId = randomUUID(), projectId = randomUUID(), episodeId = randomUUID();
  await db.prepare("INSERT INTO accounts (id,email,password_hash,created_at,demo_quota) VALUES (?,?,?,?,?)")
    .run(ownerId, `${ownerId}@example.com`, "hash", Date.now(), 3);
  await db.prepare("INSERT INTO projects (id,owner_id,title,revision,document_json,created_at) VALUES (?,?,?,?,?,?)")
    .run(projectId, ownerId, "项目", 1, JSON.stringify({ version: 1, assets: [], characters: [],
      episodes: [{ id: episodeId, title: "第一集", shots: [], timeline: [] }] }), Date.now());
  const config: ApiConfig = { dataDir: dir, databaseUrl: "", sessionSecret: "test-secret-at-least-thirty-two-characters",
    klingTtsVoices: [{ id: "voice_zh_01", label: "测试音色", language: "zh" }] };
  const body = { clientRequestId: randomUUID(), text: "你好，这是配音", voiceId: "voice_zh_01", voiceLanguage: "zh", speed: 1, confirmed: true };
  const estimate = await estimateTts(db, ownerId, projectId, config, body, 600_000);
  return { db, dir, ownerId, projectId, config, body: { ...body, estimateId: estimate.id }, estimate };
}

describe("durable TTS tasks", () => {
  it("states actual-use billing and replays one confirmed request ID", async () => {
    const { db, ownerId, projectId, config, body, estimate } = await setup();
    expect(estimate).toMatchObject({ estimatedCost: null, billingPolicy: "actual-usage" });
    await expect(estimateTts(db, ownerId, projectId, config, { ...body, voiceLanguage: "en" }, 600_000))
      .rejects.toMatchObject({ status: 400 });
    const first = await createTtsTask(db, ownerId, projectId, config, body, 600_000);
    const replay = await createTtsTask(db, ownerId, projectId, config, body, 600_000);
    expect(replay).toMatchObject({ replayed: true, task: { id: first.task.id } });
    expect(await getTtsTaskByRequest(db, ownerId, projectId, body.clientRequestId)).toMatchObject({ id: first.task.id });
    await expect(createTtsTask(db, ownerId, projectId, config, { ...body, text: "另一个文本" }, 600_000))
      .rejects.toMatchObject({ status: 409 });
    const other = { ...body, clientRequestId: randomUUID() };
    expect((await createTtsTask(db, ownerId, projectId, config, other, 600_000)).replayed).toBe(false);
  });

  it("does not submit twice after an uncertain paid POST", async () => {
    const { db, dir, ownerId, projectId, config, body } = await setup();
    const { task } = await createTtsTask(db, ownerId, projectId, config, body, 600_000);
    const submit = vi.fn().mockResolvedValue({ kind: "unknown" });
    const worker = new TtsWorker(db, dir, { submit, query: vi.fn(), download: vi.fn() }, config);
    await worker.run(task.id);
    await worker.run(task.id);
    await worker.tick();
    expect(submit).toHaveBeenCalledTimes(1);
    expect(await getTtsTaskByRequest(db, ownerId, projectId, body.clientRequestId))
      .toMatchObject({ state: "unknown", costStatus: "unknown", voiceAssetId: null });
  });

  it("saves a successful MP3 as one reusable voice asset without rendering video", async () => {
    const { db, dir, ownerId, projectId, config, body } = await setup();
    const { task } = await createTtsTask(db, ownerId, projectId, config, body, 600_000);
    const audio = join(dir, "generated.mp3");
    execFileSync(ffmpeg.path, ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi",
      "-i", "sine=frequency=500:duration=1", audio]);
    const submit = vi.fn().mockResolvedValue({ kind: "accepted", task: { taskId: "remote-tts-001", status: "submitted" } });
    const query = vi.fn().mockResolvedValue({ taskId: "remote-tts-001", status: "succeed",
      audioUrl: "https://p1.klingai.com/voice.mp3", deduction: { quota: "1", listPrice: "1", units: "1" } });
    const worker = new TtsWorker(db, dir, { submit, query, download: vi.fn().mockResolvedValue(readFileSync(audio)) }, config);
    await worker.run(task.id);
    await worker.run(task.id);
    const saved = await getTtsTaskByRequest(db, ownerId, projectId, body.clientRequestId);
    expect(saved).toMatchObject({ state: "succeeded", costStatus: "billed", providerTaskId: "remote-tts-001",
      actualCost: { quota: "1" } });
    expect(saved.voiceAssetId).toBeTruthy();
    const project = await db.prepare("SELECT document_json FROM projects WHERE id=?").get(projectId) as { document_json: string };
    expect(JSON.parse(project.document_json).assets).toEqual(expect.arrayContaining([expect.objectContaining({
      id: saved.voiceAssetId, kind: "voice", mimeType: "audio/mpeg", durationMs: expect.any(Number),
    })]));
    expect(await db.prepare("SELECT COUNT(*) AS count FROM render_operations").get()).toMatchObject({ count: 0 });
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it("stores a synchronous TTS result without requiring an undocumented follow-up query", async () => {
    const { db, dir, ownerId, projectId, config, body } = await setup();
    const { task } = await createTtsTask(db, ownerId, projectId, config, body, 600_000);
    const audio = join(dir, "immediate.mp3");
    execFileSync(ffmpeg.path, ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi",
      "-i", "sine=frequency=600:duration=1", audio]);
    const query = vi.fn();
    const worker = new TtsWorker(db, dir, { submit: vi.fn().mockResolvedValue({ kind: "accepted",
      task: { taskId: "remote-direct-001", status: "succeed", audioUrl: "https://p1.klingai.com/result.mp3",
        deduction: { quota: "1" } } }), query, download: vi.fn().mockResolvedValue(readFileSync(audio)) }, config);
    await worker.run(task.id);
    expect((await getTtsTaskByRequest(db, ownerId, projectId, body.clientRequestId)).state).toBe("succeeded");
    expect(query).not.toHaveBeenCalled();
  });
});
