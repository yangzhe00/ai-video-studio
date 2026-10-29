export interface RevisionedProject {
  resourceRevisions: { resourceType: string; resourceId: string; revision: number }[];
}

export function commandFromSnapshot(project: RevisionedProject, resourceType: "asset" | "episode", resourceId: string,
  payload: unknown, commandId: string) {
  return {
    id: commandId, resourceType, resourceId,
    baseRevision: project.resourceRevisions.find(item => item.resourceType === resourceType && item.resourceId === resourceId)?.revision ?? 0,
    payload,
  };
}
