import type { PgDatabase } from "./db.ts";

export const RENDER_LEASE_MS = 5 * 60_000;

export async function claimRender(db: PgDatabase, id: string, token: string, now = Date.now()): Promise<boolean> {
  return (await db.prepare(`UPDATE render_operations
    SET state='running',lease_token=?,lease_expires_at=?,updated_at=?
    WHERE id=? AND (state='pending' OR (state='running' AND COALESCE(lease_expires_at,0) <= ?))`)
    .run(token, now + RENDER_LEASE_MS, now, id, now)).changes === 1;
}
