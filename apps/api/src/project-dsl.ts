import type { PgDatabase } from "./db.ts";
import { migrateCloudV1ToDsl } from "@ai-video/project-core/cloud-dsl";
import type { LegacyCloudDocumentV1 } from "@ai-video/project-core/cloud-dsl";
import { listResourceRevisions } from "./sync.ts";

interface ProjectRow { id: string; title: string; revision: number; document_json: string }
interface VersionRow {
  shot_id: string;
  output_object_id: string;
  cover_object_id: string | null;
  recipe_id: string;
  created_at: number;
}

/** Read-only projection until project writers and workers support the new DSL. */
export async function readProjectDsl(db: PgDatabase, ownerId: string, projectId: string) {
  const row = (await db.prepare("SELECT id,title,revision,document_json FROM projects WHERE id=? AND owner_id=?")
    .get(projectId, ownerId)) as ProjectRow | undefined;
  if (!row) return null;
  const versions = (await db.prepare(`SELECT e.shot_id,r.output_object_id,r.cover_object_id,e.id AS recipe_id,r.updated_at AS created_at
    FROM video_edits e JOIN render_operations r ON r.edit_id=e.id
    WHERE e.project_id=? AND e.owner_id=? AND r.state='succeeded' AND r.output_object_id IS NOT NULL
    ORDER BY r.updated_at,r.id`).all(projectId, ownerId)) as unknown as VersionRow[];
  const versionsByShotId: Record<string, { outputAssetId: string; coverAssetId?: string; recipeId: string; createdAt: number }[]> = {};
  for (const version of versions) (versionsByShotId[version.shot_id] ??= []).push({
    outputAssetId: version.output_object_id,
    ...(version.cover_object_id ? { coverAssetId: version.cover_object_id } : {}),
    recipeId: version.recipe_id,
    createdAt: version.created_at,
  });
  const document = migrateCloudV1ToDsl(JSON.parse(row.document_json) as LegacyCloudDocumentV1, {
    projectId: row.id, title: row.title, versionsByShotId,
  });
  return { id: row.id, title: row.title, revision: row.revision, document,
    resourceRevisions: (await listResourceRevisions(db, row.id)) };
}
