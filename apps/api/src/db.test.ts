import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createDb } from "./db.ts";

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

describe("database migrations", () => {
  it("adds a Cursor run ID to v8 idea rows without losing existing drafts", () => {
    const dir = mkdtempSync(join(tmpdir(), "avs-v8-cursor-migration-")); dirs.push(dir);
    const raw = new DatabaseSync(join(dir, "studio.sqlite"));
    raw.exec(`CREATE TABLE prompt_idea_sets (
      id TEXT PRIMARY KEY, owner_id TEXT, client_request_id TEXT, input_hash TEXT, input_text TEXT,
      state TEXT, variants_json TEXT, selected_variant_id TEXT, edited_prompt TEXT, model_id TEXT,
      usage_json TEXT, error_code TEXT, created_at INTEGER, updated_at INTEGER,
      provider TEXT, provider_session_id TEXT, provider_last_polled_at INTEGER DEFAULT 0
    ); PRAGMA user_version = 8;`);
    raw.prepare("INSERT INTO prompt_idea_sets (id,owner_id,client_request_id,input_hash,input_text,state,created_at,updated_at,provider,provider_session_id) VALUES (?,?,?,?,?,?,?,?,?,?)")
      .run("idea-old", "owner-old", "request-old", "hash", "旧灵感", "ready", 1, 1, "agents", "session-old");
    raw.close();
    const db = createDb(dir);
    expect(db.prepare("PRAGMA user_version").get()).toEqual({ user_version: 9 });
    expect(db.prepare("SELECT input_text,provider_session_id,provider_run_id FROM prompt_idea_sets WHERE id='idea-old'").get())
      .toEqual({ input_text: "旧灵感", provider_session_id: "session-old", provider_run_id: null });
    db.close();
  });

  it("upgrades an existing render table without losing its rows", () => {
    const dir = mkdtempSync(join(tmpdir(), "avs-db-migration-")); dirs.push(dir);
    const raw = new DatabaseSync(join(dir, "studio.sqlite"));
    raw.exec(`CREATE TABLE render_operations (
      id TEXT PRIMARY KEY, edit_id TEXT NOT NULL, owner_id TEXT NOT NULL,
      recipe_revision INTEGER NOT NULL, recipe_json TEXT NOT NULL,
      state TEXT NOT NULL, output_object_id TEXT, cover_object_id TEXT,
      error TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
      UNIQUE(edit_id,recipe_revision)
    )`);
    raw.prepare("INSERT INTO render_operations (id,edit_id,owner_id,recipe_revision,recipe_json,state,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)")
      .run("render-old", "edit-old", "owner-old", 1, "{}", "running", 1, 1);
    raw.close();
    const db = createDb(dir);
    expect(db.prepare("PRAGMA user_version").get()).toEqual({ user_version: 9 });
    expect(db.prepare("SELECT id,state,lease_token,lease_expires_at FROM render_operations WHERE id='render-old'").get())
      .toEqual({ id: "render-old", state: "running", lease_token: null, lease_expires_at: null });
    db.close();
  });

  it("upgrades a v5 project without losing it and backfills project-library fields", () => {
    const dir = mkdtempSync(join(tmpdir(), "avs-v5-idea-migration-")); dirs.push(dir);
    const raw = new DatabaseSync(join(dir, "studio.sqlite"));
    raw.exec(`CREATE TABLE accounts (id TEXT PRIMARY KEY,email TEXT,password_hash TEXT,created_at INTEGER,demo_quota INTEGER,demo_reserved INTEGER DEFAULT 0,demo_used INTEGER DEFAULT 0);
      CREATE TABLE projects (id TEXT PRIMARY KEY,owner_id TEXT,title TEXT,revision INTEGER,document_json TEXT,created_at INTEGER);
      PRAGMA user_version = 5;`);
    raw.prepare("INSERT INTO accounts (id,email,password_hash,created_at,demo_quota) VALUES (?,?,?,?,?)")
      .run("owner-v5", "v5@example.com", "hash", 1, 3);
    raw.prepare("INSERT INTO projects (id,owner_id,title,revision,document_json,created_at) VALUES (?,?,?,?,?,?)")
      .run("project-v5", "owner-v5", "旧云项目", 4, JSON.stringify({ version: 1,
        episodes: [{ id: "episode-v5", title: "旧分集", shots: [], timeline: [] }], assets: [], characters: [] }), 1234);
    raw.close();
    const db = createDb(dir);
    expect(db.prepare("PRAGMA user_version").get()).toEqual({ user_version: 9 });
    expect(db.prepare("SELECT title,revision,created_at,updated_at,recent_episode_id FROM projects WHERE id='project-v5'").get())
      .toMatchObject({ title: "旧云项目", revision: 4, created_at: 1234, updated_at: 1234, recent_episode_id: "episode-v5" });
    expect(db.prepare("SELECT COUNT(*) AS count FROM prompt_idea_sets").get()).toEqual({ count: 0 });
    db.close();
  });

  it("fills old cloud document fields and missing resource revisions transactionally", () => {
    const dir = mkdtempSync(join(tmpdir(), "avs-cloud-migration-")); dirs.push(dir);
    const before = createDb(dir);
    before.prepare("INSERT INTO accounts (id,email,password_hash,created_at,demo_quota) VALUES (?,?,?,?,?)")
      .run("owner-0001", "old@example.com", "hash", 1, 2);
    before.prepare("INSERT INTO projects (id,owner_id,title,revision,document_json,created_at) VALUES (?,?,?,?,?,?)")
      .run("project-0001", "owner-0001", "旧项目", 1, JSON.stringify({ version: 1,
        episodes: [{ id: "episode-0001", title: "旧分集", shots: [], timeline: ["asset-0001"] },
          { id: "episode-0002", title: "缺少时间线", shots: [] }], assets: [{ id: "asset-0001", kind: "image" }] }), 1);
    before.exec("PRAGMA user_version = 2");
    before.close();
    const after = createDb(dir);
    const row = after.prepare("SELECT document_json FROM projects WHERE id='project-0001'").get() as { document_json: string };
    const document = JSON.parse(row.document_json);
    expect(document.episodes[0].timelineClips[0]).toMatchObject({ assetId: "asset-0001", inMs: 0, outMs: 5000, volume: 1 });
    expect(document.episodes[1]).toMatchObject({ timeline: [], timelineClips: [] });
    expect(document.characters).toEqual([]);
    expect(after.prepare("SELECT resource_type,resource_id,revision FROM resource_revisions WHERE project_id='project-0001' ORDER BY resource_type").all())
      .toEqual([{ resource_type: "asset", resource_id: "asset-0001", revision: 1 },
        { resource_type: "episode", resource_id: "episode-0001", revision: 1 },
        { resource_type: "episode", resource_id: "episode-0002", revision: 1 }]);
    after.close();
  });

  it("recovers an edited shot's original and selected video identities", () => {
    const dir = mkdtempSync(join(tmpdir(), "avs-version-migration-")); dirs.push(dir);
    const before = createDb(dir);
    before.prepare("INSERT INTO accounts (id,email,password_hash,created_at,demo_quota) VALUES (?,?,?,?,?)")
      .run("owner-0001", "version@example.com", "hash", 1, 2);
    for (const id of ["original-0001", "edited-0001"]) {
      before.prepare("INSERT INTO objects (id,owner_id,sha256,mime,size,path,created_at) VALUES (?,?,?,?,?,?,?)")
        .run(id, "owner-0001", id, "video/mp4", 1, join(dir, id), 1);
    }
    before.prepare("INSERT INTO projects (id,owner_id,title,revision,document_json,created_at) VALUES (?,?,?,?,?,?)")
      .run("project-0001", "owner-0001", "项目", 1, JSON.stringify({ version: 1, episodes: [{ id: "episode-0001", title: "集",
        shots: [{ id: "shot-0001", runId: "run-0001", resultAssetId: "edited-0001" }], timeline: ["original-0001"] }],
        assets: [{ id: "original-0001", kind: "video" }, { id: "edited-0001", kind: "video" }], characters: [] }), 1);
    before.prepare("INSERT INTO video_edits (id,owner_id,project_id,episode_id,shot_id,source_object_id,recipe_json,revision,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)")
      .run("edit-0001", "owner-0001", "project-0001", "episode-0001", "shot-0001", "original-0001", "{}", 1, 1, 1);
    before.exec("PRAGMA user_version = 3"); before.close();
    const after = createDb(dir);
    const row = after.prepare("SELECT document_json FROM projects WHERE id='project-0001'").get() as { document_json: string };
    const shot = JSON.parse(row.document_json).episodes[0].shots[0];
    expect(shot).toMatchObject({ originalAssetId: "original-0001", selectedAssetId: "edited-0001", resultAssetId: "edited-0001" });
    expect(JSON.parse(row.document_json).episodes[0].timeline).toEqual(["original-0001"]);
    after.close();
  });
});
