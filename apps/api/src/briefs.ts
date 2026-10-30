import type { PgDatabase } from "./db.ts";
import { validateCreationBrief } from "../../../packages/project-core/src/brief.ts";
import type { CreationBrief } from "../../../packages/project-core/src/brief.ts";

export class BriefError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

export function parseCreationBrief(value: unknown): CreationBrief {
  try { return validateCreationBrief(value); }
  catch (error) { throw new BriefError(400, error instanceof Error ? error.message : "创作原文无效"); }
}

/** A new Agent brief must be backed by this account's saved, selected prompt. */
export async function assertInitialAgentBrief(db: PgDatabase, ownerId: string, brief: CreationBrief): Promise<void> {
  if (brief.source !== "agent") return;
  const idea = (await db.prepare(`SELECT input_text,state,selected_variant_id,edited_prompt
    FROM prompt_idea_sets WHERE id=? AND owner_id=?`).get(brief.ideaSetId!, ownerId)) as {
    input_text: string; state: string; selected_variant_id: string | null; edited_prompt: string | null;
  } | undefined;
  if (!idea || idea.state !== "ready" || idea.selected_variant_id !== brief.variantId ||
      idea.input_text !== brief.originalText || idea.edited_prompt !== brief.finalText) {
    throw new BriefError(400, "Agent 创作原文须来自本账号已选定并保存的灵感");
  }
}

export function assertBriefEdit(previous: CreationBrief, next: CreationBrief): void {
  if (previous.id !== next.id || previous.source !== next.source || previous.originalText !== next.originalText ||
      previous.ideaSetId !== next.ideaSetId || previous.variantId !== next.variantId || previous.createdAt !== next.createdAt) {
    throw new BriefError(400, "只能修改最终创作内容，不可改变原文和来源");
  }
}
