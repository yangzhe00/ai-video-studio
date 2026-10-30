/** Project-level source material. A brief never starts a video generation task. */
export interface CreationBrief {
  id: string;
  source: "manual" | "agent";
  originalText: string;
  finalText: string;
  ideaSetId?: string;
  variantId?: string;
  createdAt: number;
  updatedAt: number;
}

const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const validId = (value: unknown): value is string =>
  typeof value === "string" && /^[a-zA-Z0-9_-]{8,80}$/.test(value);

export function countUnicodeCharacters(text: string): number { return Array.from(text).length; }

export function validateCreationBrief(value: unknown): CreationBrief {
  if (!record(value) || !validId(value.id) || (value.source !== "manual" && value.source !== "agent")) {
    throw new Error("创作原文标识或来源无效");
  }
  for (const field of ["originalText", "finalText"] as const) {
    const text = value[field];
    if (typeof text !== "string" || !text.trim() || countUnicodeCharacters(text) > 10_000) {
      throw new Error(`${field === "originalText" ? "输入原文" : "最终创作内容"}长度需为 1 到 10000 字`);
    }
  }
  if (!Number.isSafeInteger(value.createdAt) || (value.createdAt as number) < 0 ||
      !Number.isSafeInteger(value.updatedAt) || (value.updatedAt as number) < (value.createdAt as number)) {
    throw new Error("创作原文时间无效");
  }
  if (value.source === "agent" && (!validId(value.ideaSetId) || !validId(value.variantId))) {
    throw new Error("Agent 灵感来源无效");
  }
  if (value.source === "manual" && (value.ideaSetId !== undefined || value.variantId !== undefined)) {
    throw new Error("手写原文不能关联 Agent 灵感");
  }
  return { id: value.id, source: value.source, originalText: value.originalText as string,
    finalText: value.finalText as string,
    ...(value.source === "agent" ? { ideaSetId: value.ideaSetId as string, variantId: value.variantId as string } : {}),
    createdAt: value.createdAt as number, updatedAt: value.updatedAt as number };
}

/** Supports cloud `document.briefs` and local `manifest.extensions.creationBriefs`. */
export function creationBriefs(documentOrManifest: unknown): CreationBrief[] {
  if (!record(documentOrManifest)) return [];
  const source = documentOrManifest.briefs !== undefined ? documentOrManifest.briefs : (record(documentOrManifest.extensions)
    ? documentOrManifest.extensions.creationBriefs : undefined);
  if (source === undefined) return [];
  if (!Array.isArray(source)) throw new Error("创作原文列表无效");
  return source.map(validateCreationBrief);
}
