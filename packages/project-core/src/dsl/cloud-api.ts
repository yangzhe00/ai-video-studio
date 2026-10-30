import { parseProjectDsl } from "@ai-video/project-schema";
import type { VideoProjectV1 } from "@ai-video/project-schema";
import type { SyncResourceRevision } from "../sync";

export interface ProjectDslSnapshot {
  id: string;
  title: string;
  revision: number;
  document: VideoProjectV1;
  resourceRevisions: SyncResourceRevision[];
}

const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

/** Client adapter for GET /projects/:id/dsl. The endpoint is read-only for now. */
export function parseProjectDslSnapshot(raw: unknown): ProjectDslSnapshot {
  if (!record(raw) || typeof raw.id !== "string" || !raw.id ||
      typeof raw.title !== "string" || !Number.isSafeInteger(raw.revision) ||
      (raw.revision as number) < 0 || !Array.isArray(raw.resourceRevisions) ||
      !raw.resourceRevisions.every(item => record(item) &&
        ["episode", "asset", "character", "canvas", "brief"].includes(String(item.resourceType)) &&
        typeof item.resourceId === "string" && Number.isSafeInteger(item.revision) && (item.revision as number) >= 0)) {
    throw new Error("项目 DSL 响应格式无效");
  }
  const parsed = parseProjectDsl(raw.document);
  if (!parsed.ok || parsed.project.projectId !== raw.id || parsed.project.metadata.title !== raw.title) {
    throw new Error("项目 DSL 内容无效或与项目标识不一致");
  }
  return { id: raw.id, title: raw.title, revision: raw.revision as number,
    document: parsed.project, resourceRevisions: raw.resourceRevisions as SyncResourceRevision[] };
}
