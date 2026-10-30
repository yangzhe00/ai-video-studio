import { describe, expect, it, vi } from "vitest";
import { loadRelease, parseRelease, releaseUrl } from "./release";

const valid = {
  version: "0.2.1-beta.2",
  platform: "macos-arm64",
  filename: "AI-Video-Studio-0.2.1-beta.2-macos-arm64.dmg",
  bytes: 4_194_304,
  sha256: "a".repeat(64),
  publishedAt: "2026-10-30T12:00:00Z",
} as const;

function manifest(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
}
function asset(bytes: number = valid.bytes, status = 200, type = "application/x-apple-diskimage") {
  return new Response(null, { status, headers: { "content-type": type, "content-length": String(bytes) } });
}

describe("release manifest", () => {
  it("accepts an exact immutable Apple Silicon file and normalizes its hash", () => {
    const release = parseRelease({ ...valid, sha256: "A".repeat(64) });
    expect(release?.sha256).toBe("a".repeat(64));
    expect(release && releaseUrl(release)).toBe("/downloads/AI-Video-Studio-0.2.1-beta.2-macos-arm64.dmg");
  });
  it.each([
    { ...valid, platform: "macos-x64" },
    { ...valid, filename: "../secret.dmg" },
    { ...valid, filename: "/downloads/AI-Video-Studio-0.2.1-beta.2-macos-arm64.dmg" },
    { ...valid, sha256: "bad" },
    { ...valid, bytes: -1 },
    { ...valid, version: "0.2.1/../../evil" },
    { ...valid, publishedAt: "yesterday" },
    { ...valid, filename: undefined },
  ])("rejects invalid or incomplete entries", (entry) => {
    expect(parseRelease(entry)).toBeNull();
  });
  it("requires both a valid JSON manifest and a matching accessible DMG", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(manifest(valid)).mockResolvedValueOnce(asset());
    expect(await loadRelease("/downloads/latest.json", fetcher)).toEqual(valid);
    expect(fetcher).toHaveBeenNthCalledWith(2, releaseUrl(valid), { method: "HEAD", cache: "no-store", redirect: "error" });
  });
  it.each([
    ["missing manifest", () => [manifest({}, 404)]],
    ["bad manifest", () => [manifest({ ...valid, sha256: "bad" })]],
    ["missing DMG", () => [manifest(valid), asset(valid.bytes, 404)]],
    ["HTML fallback", () => [manifest(valid), asset(valid.bytes, 200, "text/html")]],
    ["wrong size", () => [manifest(valid), asset(20)]],
  ])("disables the link for %s", async (_, responses) => {
    const queue = responses();
    const fetcher = vi.fn().mockImplementation(async () => queue.shift());
    expect(await loadRelease("/downloads/latest.json", fetcher)).toBeNull();
  });
  it("disables the link when fetch fails", async () => {
    expect(await loadRelease("/downloads/latest.json", vi.fn().mockRejectedValue(new Error("offline")))).toBeNull();
  });
});
