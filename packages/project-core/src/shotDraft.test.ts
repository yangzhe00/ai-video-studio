import { describe, expect, it } from "vitest";
import { createShotDraft, DOG_CHEF_PRESET } from "./shotDraft";

describe("freeform shot drafts", () => {
  it("keeps an arbitrary human prompt without dog content", () => {
    const shot = createShotDraft("human-photo", "在雨中跳舞", 5);
    expect(shot.prompt).toBe("在雨中跳舞");
    expect(shot.speaking).toBe(false);
    expect(shot.modelId).toBe("kling-v2-5-turbo");
    expect(shot.script).toBeNull();
    expect(shot.prompt).not.toContain("狗");
  });
  it("accepts an animal prompt without forced speech", () => {
    expect(createShotDraft("animal-photo", "在森林奔跑", 8).speaking).toBe(false);
  });
  it("makes supplied speech explicit and validates input", () => {
    const shot = createShotDraft("dog", "在厨房做饭", 5, "妈妈要下班了");
    expect(shot.speaking).toBe(true);
    expect(shot.modelId).toBe("kling-digital-character");
    expect(shot.script).toBe("妈妈要下班了");
    expect(() => createShotDraft("human", " ")).toThrow("提示词");
    expect(() => createShotDraft("human", "跳舞", 13)).toThrow("4 到 12");
  });
  it("keeps the chef preset optional", () => {
    expect(DOG_CHEF_PRESET.prompt).toContain("厨师服");
    expect(createShotDraft("cat", "在海边散步").prompt).toBe("在海边散步");
  });
});
