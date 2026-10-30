CREATE TABLE IF NOT EXISTS tts_tasks (
  id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  client_request_id TEXT NOT NULL, request_hash TEXT NOT NULL,
  text_content TEXT NOT NULL, voice_id TEXT NOT NULL, voice_language TEXT NOT NULL, speed DOUBLE PRECISION NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('pending','submitting','unknown','running','succeeded','failed')),
  provider_task_id TEXT UNIQUE, provider_request_id TEXT, result_object_id TEXT REFERENCES objects(id),
  cost_status TEXT NOT NULL CHECK (cost_status IN ('unbilled','pending','billed','unknown')),
  estimated_cost_json TEXT, actual_cost_json TEXT, error TEXT,
  created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL, last_polled_at BIGINT NOT NULL DEFAULT 0,
  UNIQUE (owner_id, client_request_id)
);
CREATE INDEX IF NOT EXISTS idx_tts_tasks_poll ON tts_tasks(state,last_polled_at);

CREATE TABLE IF NOT EXISTS episode_render_operations (
  id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  episode_id TEXT NOT NULL, episode_revision BIGINT NOT NULL, snapshot_json TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('pending','running','succeeded','failed')),
  output_object_id TEXT REFERENCES objects(id), error TEXT, lease_token TEXT, lease_expires_at BIGINT,
  created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL,
  UNIQUE (project_id,episode_id,episode_revision)
);
CREATE INDEX IF NOT EXISTS idx_episode_renders_claim ON episode_render_operations(state,lease_expires_at,created_at);

CREATE TABLE IF NOT EXISTS agent_edit_sets (
  id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  episode_id TEXT NOT NULL, client_request_id TEXT NOT NULL, request_hash TEXT NOT NULL,
  instruction TEXT NOT NULL, snapshot_json TEXT NOT NULL, actions_json TEXT,
  state TEXT NOT NULL CHECK (state IN ('pending','generating','ready','failed')),
  model_id TEXT, prompt_version TEXT NOT NULL, error TEXT,
  confirmation_request_id TEXT, confirmation_hash TEXT, confirmed_action_ids_json TEXT,
  created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL,
  UNIQUE (owner_id,client_request_id)
);
CREATE INDEX IF NOT EXISTS idx_agent_edit_pending ON agent_edit_sets(state,created_at);
