CREATE TABLE IF NOT EXISTS preview_operations (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  scope TEXT NOT NULL CHECK (scope IN ('shot','episode')),
  target_id TEXT NOT NULL,
  revision BIGINT NOT NULL,
  snapshot_json TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('pending','running','succeeded','failed')),
  output_object_id TEXT REFERENCES objects(id),
  error TEXT,
  expires_at BIGINT,
  lease_token TEXT,
  lease_expires_at BIGINT,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  UNIQUE (scope,target_id,revision)
);
CREATE INDEX IF NOT EXISTS idx_previews_claim ON preview_operations(state,lease_expires_at,created_at);
ALTER TABLE preview_operations ADD COLUMN IF NOT EXISTS expires_at BIGINT;

CREATE TABLE IF NOT EXISTS preview_owned_objects (
  object_id TEXT PRIMARY KEY REFERENCES objects(id) ON DELETE CASCADE,
  owner_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE
);
