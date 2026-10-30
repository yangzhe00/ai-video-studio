import { describe, expect, it } from "vitest";
import { creationBriefs, countUnicodeCharacters, validateCreationBrief } from "./brief";
import { applySyncCommand } from "./sync";
import type { CloudProjectDocument } from "./sync";

const manual = { id: "brief-0001", source: "manual", originalText: "小狗做饭\n然后上菜", finalText: "小狗做饭\n然后上菜",
  createdAt: 10, updatedAt: 10 } as const;

describe("creation briefs", () => {
  it("preserves full Unicode text and enforces the 10000-character boundary", () => {
    expect(countUnicodeCharacters("🐶\n做饭")).toBe(4);
    expect(validateCreationBrief({ ...manual, originalText: "🐶".repeat(10000) }).originalText).toHaveLength(20000);
    expect(() => validateCreationBrief({ ...manual, originalText: "🐶".repeat(10001) })).toThrow();
    expect(() => validateCreationBrief({ ...manual, finalText: " \n " })).toThrow();
  });

  it("validates agent provenance and timestamps without rewriting text", () => {
    expect(validateCreationBrief({ ...manual, source: "agent", ideaSetId: "idea-0001", variantId: "variant-1" }))
      .toMatchObject({ source: "agent", originalText: manual.originalText, variantId: "variant-1" });
    expect(() => validateCreationBrief({ ...manual, source: "agent" })).toThrow();
    expect(() => validateCreationBrief({ ...manual, updatedAt: 9 })).toThrow();
    expect(() => validateCreationBrief({ ...manual, ideaSetId: "idea-0001" })).toThrow();
  });

  it("reads old documents as empty and appends briefs without touching episodes or timeline", () => {
    const document: CloudProjectDocument = { version: 1, episodes: [{ id: "episode-0001", title: "第一集", shots: [], timeline: ["asset-0001"] }],
      assets: [{ id: "asset-0001", kind: "video" }], characters: [] };
    expect(creationBriefs(document)).toEqual([]);
    const changed = applySyncCommand(document, { id: "command-0001", resourceType: "brief", resourceId: manual.id,
      baseRevision: 0, payload: manual });
    expect(creationBriefs(changed)).toEqual([manual]);
    expect(changed.episodes).toEqual(document.episodes);
    expect(creationBriefs({ extensions: { creationBriefs: [manual] } })).toEqual([manual]);
  });
});
