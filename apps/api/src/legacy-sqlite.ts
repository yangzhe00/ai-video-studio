import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { migrateCloudDocument } from "./cloud-document.ts";

export function createDb(dataDir: string): DatabaseSync {
  mkdirSync(dataDir, { recursive: true });
  const db = new DatabaseSync(join(dataDir, "studio.sqlite"));
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
  const version = (db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version;
  if (version > 10) { db.close(); throw new Error(`Database schema version ${version} is newer than this API`); }
  db.exec("BEGIN IMMEDIATE");
  try {
    db.exec(`
    CREATE TABLE IF NOT EXISTS accounts (
      id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL,
      created_at INTEGER NOT NULL, demo_quota INTEGER NOT NULL, demo_reserved INTEGER NOT NULL DEFAULT 0,
      demo_used INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      title TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1, document_json TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS objects (
      id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      sha256 TEXT NOT NULL, mime TEXT NOT NULL, size INTEGER NOT NULL, path TEXT NOT NULL,
      created_at INTEGER NOT NULL, UNIQUE(owner_id, sha256)
    );
    CREATE TABLE IF NOT EXISTS agent_runs (
      id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      client_request_id TEXT NOT NULL, request_hash TEXT NOT NULL,
      episode_id TEXT NOT NULL, source_object_id TEXT NOT NULL REFERENCES objects(id),
      prompt TEXT NOT NULL, duration_sec INTEGER NOT NULL, plan_json TEXT NOT NULL,
      plan_hash TEXT NOT NULL, state TEXT NOT NULL, created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL, UNIQUE(owner_id, client_request_id)
    );
    CREATE TABLE IF NOT EXISTS run_events (
      run_id TEXT NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
      seq INTEGER NOT NULL, state TEXT NOT NULL, message TEXT NOT NULL,
      result_json TEXT, created_at INTEGER NOT NULL,
      PRIMARY KEY(run_id, seq)
    );
    CREATE TABLE IF NOT EXISTS operations (
      id TEXT PRIMARY KEY, run_id TEXT NOT NULL UNIQUE REFERENCES agent_runs(id) ON DELETE CASCADE,
      approval_id TEXT NOT NULL, state TEXT NOT NULL, external_task_id TEXT NOT NULL UNIQUE,
      remote_task_id TEXT, submitted_at INTEGER, created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS resource_revisions (
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      resource_type TEXT NOT NULL, resource_id TEXT NOT NULL, revision INTEGER NOT NULL,
      PRIMARY KEY(project_id,resource_type,resource_id)
    );
    CREATE TABLE IF NOT EXISTS project_commands (
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      command_id TEXT NOT NULL, payload_hash TEXT NOT NULL,
      resource_type TEXT NOT NULL, resource_id TEXT NOT NULL,
      resulting_revision INTEGER NOT NULL, created_at INTEGER NOT NULL,
      PRIMARY KEY(project_id,command_id)
    );
    CREATE TABLE IF NOT EXISTS video_edits (
      id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      episode_id TEXT NOT NULL, shot_id TEXT NOT NULL, source_object_id TEXT NOT NULL REFERENCES objects(id),
      recipe_json TEXT NOT NULL, revision INTEGER NOT NULL,
      current_output_id TEXT REFERENCES objects(id), current_cover_id TEXT REFERENCES objects(id),
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
      UNIQUE(owner_id,project_id,shot_id)
    );
    CREATE TABLE IF NOT EXISTS edit_commands (
      edit_id TEXT NOT NULL REFERENCES video_edits(id) ON DELETE CASCADE,
      command_id TEXT NOT NULL, payload_hash TEXT NOT NULL, resulting_revision INTEGER NOT NULL,
      PRIMARY KEY(edit_id,command_id)
    );
    CREATE TABLE IF NOT EXISTS render_operations (
      id TEXT PRIMARY KEY, edit_id TEXT NOT NULL REFERENCES video_edits(id) ON DELETE CASCADE,
      owner_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      recipe_revision INTEGER NOT NULL, recipe_json TEXT NOT NULL,
      state TEXT NOT NULL, output_object_id TEXT REFERENCES objects(id), cover_object_id TEXT REFERENCES objects(id),
      error TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
      UNIQUE(edit_id,recipe_revision)
    );
    CREATE TABLE IF NOT EXISTS render_events (
      operation_id TEXT NOT NULL REFERENCES render_operations(id) ON DELETE CASCADE,
      seq INTEGER NOT NULL, state TEXT NOT NULL, message TEXT NOT NULL, created_at INTEGER NOT NULL,
      PRIMARY KEY(operation_id,seq)
    );
    `);
    if (version < 2) {
      const columns = new Set((db.prepare("PRAGMA table_info(render_operations)").all() as { name: string }[]).map(row => row.name));
      if (!columns.has("lease_token")) db.exec("ALTER TABLE render_operations ADD COLUMN lease_token TEXT");
      if (!columns.has("lease_expires_at")) db.exec("ALTER TABLE render_operations ADD COLUMN lease_expires_at INTEGER");
      db.exec("CREATE INDEX IF NOT EXISTS idx_render_claim ON render_operations(state, lease_expires_at, created_at)");
      db.exec("PRAGMA user_version = 2");
    }
    if (version < 3) {
      const projects = db.prepare("SELECT id,document_json FROM projects").all() as { id: string; document_json: string }[];
      const addRevision = db.prepare("INSERT OR IGNORE INTO resource_revisions (project_id,resource_type,resource_id,revision) VALUES (?,?,?,1)");
      const updateDocument = db.prepare("UPDATE projects SET document_json=? WHERE id=?");
      for (const project of projects) {
        const { document, changed } = migrateCloudDocument(project.id, JSON.parse(project.document_json));
        if (changed) updateDocument.run(JSON.stringify(document), project.id);
        for (const episode of document.episodes) addRevision.run(project.id, "episode", episode.id);
        for (const asset of document.assets) addRevision.run(project.id, "asset", asset.id);
        for (const character of document.characters) addRevision.run(project.id, "character", character.id);
        const graphs = (document.extensions?.canvas as { episodeGraphs?: Record<string, unknown> } | undefined)?.episodeGraphs;
        for (const id of Object.keys(graphs ?? {})) addRevision.run(project.id, "canvas", id);
      }
      db.exec("PRAGMA user_version = 3");
    }
    if (version < 4) {
      const projects = db.prepare("SELECT id,document_json FROM projects").all() as { id: string; document_json: string }[];
      const edits = db.prepare("SELECT shot_id,source_object_id FROM video_edits WHERE project_id=?");
      const updateDocument = db.prepare("UPDATE projects SET document_json=?,revision=revision+1 WHERE id=?");
      const bumpEpisode = db.prepare(`INSERT INTO resource_revisions (project_id,resource_type,resource_id,revision)
        VALUES (?,'episode',?,1) ON CONFLICT(project_id,resource_type,resource_id) DO UPDATE SET revision=revision+1`);
      for (const project of projects) {
        const document = JSON.parse(project.document_json) as { episodes: { id: string; shots: { id: string; resultAssetId: string; originalAssetId?: string; selectedAssetId?: string }[] }[] };
        const originals = new Map((edits.all(project.id) as { shot_id: string; source_object_id: string }[])
          .map(edit => [edit.shot_id, edit.source_object_id]));
        let changed = false;
        for (const episode of document.episodes) {
          let episodeChanged = false;
          for (const shot of episode.shots) {
            if (!shot.resultAssetId) continue;
            if (!shot.originalAssetId) { shot.originalAssetId = originals.get(shot.id) ?? shot.resultAssetId; episodeChanged = true; }
            if (!shot.selectedAssetId) { shot.selectedAssetId = shot.resultAssetId; episodeChanged = true; }
          }
          if (episodeChanged) { bumpEpisode.run(project.id, episode.id); changed = true; }
        }
        if (changed) updateDocument.run(JSON.stringify(document), project.id);
      }
      db.exec("PRAGMA user_version = 4");
    }
    if (version < 5) {
      const columns = new Set((db.prepare("PRAGMA table_info(operations)").all() as { name: string }[]).map(row => row.name));
      if (!columns.has("last_polled_at")) db.exec("ALTER TABLE operations ADD COLUMN last_polled_at INTEGER NOT NULL DEFAULT 0");
      db.exec("CREATE INDEX IF NOT EXISTS idx_operations_poll ON operations(state,last_polled_at)");
      db.exec("PRAGMA user_version = 5");
    }
    if (version < 6) {
      db.exec(`CREATE TABLE IF NOT EXISTS prompt_idea_sets (
        id TEXT PRIMARY KEY,
        owner_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        client_request_id TEXT NOT NULL,
        input_hash TEXT NOT NULL,
        input_text TEXT NOT NULL,
        state TEXT NOT NULL CHECK(state IN ('pending','ready','failed','unknown')),
        variants_json TEXT,
        selected_variant_id TEXT,
        edited_prompt TEXT,
        model_id TEXT,
        usage_json TEXT,
        error_code TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        UNIQUE(owner_id,client_request_id)
      );
      CREATE INDEX IF NOT EXISTS idx_prompt_ideas_owner_created ON prompt_idea_sets(owner_id,created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_prompt_ideas_created ON prompt_idea_sets(created_at);`);
      db.exec("PRAGMA user_version = 6");
    }
    if (version < 7) {
      const columns = new Set((db.prepare("PRAGMA table_info(projects)").all() as { name: string }[]).map(row => row.name));
      if (!columns.has("updated_at")) db.exec("ALTER TABLE projects ADD COLUMN updated_at INTEGER NOT NULL DEFAULT 0");
      if (!columns.has("recent_episode_id")) db.exec("ALTER TABLE projects ADD COLUMN recent_episode_id TEXT");
      const projects = db.prepare("SELECT id,created_at,document_json FROM projects").all() as { id: string; created_at: number; document_json: string }[];
      const backfill = db.prepare("UPDATE projects SET updated_at=CASE WHEN updated_at=0 THEN ? ELSE updated_at END,recent_episode_id=COALESCE(recent_episode_id,?) WHERE id=?");
      for (const project of projects) {
        const document = JSON.parse(project.document_json) as { episodes?: { id: string }[] };
        backfill.run(project.created_at, document.episodes?.[0]?.id ?? null, project.id);
      }
      db.exec("CREATE INDEX IF NOT EXISTS idx_projects_owner_updated ON projects(owner_id,updated_at DESC)");
      db.exec("PRAGMA user_version = 7");
    }
    if (version < 8) {
      const columns = new Set((db.prepare("PRAGMA table_info(prompt_idea_sets)").all() as { name: string }[]).map(row => row.name));
      if (!columns.has("provider")) db.exec("ALTER TABLE prompt_idea_sets ADD COLUMN provider TEXT NOT NULL DEFAULT 'chat'");
      if (!columns.has("provider_session_id")) db.exec("ALTER TABLE prompt_idea_sets ADD COLUMN provider_session_id TEXT");
      if (!columns.has("provider_last_polled_at")) db.exec("ALTER TABLE prompt_idea_sets ADD COLUMN provider_last_polled_at INTEGER NOT NULL DEFAULT 0");
      db.exec("CREATE INDEX IF NOT EXISTS idx_prompt_ideas_agent_poll ON prompt_idea_sets(provider,state,provider_last_polled_at)");
      db.exec("PRAGMA user_version = 8");
    }
    if (version < 9) {
      const columns = new Set((db.prepare("PRAGMA table_info(prompt_idea_sets)").all() as { name: string }[]).map(row => row.name));
      if (!columns.has("provider_run_id")) db.exec("ALTER TABLE prompt_idea_sets ADD COLUMN provider_run_id TEXT");
      db.exec("PRAGMA user_version = 9");
    }
    if (version < 10) {
      const columns = new Set((db.prepare("PRAGMA table_info(projects)").all() as { name: string }[]).map(row => row.name));
      if (!columns.has("creation_hash")) db.exec("ALTER TABLE projects ADD COLUMN creation_hash TEXT");
      const rows = db.prepare("SELECT id,document_json FROM projects").all() as { id: string; document_json: string }[];
      const update = db.prepare("UPDATE projects SET document_json=? WHERE id=?");
      for (const row of rows) {
        const result = migrateCloudDocument(row.id, JSON.parse(row.document_json));
        if (result.changed) update.run(JSON.stringify(result.document), row.id);
      }
      db.exec("PRAGMA user_version = 10");
    }
    db.exec("COMMIT");
  } catch (error) { db.exec("ROLLBACK"); db.close(); throw error; }
  return db;
}
