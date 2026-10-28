import { describe, expect, it } from "vitest";
import { planImageVideo } from "./index.ts";

describe("first Agent plan", () => {
  it("keeps the user's selected photo and episode and requires approval", () => {
    expect(planImageVideo({ clientRequestId: "req", episodeId: "ep", sourceAssetId: "photo", input: "  小狗洗菜  ", durationSec: 5 }))
      .toMatchObject({ planner: "validated-input", requiresApproval: true, steps: [{ episodeId: "ep", sourceAssetId: "photo", prompt: "小狗洗菜", demoCredits: 1 }] });
  });
  it("rejects unsupported lengths and empty prompts", () => {
    const intent = { clientRequestId: "req", episodeId: "ep", sourceAssetId: "photo", input: "洗菜", durationSec: 5 as const };
    expect(() => planImageVideo({ ...intent, input: " " })).toThrow();
    expect(() => planImageVideo({ ...intent, durationSec: 8 as 5 })).toThrow();
  });
});
