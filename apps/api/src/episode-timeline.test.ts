import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import ffmpeg from "@ffmpeg-installer/ffmpeg";
import ffprobe from "@ffprobe-installer/ffprobe";
import { createTestDb } from "./test-db.ts";
import type { PgDatabase } from "./db.ts";
import { createEpisodeRender, EpisodeRenderWorker, getEpisodeRender } from "./episode-renders.ts";
import { applyProjectCommand, readEpisodeTimeline } from "./sync.ts";

const fixtures: { db: PgDatabase; dir: string }[] = [];
afterEach(async () => { for (const item of fixtures.splice(0)) {
  await item.db.close(); rmSync(item.dir, { recursive: true, force: true });
} });

describe("episode timeline command", () => {
  it("projects only audible old video, saves a same-source split and lists audio beyond a shortened ending", async () => {
    const dir = mkdtempSync(join(tmpdir(), "avs-timeline-v3-"));
    const db = await createTestDb(dir);
    fixtures.push({ db, dir });
    const owner = randomUUID(), projectId = randomUUID(), episodeId = randomUUID();
    const video = randomUUID(), silentVideo = randomUUID(), music = randomUUID();
    const visual = randomUUID(), silentVisual = randomUUID();
    const source = join(dir, "source.mp4"), silent = join(dir, "silent.mp4"), musicPath = join(dir, "music.wav");
    execFileSync(ffmpeg.path, ["-v", "error", "-y", "-f", "lavfi", "-i", "color=c=blue:s=64x64:r=12:d=3",
      "-f", "lavfi", "-i", "sine=frequency=660:sample_rate=48000:duration=3",
      "-shortest", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", source]);
    execFileSync(ffmpeg.path, ["-v", "error", "-y", "-f", "lavfi", "-i", "color=c=red:s=64x64:r=12:d=3",
      "-c:v", "libx264", "-pix_fmt", "yuv420p", silent]);
    writeFileSync(musicPath, "fixture");
    await db.prepare("INSERT INTO accounts(id,email,password_hash,created_at,demo_quota) VALUES (?,?,?,?,?)")
      .run(owner, `${owner}@example.com`, "hash", 1, 3);
    for (const [id, path, mime] of [[video, source, "video/mp4"], [silentVideo, silent, "video/mp4"],
      [music, musicPath, "audio/wav"]]) await db.prepare("INSERT INTO objects(id,owner_id,sha256,mime,size,path,created_at) VALUES (?,?,?,?,?,?,?)")
      .run(id, owner, randomUUID(), mime, 1, path, 1);
    const episode = { id: episodeId, title: "第一集", shots: [], timeline: [video, silentVideo],
      timelineClips: [{ id: visual, assetId: video, inMs: 0, outMs: 3000, volume: 0.3 },
        { id: silentVisual, assetId: silentVideo, inMs: 0, outMs: 3000, volume: 1 }] };
    const document = { version: 1, episodes: [episode], assets: [{ id: video, kind: "video", durationMs: 3000 },
      { id: silentVideo, kind: "video", durationMs: 3000 }, { id: music, kind: "music", durationMs: 1000 }], characters: [] };
    await db.prepare("INSERT INTO projects(id,owner_id,title,revision,document_json,created_at) VALUES (?,?,?,?,?,?)")
      .run(projectId, owner, "项目", 1, JSON.stringify(document), 1);
    await db.prepare("INSERT INTO resource_revisions(project_id,resource_type,resource_id,revision) VALUES (?,'episode',?,1)")
      .run(projectId, episodeId);
    const projected = await readEpisodeTimeline(db, owner, projectId, episodeId);
    expect(projected.projectedFromLegacy).toBe(true);
    expect(projected.audio?.originalClips).toEqual([expect.objectContaining({ visualClipId: visual,
      assetId: video, inMs: 0, outMs: 3000, volume: 0.3 })]);
    const left = randomUUID(), right = randomUUID();
    const nextVisuals = [{ id: left, assetId: video, inMs: 0, outMs: 1300, volume: 0.3 },
      { id: right, assetId: video, inMs: 1300, outMs: 3000, volume: 0.3 }, episode.timelineClips[1]];
    const originals = [{ id: randomUUID(), visualClipId: left, assetId: video,
      inMs: 0, outMs: 1300, volume: 0.3, muted: false },
      { id: randomUUID(), visualClipId: right, assetId: video,
        inMs: 1300, outMs: 3000, volume: 0.3, muted: true }];
    const audio = { version: 3, originalVolume: 0.8, originalClips: originals, voiceClips: [], musicClips: [] };
    const command = { id: randomUUID(), resourceType: "episode", resourceId: episodeId, baseRevision: 1,
      payload: { ...episode, timeline: [video, video, silentVideo], timelineClips: nextVisuals, audio } };
    await expect(applyProjectCommand(db, owner, projectId, { ...command, id: randomUUID(),
      payload: { ...command.payload, audio: undefined } })).rejects.toMatchObject({ status: 409 });
    await expect(applyProjectCommand(db, owner, projectId, { ...command, id: randomUUID(),
      payload: { ...command.payload, audio: { ...audio, originalClips: [...originals,
        { id: randomUUID(), visualClipId: silentVisual, assetId: silentVideo,
          inMs: 0, outMs: 3000, volume: 1, muted: false }] } } })).rejects.toMatchObject({ status: 400 });
    await expect(applyProjectCommand(db, owner, projectId, { ...command, id: randomUUID(),
      payload: { ...command.payload, audio: { ...audio, originalClips: [...originals,
        { ...originals[0], id: randomUUID(), inMs: 100, outMs: 1200 }] } } })).rejects.toMatchObject({ status: 400 });
    await expect(applyProjectCommand(db, owner, projectId, { ...command, id: randomUUID(),
      payload: { ...command.payload, timeline: Array(101).fill(video),
        timelineClips: Array.from({ length: 101 }, (_, index) => ({ ...nextVisuals[0], id: `visual-limit-${index}` })) } }))
      .rejects.toMatchObject({ status: 400 });
    const first = await applyProjectCommand(db, owner, projectId, command);
    expect(first.resourceRevision).toBe(2);
    expect(first.project.document.episodes[0].timeline).toEqual([video, video, silentVideo]);
    expect((await applyProjectCommand(db, owner, projectId, command)).replayed).toBe(true);
    await expect(applyProjectCommand(db, owner, projectId, { ...command, id: randomUUID() }))
      .rejects.toMatchObject({ status: 409 });
    const overflow = { ...audio, musicClips: [{ id: randomUUID(), assetId: music, startMs: 4200,
      inMs: 0, outMs: 1000, volume: 1, anchor: { kind: "absolute" } }] };
    const shortened = { ...episode, timeline: [video, silentVideo],
      timelineClips: [nextVisuals[0], nextVisuals[2]], audio: { ...overflow, originalClips: [originals[0]] } };
    await expect(applyProjectCommand(db, owner, projectId, { ...command, id: randomUUID(), baseRevision: 2,
      payload: shortened })).rejects.toMatchObject({ status: 409,
        snapshot: { affectedAudioClips: [overflow.musicClips[0].id] } });
    expect((await db.prepare("SELECT revision FROM resource_revisions WHERE project_id=? AND resource_id=?")
      .get(projectId, episodeId))).toMatchObject({ revision: 2 });
    const locked = { ...audio, locks: { visual: false, original: true, voice: false, music: false } };
    await applyProjectCommand(db, owner, projectId, { ...command, id: randomUUID(), baseRevision: 2,
      payload: { ...command.payload, audio: locked } });
    await expect(applyProjectCommand(db, owner, projectId, { ...command, id: randomUUID(), baseRevision: 3,
      payload: { ...command.payload, audio: { ...locked, originalVolume: 0.2,
        locks: { ...locked.locks, original: false } } } })).rejects.toMatchObject({ status: 409 });
  }, 30_000);
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

  it("rejects a fixed tail voice beyond the new ending, then restores a deleted same-source segment and exports it", async () => {
    const dir = mkdtempSync(join(tmpdir(), "avs-timeline-restore-"));
    const db = await createTestDb(dir);
    fixtures.push({ db, dir });
    const owner = randomUUID(), projectId = randomUUID(), episodeId = randomUUID();
    const videoId = randomUUID(), voiceId = randomUUID();
    const leftId = randomUUID(), rightId = randomUUID(), voiceClipId = randomUUID();
    const source = join(dir, "source.mp4"), voicePath = join(dir, "voice.wav");
    execFileSync(ffmpeg.path, ["-v", "error", "-y", "-f", "lavfi", "-i", "color=c=blue:s=64x64:r=12:d=3",
      "-f", "lavfi", "-i", "sine=frequency=660:sample_rate=48000:duration=3",
      "-shortest", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", source]);
    execFileSync(ffmpeg.path, ["-v", "error", "-y", "-f", "lavfi", "-i",
      "sine=frequency=440:sample_rate=48000:duration=1", voicePath]);
    await db.prepare("INSERT INTO accounts(id,email,password_hash,created_at,demo_quota) VALUES (?,?,?,?,?)")
      .run(owner, `${owner}@example.com`, "hash", 1, 3);
    for (const [id, path, mime] of [[videoId, source, "video/mp4"], [voiceId, voicePath, "audio/wav"]]) {
      await db.prepare("INSERT INTO objects(id,owner_id,sha256,mime,size,path,created_at) VALUES (?,?,?,?,?,?,?)")
        .run(id, owner, randomUUID(), mime, readFileSync(path).length, path, 1);
    }
    const visuals = [
      { id: leftId, assetId: videoId, inMs: 0, outMs: 1300, volume: 1 },
      { id: rightId, assetId: videoId, inMs: 1300, outMs: 3000, volume: 1 },
    ];
    const originals = visuals.map(clip => ({ id: randomUUID(), visualClipId: clip.id,
      assetId: videoId, inMs: clip.inMs, outMs: clip.outMs, volume: 1, muted: false }));
    const voiceClip = { id: voiceClipId, assetId: voiceId, startMs: 1900, inMs: 0, outMs: 1000, volume: 1,
      anchor: { kind: "visual-clip", clipId: rightId, offsetMs: 600 } };
    const audio = { version: 3, originalVolume: 1, originalClips: originals,
      voiceClips: [voiceClip], musicClips: [] };
    const episode = { id: episodeId, title: "恢复测试", shots: [], timeline: [videoId, videoId],
      timelineClips: visuals, audio };
    const document = { version: 1, episodes: [episode], assets: [
      { id: videoId, kind: "video", durationMs: 3000 },
      { id: voiceId, kind: "voice", durationMs: 1000 }], characters: [] };
    await db.prepare("INSERT INTO projects(id,owner_id,title,revision,document_json,created_at) VALUES (?,?,?,?,?,?)")
      .run(projectId, owner, "项目", 1, JSON.stringify(document), 1);
    await db.prepare("INSERT INTO resource_revisions(project_id,resource_type,resource_id,revision) VALUES (?,'episode',?,1)")
      .run(projectId, episodeId);
    const preview = async (revision: number) => {
      const now = Date.now();
      await db.prepare(`INSERT INTO preview_operations(id,owner_id,project_id,scope,target_id,revision,snapshot_json,
        state,expires_at,created_at,updated_at) VALUES (?,?,?,'episode',?,?,?,'succeeded',?,?,?)`)
        .run(randomUUID(), owner, projectId, episodeId, revision, JSON.stringify(episode), now + 60_000, now, now);
    };
    const worker = new EpisodeRenderWorker(db, dir, { dataDir: dir, databaseUrl: "", sessionSecret: "secret" });
    await preview(1);
    const oldRender = await createEpisodeRender(db, owner, projectId, episodeId,
      { renderOperationId: randomUUID(), expectedEpisodeRevision: 1 });
    await worker.run(oldRender.render.id);
    const oldOutputId = (await getEpisodeRender(db, owner, oldRender.render.id)).outputAssetId;
    expect(oldOutputId).toEqual(expect.any(String));

    const save = (baseRevision: number, payload: object) => applyProjectCommand(db, owner, projectId,
      { id: randomUUID(), resourceType: "episode", resourceId: episodeId, baseRevision, payload });
    const fixedTailVoice = { ...voiceClip, anchor: { kind: "absolute" } };
    const shortened = { ...episode, timeline: [videoId], timelineClips: [visuals[0]],
      audio: { ...audio, originalClips: [originals[0]], voiceClips: [fixedTailVoice] } };
    await expect(save(1, shortened)).rejects.toMatchObject({ status: 409,
      snapshot: { affectedAudioClips: [voiceClipId] } });
    expect((await readEpisodeTimeline(db, owner, projectId, episodeId)).episodeRevision).toBe(1);

    const deleted = await save(1, { ...shortened, audio: { ...shortened.audio, voiceClips: [] } });
    expect(deleted.resourceRevision).toBe(2);
    const afterDelete = await readEpisodeTimeline(db, owner, projectId, episodeId);
    expect(afterDelete.timelineClips.map(clip => clip.id)).toEqual([leftId]);
    const restored = await save(2, episode);
    expect(restored.resourceRevision).toBe(3);
    const afterRestore = await readEpisodeTimeline(db, owner, projectId, episodeId);
    expect(afterRestore.timelineClips.map(clip => clip.id)).toEqual([leftId, rightId]);
    expect(afterRestore.audio?.originalClips?.map(clip => clip.visualClipId)).toEqual([leftId, rightId]);
    expect(afterRestore.audio?.voiceClips).toEqual([expect.objectContaining({ id: voiceClipId, startMs: 1900 })]);

    await preview(3);
    const newRender = await createEpisodeRender(db, owner, projectId, episodeId,
      { renderOperationId: randomUUID(), expectedEpisodeRevision: 3 });
    await worker.run(newRender.render.id);
    const latest = await getEpisodeRender(db, owner, newRender.render.id);
    expect(latest.state).toBe("succeeded");
    expect((await getEpisodeRender(db, owner, oldRender.render.id)).outputAssetId).toBe(oldOutputId);
    const rows = await db.prepare("SELECT id,path FROM objects WHERE id IN (?,?,?)").all(videoId, oldOutputId, latest.outputAssetId) as
      { id: string; path: string }[];
    // Identical restored output may be content-deduplicated into the old exported object.
    expect(rows).toHaveLength(new Set([videoId, oldOutputId, latest.outputAssetId]).size);
    expect(rows.every(row => existsSync(row.path))).toBe(true);
    const rendered = rows.find(row => row.id === latest.outputAssetId);
    const probe = JSON.parse(execFileSync(ffprobe.path, ["-v", "error", "-show_entries", "format=duration", "-of", "json",
      rendered!.path], { encoding: "utf8" })) as { format: { duration: string } };
    expect(Number(probe.format.duration)).toBeCloseTo(3, 1);
  }, 60_000);
});
