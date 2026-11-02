import { describe, expect, it } from "vitest";
import { MediaRangeError, parseMediaRange } from "./media-range.ts";

describe("media byte ranges", () => {
  it("returns null for an ordinary full-file request", () => {
    expect(parseMediaRange(undefined, 100)).toBeNull();
  });

  it("parses bounded, open-ended and suffix ranges", () => {
    expect(parseMediaRange("bytes=0-9", 100)).toEqual({ start: 0, end: 9 });
    expect(parseMediaRange("bytes=95-", 100)).toEqual({ start: 95, end: 99 });
    expect(parseMediaRange("bytes=-10", 100)).toEqual({ start: 90, end: 99 });
    expect(parseMediaRange("bytes=-200", 100)).toEqual({ start: 0, end: 99 });
    expect(parseMediaRange("bytes=95-200", 100)).toEqual({ start: 95, end: 99 });
  });

  it.each(["bytes=", "bytes=-0", "bytes=10-5", "bytes=100-", "bytes=0-1,5-6", "items=0-1", "bytes=1.5-2"])(
    "rejects malformed or unsatisfiable range %s", value => {
      expect(() => parseMediaRange(value, 100)).toThrow(MediaRangeError);
    },
  );

  it("rejects ranges for an empty object", () => {
    expect(() => parseMediaRange("bytes=0-", 0)).toThrow(MediaRangeError);
  });
});
