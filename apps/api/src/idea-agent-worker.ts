import type { PgDatabase } from "./db.ts";
import type { ApiConfig } from "./config.ts";
import { readIdeaCursorRun } from "./idea-cursor.ts";
import { IdeaModelError, normalizedPrompt } from "./idea-result.ts";
import type { PromptVariant } from "./idea-result.ts";

interface PendingAgentIdea { id: string; provider: string; provider_session_id: string; provider_run_id: string | null; created_at: number; parent_idea_set_id: string | null }

export class IdeaAgentWorker {
  private running = false;
  constructor(private readonly db: PgDatabase, private readonly config: ApiConfig,
    private readonly readCursor: typeof readIdeaCursorRun = readIdeaCursorRun) {}

  async tick(): Promise<void> {
    if (this.running || !this.config.ideaCursorApiKey) return;
    this.running = true;
    try {
      const now = Date.now();
      const rows = (await this.db.prepare(`SELECT id,provider,provider_session_id,provider_run_id,created_at,parent_idea_set_id FROM prompt_idea_sets
        WHERE provider='cursor' AND state='pending' AND provider_session_id IS NOT NULL
          AND provider_last_polled_at<=? ORDER BY provider_last_polled_at LIMIT 10`).all(now - 3_000)) as unknown as PendingAgentIdea[];
      for (const row of rows) {
        (await this.db.prepare("UPDATE prompt_idea_sets SET provider_last_polled_at=? WHERE id=? AND state='pending'").run(Date.now(), row.id));
        if (now - row.created_at > 15 * 60_000) {
          (await this.db.prepare("UPDATE prompt_idea_sets SET state='unknown',error_code='uncertain',updated_at=? WHERE id=? AND state='pending'").run(Date.now(), row.id));
          continue;
        }
        try {
          const outcome = await this.readCursor(this.config, row.provider_session_id, row.provider_run_id);
          if ("runId" in outcome && typeof outcome.runId === "string" && !row.provider_run_id) {
            (await this.db.prepare("UPDATE prompt_idea_sets SET provider_run_id=? WHERE id=? AND state='pending'").run(outcome.runId, row.id));
          }
          if (outcome.state === "ready") {
            if (row.parent_idea_set_id) {
              const parent = (await this.db.prepare("SELECT variants_json FROM prompt_idea_sets WHERE id=?").get(row.parent_idea_set_id)) as { variants_json: string | null } | undefined;
              const previous = parent?.variants_json ? JSON.parse(parent.variants_json) as PromptVariant[] : [];
              const keys = new Set(previous.map(item => normalizedPrompt(item.prompt)));
              if (previous.length !== 3 || outcome.result.variants.some(item => keys.has(normalizedPrompt(item.prompt)))) {
                throw new IdeaModelError(502, "invalid_response", "新增灵感与原有脚本重复");
              }
            }
            (await this.db.prepare(`UPDATE prompt_idea_sets SET state='ready',variants_json=?,usage_json=?,error_code=NULL,updated_at=?
              WHERE id=? AND state='pending'`).run(JSON.stringify(outcome.result.variants),
              outcome.result.usage == null ? null : JSON.stringify(outcome.result.usage), Date.now(), row.id));
          }
        } catch (error) {
          const code = error instanceof IdeaModelError ? error.code : "uncertain";
          if (code === "uncertain") continue;
          (await this.db.prepare("UPDATE prompt_idea_sets SET state='failed',error_code=?,updated_at=? WHERE id=? AND state='pending'")
            .run(code, Date.now(), row.id));
        }
      }
    } finally { this.running = false; }
  }
}
