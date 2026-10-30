import type { PgDatabase } from "./db.ts";
import type { ApiConfig } from "./config.ts";
import { readIdeaAgentSession } from "./idea-agents.ts";
import { readIdeaCursorRun } from "./idea-cursor.ts";
import { IdeaModelError } from "./idea-model.ts";

interface PendingAgentIdea { id: string; provider: string; provider_session_id: string; provider_run_id: string | null; created_at: number }

export class IdeaAgentWorker {
  private running = false;
  constructor(private readonly db: PgDatabase, private readonly config: ApiConfig,
    private readonly read: typeof readIdeaAgentSession = readIdeaAgentSession,
    private readonly readCursor: typeof readIdeaCursorRun = readIdeaCursorRun) {}

  async tick(): Promise<void> {
    if (this.running || !(this.config.ideaAgentApiKey && this.config.ideaAgentModel) && !this.config.ideaCursorApiKey) return;
    this.running = true;
    try {
      const now = Date.now();
      const rows = (await this.db.prepare(`SELECT id,provider,provider_session_id,provider_run_id,created_at FROM prompt_idea_sets
        WHERE provider IN ('agents','cursor') AND state='pending' AND provider_session_id IS NOT NULL
          AND provider_last_polled_at<=? ORDER BY provider_last_polled_at LIMIT 10`).all(now - 3_000)) as unknown as PendingAgentIdea[];
      for (const row of rows) {
        if (row.provider === "agents" && !(this.config.ideaAgentApiKey && this.config.ideaAgentModel) ||
            row.provider === "cursor" && !this.config.ideaCursorApiKey) continue;
        (await this.db.prepare("UPDATE prompt_idea_sets SET provider_last_polled_at=? WHERE id=? AND state='pending'").run(Date.now(), row.id));
        if (now - row.created_at > 15 * 60_000) {
          (await this.db.prepare("UPDATE prompt_idea_sets SET state='unknown',error_code='uncertain',updated_at=? WHERE id=? AND state='pending'").run(Date.now(), row.id));
          continue;
        }
        try {
          const outcome = row.provider === "cursor"
            ? await this.readCursor(this.config, row.provider_session_id, row.provider_run_id)
            : await this.read(this.config, row.provider_session_id);
          if (row.provider === "cursor" && "runId" in outcome && typeof outcome.runId === "string" && !row.provider_run_id) {
            (await this.db.prepare("UPDATE prompt_idea_sets SET provider_run_id=? WHERE id=? AND state='pending'").run(outcome.runId, row.id));
          }
          if (outcome.state === "ready") {
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
