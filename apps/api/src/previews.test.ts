import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ffmpeg from "@ffmpeg-installer/ffmpeg";
import ffprobe from "@ffprobe-installer/ffprobe";
import { afterEach, describe, expect, it } from "vitest";
import { createTestDb } from "./test-db.ts";
import type { PgDatabase } from "./db.ts";
import { createEpisodePreview, createShotPreview, getPreview, PreviewWorker } from "./previews.ts";

const fixtures: { db: PgDatabase; dir: string }[] = [];
afterEach(async () => { for (const item of fixtures.splice(0)) {
  await item.db.close(); rmSync(item.dir, { recursive: true, force: true });
} });

describe("saved audio preview", () => {
  it("renders shot and episode with AAC without replacing originals or creating final versions", async () => {
    const dir = mkdtempSync(join(tmpdir(), "avs-preview-test-"));
    const db = await createTestDb(dir);
    fixtures.push({ db, dir });
    const owner = randomUUID(), project = randomUUID(), episode = randomUUID(), edit = randomUUID();
    const video = randomUUID(), voice = randomUUID();
    const videoPath = join(dir, "source.mp4"), voicePath = join(dir, "voice.mp3");
    execFileSync(ffmpeg.path, ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi",
      "-i", "color=c=blue:s=64x64:r=12:d=1", "-c:v", "libx264", "-pix_fmt", "yuv420p", videoPath]);
    execFileSync(ffmpeg.path, ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi",
      "-i", "sine=frequency=800:duration=1", voicePath]);
    await db.prepare("INSERT INTO accounts (id,email,password_hash,created_at,demo_quota) VALUES (?,?,?,?,?)")
      .run(owner, `${owner}@example.com`, "hash", Date.now(), 3);
    const audioMix = { originalVolume: 0, voiceClips: [
      { assetId: voice, startMs: 200, inMs: 0, outMs: 800, volume: 1 }], musicClips: [] };
    const document = { version: 1, assets: [{ id: video, kind: "video" }, { id: voice, kind: "voice" }], characters: [],
      episodes: [{ id: episode, title: "预览", shots: [{ id: "shot-001", resultAssetId: video, durationSec: 1 }],
        timeline: [video], timelineClips: [{ id: "clip-001", assetId: video, inMs: 0, outMs: 1000, volume: 1 }],
        audio: audioMix }] };
    await db.prepare("INSERT INTO projects (id,owner_id,title,revision,document_json,created_at) VALUES (?,?,?,?,?,?)")
      .run(project, owner, "项目", 1, JSON.stringify(document), Date.now());
    await db.prepare("INSERT INTO resource_revisions (project_id,resource_type,resource_id,revision) VALUES (?,'episode',?,1)")
      .run(project, episode);
    for (const [id, mime, path] of [[video, "video/mp4", videoPath], [voice, "audio/mpeg", voicePath]]) {
      await db.prepare("INSERT INTO objects (id,owner_id,sha256,mime,size,path,created_at) VALUES (?,?,?,?,?,?,?)")
        .run(id, owner, randomUUID(), mime, readFileSync(path).length, path, Date.now());
    }
    const recipe = { version: 2, id: edit, projectId: project, episodeId: episode, shotId: "shot-001",
      sourceAssetId: video, sourceDurationMs: 1000, trimStartMs: 0, trimEndMs: 1000,
      captions: [], coverSourceMs: 0, revision: 2, audioMix };
    await db.prepare(`INSERT INTO video_edits (id,owner_id,project_id,episode_id,shot_id,source_object_id,
      recipe_json,revision,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)`)
      .run(edit, owner, project, episode, "shot-001", video, JSON.stringify(recipe), 2, Date.now(), Date.now());
    const worker = new PreviewWorker(db, dir, { dataDir: dir, databaseUrl: "", sessionSecret: "x".repeat(32) });
    const previewPaths: string[] = [];
    for (const [scope, create] of [
      ["shot", (id: string) => createShotPreview(db, owner, edit, { previewOperationId: id, expectedRevision: 2 })],
      ["episode", (id: string) => createEpisodePreview(db, owner, project, episode,
        { previewOperationId: id, expectedEpisodeRevision: 1 })],
    ] as const) {
      const id = randomUUID();
      expect((await create(id)).preview).toMatchObject({ id, scope, state: "pending", outputAssetId: null });
      await worker.run(id);
      const preview = await getPreview(db, owner, id);
      expect(preview).toMatchObject({ state: "succeeded", scope });
      const output = await db.prepare("SELECT path FROM objects WHERE id=? AND owner_id=?")
        .get(preview.outputAssetId, owner) as { path: string };
      previewPaths.push(output.path);
      const probe = JSON.parse(execFileSync(ffprobe.path, ["-v", "error", "-show_entries",
        "stream=codec_type,codec_name", "-of", "json", output.path], { encoding: "utf8" })) as
        { streams: { codec_type: string; codec_name: string }[] };
      expect(probe.streams).toEqual(expect.arrayContaining([{ codec_type: "audio", codec_name: "aac" }]));
      expect((await create(randomUUID())).preview.id).toBe(id);
    }
    expect(await db.prepare("SELECT COUNT(*) AS count FROM render_operations").get()).toMatchObject({ count: 0 });
    expect(await db.prepare("SELECT COUNT(*) AS count FROM episode_render_operations").get()).toMatchObject({ count: 0 });
    expect(await db.prepare("SELECT current_output_id FROM video_edits WHERE id=?").get(edit))
      .toMatchObject({ current_output_id: null });
    expect(JSON.parse((await db.prepare("SELECT document_json FROM projects WHERE id=?").get(project) as
      { document_json: string }).document_json)).toEqual(document);
    await worker.cleanup(Date.now() + 3_600_001);
    expect(await db.prepare("SELECT COUNT(*) AS count FROM preview_operations").get()).toMatchObject({ count: 0 });
    expect(previewPaths.every(path => !existsSync(path))).toBe(true);
    expect(await db.prepare("SELECT COUNT(*) AS count FROM objects WHERE id IN (?,?)").get(video, voice))
      .toMatchObject({ count: 2 });
  }, 30_000);
});
