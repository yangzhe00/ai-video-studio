import { describe, expect, it } from "vitest";
import { commandFromSnapshot } from "../../mobile/src/sync-command";

describe("mobile concurrent episode edits", () => {
  it("submits the revision the user edited, so a concurrent cloud edit is rejected", () => {
    const viewed = { resourceRevisions: [{ resourceType: "episode", resourceId: "episode-0001", revision: 1 }] };
    const command = commandFromSnapshot(viewed, "episode", "episode-0001", { timeline: ["local-video"] }, "command-0001");
    const cloudRevisionAfterOtherClient = 2;
    expect(command.baseRevision).toBe(1);
    expect(command.baseRevision).not.toBe(cloudRevisionAfterOtherClient);
  });
});
