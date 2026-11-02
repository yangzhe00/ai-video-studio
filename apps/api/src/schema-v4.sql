ALTER TABLE prompt_idea_sets ADD COLUMN IF NOT EXISTS parent_idea_set_id TEXT REFERENCES prompt_idea_sets(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_prompt_ideas_parent ON prompt_idea_sets(parent_idea_set_id,created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_prompt_ideas_one_active_expansion
  ON prompt_idea_sets(parent_idea_set_id)
  WHERE parent_idea_set_id IS NOT NULL AND state IN ('pending','ready','unknown');
UPDATE prompt_idea_sets SET state='unknown',error_code='uncertain',updated_at=GREATEST(updated_at+1,0)
  WHERE provider IN ('chat','agents') AND state='pending';
