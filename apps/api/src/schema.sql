    CREATE TABLE IF NOT EXISTS accounts (
      id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL,
      created_at BIGINT NOT NULL, demo_quota BIGINT NOT NULL, demo_reserved BIGINT NOT NULL DEFAULT 0,
      demo_used BIGINT NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      expires_at BIGINT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      title TEXT NOT NULL, revision BIGINT NOT NULL DEFAULT 1, document_json TEXT NOT NULL,
      created_at BIGINT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS objects (
      id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      sha256 TEXT NOT NULL, mime TEXT NOT NULL, size BIGINT NOT NULL, path TEXT NOT NULL,
      created_at BIGINT NOT NULL, UNIQUE(owner_id, sha256)
    );
    CREATE TABLE IF NOT EXISTS agent_runs (
      id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      client_request_id TEXT NOT NULL, request_hash TEXT NOT NULL,
      episode_id TEXT NOT NULL, source_object_id TEXT NOT NULL REFERENCES objects(id),
      prompt TEXT NOT NULL, duration_sec BIGINT NOT NULL, plan_json TEXT NOT NULL,
      plan_hash TEXT NOT NULL, state TEXT NOT NULL, created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL, UNIQUE(owner_id, client_request_id)
    );
    CREATE TABLE IF NOT EXISTS run_events (
      run_id TEXT NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
      seq BIGINT NOT NULL, state TEXT NOT NULL, message TEXT NOT NULL,
      result_json TEXT, created_at BIGINT NOT NULL,
      PRIMARY KEY(run_id, seq)
    );
    CREATE TABLE IF NOT EXISTS operations (
      id TEXT PRIMARY KEY, run_id TEXT NOT NULL UNIQUE REFERENCES agent_runs(id) ON DELETE CASCADE,
      approval_id TEXT NOT NULL, state TEXT NOT NULL, external_task_id TEXT NOT NULL UNIQUE,
      remote_task_id TEXT, submitted_at BIGINT, created_at BIGINT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS resource_revisions (
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      resource_type TEXT NOT NULL, resource_id TEXT NOT NULL, revision BIGINT NOT NULL,
      PRIMARY KEY(project_id,resource_type,resource_id)
    );
    CREATE TABLE IF NOT EXISTS project_commands (
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      command_id TEXT NOT NULL, payload_hash TEXT NOT NULL,
      resource_type TEXT NOT NULL, resource_id TEXT NOT NULL,
      resulting_revision BIGINT NOT NULL, created_at BIGINT NOT NULL,
      PRIMARY KEY(project_id,command_id)
    );
    CREATE TABLE IF NOT EXISTS video_edits (
      id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      episode_id TEXT NOT NULL, shot_id TEXT NOT NULL, source_object_id TEXT NOT NULL REFERENCES objects(id),
      recipe_json TEXT NOT NULL, revision BIGINT NOT NULL,
      current_output_id TEXT REFERENCES objects(id), current_cover_id TEXT REFERENCES objects(id),
      created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL,
      UNIQUE(owner_id,project_id,shot_id)
    );
    CREATE TABLE IF NOT EXISTS edit_commands (
      edit_id TEXT NOT NULL REFERENCES video_edits(id) ON DELETE CASCADE,
      command_id TEXT NOT NULL, payload_hash TEXT NOT NULL, resulting_revision BIGINT NOT NULL,
      PRIMARY KEY(edit_id,command_id)
    );
    CREATE TABLE IF NOT EXISTS render_operations (
      id TEXT PRIMARY KEY, edit_id TEXT NOT NULL REFERENCES video_edits(id) ON DELETE CASCADE,
      owner_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      recipe_revision BIGINT NOT NULL, recipe_json TEXT NOT NULL,
      state TEXT NOT NULL, output_object_id TEXT REFERENCES objects(id), cover_object_id TEXT REFERENCES objects(id),
      error TEXT, created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL,
      UNIQUE(edit_id,recipe_revision)
    );
    CREATE TABLE IF NOT EXISTS render_events (
      operation_id TEXT NOT NULL REFERENCES render_operations(id) ON DELETE CASCADE,
      seq BIGINT NOT NULL, state TEXT NOT NULL, message TEXT NOT NULL, created_at BIGINT NOT NULL,
      PRIMARY KEY(operation_id,seq)
    );

CREATE TABLE IF NOT EXISTS prompt_idea_sets (
  id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  client_request_id TEXT NOT NULL, input_hash TEXT NOT NULL, input_text TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('pending','ready','failed','unknown')),
  variants_json TEXT, selected_variant_id TEXT, edited_prompt TEXT, model_id TEXT,
  usage_json TEXT, error_code TEXT, created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL,
  provider TEXT NOT NULL DEFAULT 'chat', provider_session_id TEXT,
  provider_last_polled_at BIGINT NOT NULL DEFAULT 0, provider_run_id TEXT,
  UNIQUE(owner_id,client_request_id)
);
ALTER TABLE render_operations ADD COLUMN IF NOT EXISTS lease_token TEXT;
ALTER TABLE render_operations ADD COLUMN IF NOT EXISTS lease_expires_at BIGINT;
ALTER TABLE operations ADD COLUMN IF NOT EXISTS last_polled_at BIGINT NOT NULL DEFAULT 0;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS updated_at BIGINT NOT NULL DEFAULT 0;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS recent_episode_id TEXT;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS creation_hash TEXT;
CREATE INDEX IF NOT EXISTS idx_render_claim ON render_operations(state, lease_expires_at, created_at);
CREATE INDEX IF NOT EXISTS idx_operations_poll ON operations(state,last_polled_at);
CREATE INDEX IF NOT EXISTS idx_prompt_ideas_owner_created ON prompt_idea_sets(owner_id,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_prompt_ideas_created ON prompt_idea_sets(created_at);
CREATE INDEX IF NOT EXISTS idx_projects_owner_updated ON projects(owner_id,updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_prompt_ideas_agent_poll ON prompt_idea_sets(provider,state,provider_last_polled_at);
CREATE TABLE IF NOT EXISTS api_schema_version (version BIGINT NOT NULL);
