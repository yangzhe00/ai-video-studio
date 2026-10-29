import { describe, expect, it } from "vitest";
import { createVideoProject } from "@ai-video/project-schema";
import { parseProjectDslSnapshot } from "./cloud-api";

describe("project DSL transport", () => {
  it("checks envelope identity and nested DSL", () => {
    const document = createVideoProject({ projectId: "project-1", title: "项目", initialEpisodeId: "episode-1" });
    const valid = { id: "project-1", title: "项目", revision: 2, document, resourceRevisions: [
      { resourceType: "episode", resourceId: "episode-1", revision: 1 },
    ] };
    expect(parseProjectDslSnapshot(valid).document).toEqual(document);
    expect(() => parseProjectDslSnapshot({ ...valid, id: "other-project" })).toThrow(/不一致/);
    expect(() => parseProjectDslSnapshot({ ...valid, document: { ...document, dslVersion: 2 } })).toThrow(/内容无效/);
  });
});
