import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, renameSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ffmpeg from "@ffmpeg-installer/ffmpeg";
import ffprobe from "@ffprobe-installer/ffprobe";
import { afterEach, describe, expect, it } from "vitest";
import { createTestDb } from "./test-db.ts";
import type { PgDatabase } from "./db.ts";
import { createEpisodeRender, EpisodeRenderWorker, getEpisodeRender } from "./episode-renders.ts";

const fixtures: { db: PgDatabase; dir: string }[] = [];
afterEach(async () => { for (const fixture of fixtures.splice(0)) { await fixture.db.close(); rmSync(fixture.dir, { recursive: true, force: true }); } });

describe("episode render operations", () => {
  it("requires a current successful preview for v2 audio and reuses the same export operation", async () => {
    const dir = mkdtempSync(join(tmpdir(), "avs-timeline-export-gate-"));
    const db = await createTestDb(dir);
    fixtures.push({ db, dir });
    const owner = randomUUID(), project = randomUUID(), episode = randomUUID(), video = randomUUID();
    await db.prepare("INSERT INTO accounts (id,email,password_hash,created_at,demo_quota) VALUES (?,?,?,?,?)")
      .run(owner, `${owner}@example.com`, "hash", Date.now(), 3);
    const content = { version: 1, assets: [{ id: video, kind: "video" }], characters: [],
      episodes: [{ id: episode, title: "整集", shots: [], timeline: [video],
        audio: { version: 2, originalVolume: 1, voiceClips: [], musicClips: [] } }] };
    await db.prepare("INSERT INTO projects (id,owner_id,title,revision,document_json,created_at) VALUES (?,?,?,?,?,?)")
      .run(project, owner, "项目", 1, JSON.stringify(content), Date.now());
    await db.prepare("INSERT INTO resource_revisions (project_id,resource_type,resource_id,revision) VALUES (?,'episode',?,1)")
      .run(project, episode);
    const body = { renderOperationId: randomUUID(), expectedEpisodeRevision: 1 };
    await expect(createEpisodeRender(db, owner, project, episode, body)).rejects.toMatchObject({ status: 409 });
    const now = Date.now();
    await db.prepare(`INSERT INTO preview_operations (id,owner_id,project_id,scope,target_id,revision,snapshot_json,
      state,expires_at,created_at,updated_at) VALUES (?,?,?,'episode',?,1,?,'succeeded',?,?,?)`)
      .run(randomUUID(), owner, project, episode, JSON.stringify(content.episodes[0]), now + 60_000, now, now);
    const first = await createEpisodeRender(db, owner, project, episode, body);
    expect(first.render.state).toBe("pending");
    expect((await createEpisodeRender(db, owner, project, episode,
      { renderOperationId: randomUUID(), expectedEpisodeRevision: 1 })).render.id).toBe(body.renderOperationId);
    expect(await db.prepare("SELECT COUNT(*) AS count FROM episode_render_operations").get()).toMatchObject({ count: 1 });
  });

  it("exports a voice track across two shots once and retains the original assets", async () => {
    const dir = mkdtempSync(join(tmpdir(), "avs-episode-operation-test-"));
    const db = await createTestDb(dir);
    fixtures.push({ db, dir });
    const owner = randomUUID(), project = randomUUID(), episode = randomUUID();
    await db.prepare("INSERT INTO accounts (id,email,password_hash,created_at,demo_quota) VALUES (?,?,?,?,?)")
      .run(owner, `${owner}@example.com`, "hash", Date.now(), 3);
    const ids = [randomUUID(), randomUUID(), randomUUID()];
    const paths = [join(dir, "shot-a.mp4"), join(dir, "shot-b.mp4"), join(dir, "voice.mp3")];
    for (const path of paths.slice(0, 2)) execFileSync(ffmpeg.path, ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi",
      "-i", "color=c=blue:s=64x64:r=12:d=1", "-c:v", "libx264", "-pix_fmt", "yuv420p", path]);
    execFileSync(ffmpeg.path, ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi",
      "-i", "sine=frequency=800:duration=1", paths[2]]);
    const document = { version: 1, characters: [], assets: [
      { id: ids[0], kind: "video" }, { id: ids[1], kind: "video" },
      { id: ids[2], kind: "voice", name: "录音", mimeType: "audio/mpeg", durationMs: 1000 }],
    episodes: [{ id: episode, title: "第一集", shots: [], timeline: ids.slice(0, 2),
      timelineClips: ids.slice(0, 2).map((assetId, index) => ({ id: `clip-${index}`, assetId, inMs: 0, outMs: 1000, volume: 1 })),
      audio: { originalVolume: 0, voiceClips: [{ assetId: ids[2], startMs: 500, inMs: 0, outMs: 1000, volume: 1 }], musicClips: [] } }] };
    await db.prepare("INSERT INTO projects (id,owner_id,title,revision,document_json,created_at) VALUES (?,?,?,?,?,?)")
      .run(project, owner, "项目", 1, JSON.stringify(document), Date.now());
    await db.prepare("INSERT INTO resource_revisions (project_id,resource_type,resource_id,revision) VALUES (?,'episode',?,1)")
      .run(project, episode);
    for (let index = 0; index < ids.length; index++) await db.prepare("INSERT INTO objects (id,owner_id,sha256,mime,size,path,created_at) VALUES (?,?,?,?,?,?,?)")
      .run(ids[index], owner, `sha-${index}`, index === 2 ? "audio/mpeg" : "video/mp4",
        readFileSync(paths[index]).length, paths[index], Date.now());
    const operationId = randomUUID();
    const first = await createEpisodeRender(db, owner, project, episode, { renderOperationId: operationId, expectedEpisodeRevision: 1 });
    expect(first.render).toMatchObject({ state: "pending", outputAssetId: null });
    const worker = new EpisodeRenderWorker(db, dir, { dataDir: dir, databaseUrl: "", sessionSecret: "secret" });
    await worker.run(operationId);
    const result = await getEpisodeRender(db, owner, operationId);
    expect(result.state).toBe("succeeded");
    const output = await db.prepare("SELECT path FROM objects WHERE id=? AND owner_id=?").get(result.outputAssetId, owner) as { path: string };
    const probe = JSON.parse(execFileSync(ffprobe.path, ["-v", "error", "-show_entries", "stream=codec_type,codec_name", "-of", "json", output.path],
      { encoding: "utf8" })) as { streams: { codec_type: string; codec_name: string }[] };
    expect(probe.streams).toEqual(expect.arrayContaining([{ codec_type: "audio", codec_name: "aac" }]));
    expect((await createEpisodeRender(db, owner, project, episode, { renderOperationId: randomUUID(), expectedEpisodeRevision: 1 })).render.id)
      .toBe(operationId);
    expect(await db.prepare("SELECT COUNT(*) AS count FROM episode_render_operations").get()).toMatchObject({ count: 1 });
    expect(await db.prepare("SELECT COUNT(*) AS count FROM objects WHERE id IN (?,?,?)").get(...ids)).toMatchObject({ count: 3 });
    await db.prepare("UPDATE resource_revisions SET revision=2 WHERE project_id=? AND resource_type='episode' AND resource_id=?")
      .run(project, episode);
    const missingPath = `${paths[0]}.moved`;
    renameSync(paths[0], missingPath);
    const nextId = randomUUID();
    try {
      await createEpisodeRender(db, owner, project, episode, { renderOperationId: nextId, expectedEpisodeRevision: 2 });
      await worker.run(nextId);
      const failed = await getEpisodeRender(db, owner, nextId);
      expect(failed.state).toBe("failed");
      expect(failed.error).toMatch(/画面素材丢失或无法读取/);
      expect(failed.error).not.toContain(paths[0]);
      expect(failed.error).not.toContain("ffprobe");
      await db.prepare("UPDATE episode_render_operations SET error=? WHERE id=?")
        .run(`Command failed: /Volumes/project/node_modules/ffprobe -i ${paths[0]}`, nextId);
      const oldRawFailure = await getEpisodeRender(db, owner, nextId);
      expect(oldRawFailure.error).not.toContain(paths[0]);
      expect(oldRawFailure.error).not.toContain("ffprobe");
      expect(existsSync(output.path)).toBe(true);
      expect((await getEpisodeRender(db, owner, operationId)).state).toBe("succeeded");
    } finally { renameSync(missingPath, paths[0]); }
    const retry = await createEpisodeRender(db, owner, project, episode,
      { renderOperationId: randomUUID(), expectedEpisodeRevision: 2 });
    expect(retry).toMatchObject({ replayed: true, render: { id: nextId, state: "pending" } });
    await worker.run(nextId);
    expect((await getEpisodeRender(db, owner, nextId)).state).toBe("succeeded");
    expect(await db.prepare("SELECT COUNT(*) AS count FROM episode_render_operations").get()).toMatchObject({ count: 2 });
  }, 30_000);
});
