import { execFileSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ffmpeg from "@ffmpeg-installer/ffmpeg";
import { describe, expect, it, vi } from "vitest";
import { inspectMedia } from "./media-inspect.ts";

function image(format: "jpg" | "png"): Buffer {
  const folder = mkdtempSync(join(tmpdir(), "avs-media-test-"));
  try {
    const file = join(folder, `photo.${format}`);
    execFileSync(ffmpeg.path, ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "color=c=blue:s=16x16", "-frames:v", "1", file]);
    return readFileSync(file);
  } finally { rmSync(folder, { recursive: true, force: true }); }
}

describe("uploaded image inspection", () => {
  it("accepts valid JPEG and PNG bytes sent as raw browser file bodies", async () => {
    await expect(inspectMedia(image("jpg"), "image/jpeg")).resolves.toBeUndefined();
    await expect(inspectMedia(image("png"), "image/png")).resolves.toBeUndefined();
  });

  it("keeps corrupt content distinct from unavailable probe runtime", async () => {
    await expect(inspectMedia(Buffer.from("not a photo"), "image/jpeg"))
      .rejects.toMatchObject({ status: 400 });
    const log = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    try {
      await expect(inspectMedia(image("jpg"), "image/jpeg", "/nonexistent/avs-ffprobe"))
        .rejects.toMatchObject({ status: 503, message: "媒体识别服务不可用，请稍后再试" });
      expect(log).toHaveBeenCalledWith(expect.stringContaining("ffprobe unavailable"));
    } finally { log.mockRestore(); }
  });

  it("reports malformed probe output as a service failure", async () => {
    const folder = mkdtempSync(join(tmpdir(), "avs-bad-probe-"));
    try {
      const probe = join(folder, "ffprobe");
      writeFileSync(probe, "#!/bin/sh\nprintf 'not json'");
      chmodSync(probe, 0o755);
      const log = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
      try {
        await expect(inspectMedia(image("png"), "image/png", probe))
          .rejects.toMatchObject({ status: 503, message: "媒体识别服务不可用，请稍后再试" });
        expect(log).toHaveBeenCalledWith(expect.stringContaining("invalid JSON"));
      } finally { log.mockRestore(); }
    } finally { rmSync(folder, { recursive: true, force: true }); }
  });
});
