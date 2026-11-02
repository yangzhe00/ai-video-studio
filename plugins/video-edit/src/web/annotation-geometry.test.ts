import { describe, expect, it } from "vitest";
import { containedVideoRect, normalizedBox, normalizedPoint } from "./annotation-geometry";

describe("video annotation coordinates", () => {
  it("excludes letterbox bars before normalizing portrait frame coordinates", () => {
    const content = containedVideoRect({ left: 0, top: 0, width: 800, height: 450 }, 1080, 1920);
    expect(content).toEqual({ left: 273.4375, top: 0, width: 253.125, height: 450 });
    expect(normalizedPoint(400, 225, { ...content, left: content.left + 100, top: content.top + 50 }).x).toBeCloseTo(0.105, 2);
    expect(normalizedPoint(400, 225, content)).toEqual({ x: 0.5, y: 0.5 });
  });

  it("normalizes a box regardless of drawing direction", () => {
    expect(normalizedBox({ x: 0.8, y: 0.7 }, { x: 0.2, y: 0.1 })).toEqual({ x: 0.2, y: 0.1, width: 0.6000000000000001, height: 0.6 });
  });
});
