import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createRecipe } from "@ai-video/plugin-video-edit/core";
import { createTestDb } from "./test-db.ts";
import type { PgDatabase } from "./db.ts";
import type { ApiConfig } from "./config.ts";
import { AgentEditWorker, confirmAgentEdit, createAgentEdit, getAgentEdit, getAgentEditByRequest } from "./agent-edit.ts";
import { applyEditCommand } from "./video-edits.ts";

const fixtures: { db: PgDatabase; dir: string }[] = [];
afterEach(async () => { for (const fixture of fixtures.splice(0)) { await fixture.db.close(); rmSync(fixture.dir, { recursive: true, force: true }); } });

async function setup() {
  const dir = mkdtempSync(join(tmpdir(), "avs-agent-edit-test-"));
  const db = await createTestDb(dir);
  fixtures.push({ db, dir });
  const owner = randomUUID(), project = randomUUID(), episode = randomUUID(), shot = randomUUID(),
    video = randomUUID(), edit = randomUUID();
  await db.prepare("INSERT INTO accounts (id,email,password_hash,created_at,demo_quota) VALUES (?,?,?,?,?)")
    .run(owner, `${owner}@example.com`, "hash", Date.now(), 3);
  await db.prepare("INSERT INTO objects (id,owner_id,sha256,mime,size,path,created_at) VALUES (?,?,?,?,?,?,?)")
    .run(video, owner, "video-sha", "video/mp4", 1, join(dir, "video.mp4"), Date.now());
  const document = { version: 1, assets: [{ id: video, kind: "video" }], characters: [],
    episodes: [{ id: episode, title: "第一集", shots: [{ id: shot, resultAssetId: video, originalAssetId: video,
      runId: "run-001", sourceAssetId: video, prompt: "片段", durationSec: 2 }], timeline: [video] }] };
  await db.prepare("INSERT INTO projects (id,owner_id,title,revision,document_json,created_at) VALUES (?,?,?,?,?,?)")
    .run(project, owner, "项目", 1, JSON.stringify(document), Date.now());
  await db.prepare("INSERT INTO resource_revisions (project_id,resource_type,resource_id,revision) VALUES (?,'episode',?,1)")
    .run(project, episode);
  const recipe = createRecipe({ id: edit, projectId: project, episodeId: episode, shotId: shot,
    sourceAssetId: video, sourceDurationMs: 2000 });
  await db.prepare(`INSERT INTO video_edits (id,owner_id,project_id,episode_id,shot_id,source_object_id,
    recipe_json,revision,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)`)
    .run(edit, owner, project, episode, shot, video, JSON.stringify(recipe), 1, Date.now(), Date.now());
  const config: ApiConfig = { dataDir: dir, databaseUrl: "", sessionSecret: "secret",
    agentEditModelBaseUrl: "https://model.example.com/v1", agentEditModelApiKey: "test-key", agentEditModelId: "test-model" };
  const body = { clientRequestId: randomUUID(), episodeId: episode, instruction: "把镜头缩短" };
  return { db, owner, project, episode, edit, config, body };
}

describe("Agent edit suggestion lifecycle", () => {
  it("previews a suggestion without side effects, then applies a selected action exactly once", async () => {
    const { db, owner, project, edit, config, body } = await setup();
    const created = await createAgentEdit(db, owner, project, config, body);
    expect((await createAgentEdit(db, owner, project, config, body)).set.id).toBe(created.set.id);
    const generate = vi.fn().mockResolvedValue([{ id: "model-action", type: "set-trim", reason: "去掉尾部空白",
      editId: edit, expectedRevision: 1, startMs: 0, endMs: 1000 }]);
    await new AgentEditWorker(db, config, generate).run(created.set.id);
    const ready = await getAgentEdit(db, owner, created.set.id);
    expect(ready).toMatchObject({ state: "ready", revision: 1, confirmedActionIds: [] });
    expect(ready.context).toMatchObject({ episode: { revision: 1, shotIds: [expect.any(String)] },
      edits: [{ id: edit, revision: 1, trimStartMs: 0, trimEndMs: 2000, captions: [], voiceClips: [] }] });
    expect(ready.actions).toHaveLength(1);
    expect(await db.prepare("SELECT revision FROM video_edits WHERE id=?").get(edit)).toMatchObject({ revision: 1 });
    expect(await db.prepare("SELECT COUNT(*) AS count FROM render_operations").get()).toMatchObject({ count: 0 });
    const confirm = { clientRequestId: randomUUID(), expectedRevision: 1,
      acceptedActionIds: [ready.actions[0].id] };
    expect((await confirmAgentEdit(db, owner, created.set.id, confirm)).confirmedActionIds).toEqual(confirm.acceptedActionIds);
    await confirmAgentEdit(db, owner, created.set.id, confirm);
    expect(await db.prepare("SELECT revision FROM video_edits WHERE id=?").get(edit)).toMatchObject({ revision: 2 });
    expect((await getAgentEdit(db, owner, created.set.id)).context).toEqual(ready.context);
    expect((await getAgentEditByRequest(db, owner, project, body.clientRequestId)).context).toEqual(ready.context);
    expect(await db.prepare("SELECT COUNT(*) AS count FROM render_operations").get()).toMatchObject({ count: 0 });
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it("rejects confirmation after a manual edit changes the recipe revision", async () => {
    const { db, owner, project, edit, config, body } = await setup();
    const { set } = await createAgentEdit(db, owner, project, config, body);
    await new AgentEditWorker(db, config, vi.fn().mockResolvedValue([{ id: "model-action", type: "set-trim",
      reason: "缩短", editId: edit, expectedRevision: 1, startMs: 0, endMs: 1000 }])).run(set.id);
    const action = (await getAgentEdit(db, owner, set.id)).actions[0];
    await applyEditCommand(db, owner, edit, { commandId: randomUUID(), expectedRevision: 1,
      command: { type: "set-cover", sourceMs: 500 } });
    await expect(confirmAgentEdit(db, owner, set.id, { clientRequestId: randomUUID(), expectedRevision: 1,
      acceptedActionIds: [action.id] })).rejects.toMatchObject({ status: 409 });
    expect(await db.prepare("SELECT revision FROM video_edits WHERE id=?").get(edit)).toMatchObject({ revision: 2 });
  });

  it("fails invalid cross-project voice suggestions without changing the project", async () => {
    const { db, owner, project, edit, config, body } = await setup();
    const { set } = await createAgentEdit(db, owner, project, config, body);
    await new AgentEditWorker(db, config, vi.fn().mockResolvedValue([{ id: "model-action", type: "set-voice",
      reason: "加旁白", editId: edit, expectedRevision: 1, assetId: randomUUID(),
      startMs: 0, inMs: 0, outMs: 1000, volume: 1 }])).run(set.id);
    expect(await getAgentEdit(db, owner, set.id)).toMatchObject({ state: "failed", actions: [] });
    expect(await db.prepare("SELECT revision FROM video_edits WHERE id=?").get(edit)).toMatchObject({ revision: 1 });
  });
});
