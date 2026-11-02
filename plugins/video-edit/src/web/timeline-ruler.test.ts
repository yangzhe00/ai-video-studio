import { describe, expect, it } from "vitest";
import { fitTimelineZoom, rulerTimeAtX } from "./timeline-ruler";

describe("timeline ruler coordinates", () => {
  it("maps a scrolled and zoomed lane rect to a 0.1 second playhead", () => {
    expect(rulerTimeAtX(245, -865, 148, 15000)).toBe(7500);
    expect(rulerTimeAtX(-100, 0, 76, 15000)).toBe(0);
    expect(rulerTimeAtX(9999, 0, 76, 15000)).toBe(15000);
  });

  it("fits a 15 second episode without exceeding the zoom range", () => {
    expect(fitTimelineZoom(15000, 900)).toBe(0.69);
    expect(fitTimelineZoom(0, 900)).toBe(1);
  });
});
