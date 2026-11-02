import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createTestDb } from "./test-db.ts";
import type { PgDatabase } from "./db.ts";
import { applyProjectCommand } from "./sync.ts";

const fixtures: { db: PgDatabase; dir: string }[] = [];
afterEach(async () => { for (const item of fixtures.splice(0)) {
  await item.db.close(); rmSync(item.dir, { recursive: true, force: true });
} });

describe("episode timeline command", () => {
  it("saves three audio clips once, rejects stale and downgrade writes, and keeps replay safe after a source disappears", async () => {
    const dir = mkdtempSync(join(tmpdir(), "avs-timeline-command-"));
    const db = await createTestDb(dir);
    fixtures.push({ db, dir });
    const owner = randomUUID(), projectId = randomUUID(), episodeId = randomUUID();
    const videoId = randomUUID(), voiceId = randomUUID(), musicId = randomUUID(), visualId = randomUUID();
    const otherOwner = randomUUID(), foreignVoiceId = randomUUID();
    await db.prepare("INSERT INTO accounts (id,email,password_hash,created_at,demo_quota) VALUES (?,?,?,?,?)")
      .run(owner, `${owner}@example.com`, "test", Date.now(), 3);
    await db.prepare("INSERT INTO accounts (id,email,password_hash,created_at,demo_quota) VALUES (?,?,?,?,?)")
      .run(otherOwner, `${otherOwner}@example.com`, "test", Date.now(), 3);
    const assetIds = [videoId, voiceId, musicId];
    const paths = assetIds.map((_, index) => join(dir, `object-${index}`));
    for (let index = 0; index < paths.length; index++) {
      writeFileSync(paths[index], "fixture");
      await db.prepare("INSERT INTO objects (id,owner_id,sha256,mime,size,path,created_at) VALUES (?,?,?,?,?,?,?)")
        .run(assetIds[index], owner, randomUUID(), index === 0 ? "video/mp4" : "audio/mpeg", 7, paths[index], Date.now());
    }
    await db.prepare("INSERT INTO objects (id,owner_id,sha256,mime,size,path,created_at) VALUES (?,?,?,?,?,?,?)")
      .run(foreignVoiceId, otherOwner, randomUUID(), "audio/mpeg", 7, paths[1], Date.now());
    const episode = { id: episodeId, title: "第一集", shots: [], timeline: [videoId],
      timelineClips: [{ id: visualId, assetId: videoId, inMs: 0, outMs: 3000, volume: 0.4 }] };
    const document = { version: 1, episodes: [episode], characters: [], assets: [
      { id: videoId, kind: "video", durationMs: 3000 },
      { id: voiceId, kind: "voice", durationMs: 2000 },
      { id: musicId, kind: "music", durationMs: 3000 },
      { id: foreignVoiceId, kind: "voice", durationMs: 2000 }] };
    await db.prepare("INSERT INTO projects (id,owner_id,title,revision,document_json,created_at) VALUES (?,?,?,?,?,?)")
      .run(projectId, owner, "项目", 1, JSON.stringify(document), Date.now());
    await db.prepare("INSERT INTO resource_revisions (project_id,resource_type,resource_id,revision) VALUES (?,'episode',?,1)")
      .run(projectId, episodeId);
    const placement = (id: string, assetId: string, startMs: number, anchor: object) =>
      ({ id, assetId, startMs, inMs: 0, outMs: 1000, volume: 1, anchor });
    const audio = { version: 2, originalVolume: 1,
      voiceClips: [placement(randomUUID(), voiceId, 500, { kind: "visual-clip", clipId: visualId, offsetMs: 500 }),
        placement(randomUUID(), voiceId, 1200, { kind: "absolute" })],
      musicClips: [placement(randomUUID(), musicId, 0, { kind: "absolute" })] };
    const command = { id: randomUUID(), resourceType: "episode", resourceId: episodeId,
      baseRevision: 1, payload: { ...episode, audio } };
    const first = await applyProjectCommand(db, owner, projectId, command);
    expect(first.resourceRevision).toBe(2);
    expect(first.project.document.episodes[0].audio).toMatchObject({ version: 2, originalVolume: 1 });
    rmSync(paths[1]);
    expect((await applyProjectCommand(db, owner, projectId, command)).replayed).toBe(true);
    writeFileSync(paths[1], "fixture");
    await expect(applyProjectCommand(db, owner, projectId,
      { ...command, id: randomUUID() })).rejects.toMatchObject({ status: 409 });
    const oldAudio = { originalVolume: 1, voiceClips: [{ assetId: voiceId, startMs: 500,
      inMs: 0, outMs: 1000, volume: 1 }], musicClips: [] };
    await expect(applyProjectCommand(db, owner, projectId,
      { ...command, id: randomUUID(), baseRevision: 2, payload: { ...episode, audio: oldAudio } }))
      .rejects.toMatchObject({ status: 409 });
    const invalid = structuredClone(audio);
    invalid.voiceClips[0].outMs = 299;
    await expect(applyProjectCommand(db, owner, projectId,
      { ...command, id: randomUUID(), baseRevision: 2, payload: { ...episode, audio: invalid } }))
      .rejects.toMatchObject({ status: 400 });
    const foreign = structuredClone(audio);
    foreign.voiceClips[0].assetId = foreignVoiceId;
    await expect(applyProjectCommand(db, owner, projectId,
      { ...command, id: randomUUID(), baseRevision: 2, payload: { ...episode, audio: foreign } }))
      .rejects.toMatchObject({ status: 404 });
    rmSync(paths[1]);
    await expect(applyProjectCommand(db, owner, projectId,
      { ...command, id: randomUUID(), baseRevision: 2 })).rejects.toMatchObject({ status: 410 });
    expect((await db.prepare("SELECT revision FROM resource_revisions WHERE project_id=? AND resource_type='episode' AND resource_id=?")
      .get(projectId, episodeId))).toMatchObject({ revision: 2 });
  });
});
