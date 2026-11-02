import { describe, expect, it } from "vitest";
import { assertReadableMediaSource, MediaSourceUnavailableError, publicMediaTaskError,
  publicStoredMediaTaskError } from "./media-task-error.ts";

describe("media task errors", () => {
  it("returns a recovery message for a missing source without exposing its path", () => {
    const path = "/private/tmp/avs-sensitive-object-0001.mp4";
    expect(() => assertReadableMediaSource(path, "visual")).toThrow(MediaSourceUnavailableError);
    try { assertReadableMediaSource(path, "visual"); }
    catch (error) {
      const message = publicMediaTaskError(error, "preview");
      expect(message).toMatch(/画面素材丢失或无法读取/);
      expect(message).not.toContain(path);
    }
  });

  it("never returns command lines or absolute paths from an unexpected ffprobe failure", () => {
    const raw = new Error("Command failed: /Volumes/project/node_modules/ffprobe -i /private/tmp/object.mp4");
    for (const action of ["preview", "export"] as const) {
      const message = publicMediaTaskError(raw, action);
      expect(message).not.toContain("ffprobe");
      expect(message).not.toContain("/private/tmp");
      expect(message).toMatch(/检查素材后重试/);
    }
    expect(publicStoredMediaTaskError(raw.message, "preview")).not.toContain("ffprobe");
    expect(publicStoredMediaTaskError(raw.message, "export")).not.toContain("/private/tmp");
  });
});
