import { afterEach, describe, expect, it, vi } from "vitest";
import { resumeMediaOperation } from "./media-operation";
import type { EpisodeMediaOperation } from "./media-operation";

afterEach(() => { localStorage.clear(); vi.restoreAllMocks(); });

describe("episode media operation recovery", () => {
  it("stores the server replay ID after a failed preview is retried", async () => {
    const key = "preview-replay";
    localStorage.setItem(key, "requested-old-id");
    const create = vi.fn(async (_id: string) => ({ id: "server-existing-id", state: "pending" as const }));
    const result = await resumeMediaOperation<EpisodeMediaOperation>(localStorage, key,
      async () => ({ id: "requested-old-id", state: "failed" as const }), create, () => false);
    expect(create).toHaveBeenCalledWith("requested-old-id");
    expect(result.id).toBe("server-existing-id");
    expect(localStorage.getItem(key)).toBe("server-existing-id");
  });

  it("clears a missing old ID and records the real ID returned by the new request", async () => {
    const key = "preview-gone";
    localStorage.setItem(key, "stale-old-id");
    const create = vi.fn(async (_id: string) => ({ id: "server-replayed-id", state: "pending" as const }));
    await resumeMediaOperation(localStorage, key,
      async () => { throw new Error("404"); }, create, cause => String(cause).includes("404"));
    expect(create).toHaveBeenCalledOnce();
    expect(create.mock.calls[0][0]).not.toBe("stale-old-id");
    expect(localStorage.getItem(key)).toBe("server-replayed-id");
  });

  it("preserves an unknown request ID and does not resubmit after a transient lookup failure", async () => {
    const key = "render-unknown";
    const create = vi.fn(async () => { throw new Error("network lost after POST"); });
    await expect(resumeMediaOperation(localStorage, key, async () => { throw new Error("unused"); }, create, () => false))
      .rejects.toThrow(/network lost/);
    const requested = localStorage.getItem(key);
    expect(requested).toMatch(/^[a-zA-Z0-9-]{8,80}$/);
    const lookup = vi.fn(async () => ({ id: requested!, state: "running" as const }));
    await resumeMediaOperation(localStorage, key, lookup, create, () => false);
    expect(lookup).toHaveBeenCalledWith(requested);
    expect(create).toHaveBeenCalledOnce();
    await expect(resumeMediaOperation(localStorage, key, async () => { throw new Error("temporary network failure"); }, create, () => false))
      .rejects.toThrow(/temporary network/);
    expect(localStorage.getItem(key)).toBe(requested);
    expect(create).toHaveBeenCalledOnce();
  });
});
