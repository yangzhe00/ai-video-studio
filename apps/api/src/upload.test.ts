import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import type { IncomingMessage } from "node:http";
import { stageUpload, UploadError, UploadGate } from "./upload.ts";

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
function source(length?: string) {
  const stream = new PassThrough() as PassThrough & IncomingMessage;
  stream.headers = length ? { "content-length": length } : {};
  stream.complete = false;
  return stream;
}
function directory() {
  const dir = mkdtempSync(join(tmpdir(), "avs-upload-security-"));
  dirs.push(dir);
  return dir;
}

describe("streamed upload boundary", () => {
  it("rejects declared and streamed over-limit uploads without leaving staged files", async () => {
    const dir = directory();
    await expect(stageUpload(source("100"), dir, 2)).rejects.toMatchObject({ status: 413 });
    const req = source();
    const pending = stageUpload(req, dir, 2);
    req.write("abc"); req.complete = true; req.end();
    await expect(pending).rejects.toMatchObject({ status: 413 });
    expect(readdirSync(join(dir, "temporary"))).toEqual([]);
  });

  it("times out an incomplete upload, cleans its file and releases an occupied slot", async () => {
    const dir = directory();
    const gate = new UploadGate(1);
    const release = gate.acquire();
    expect(() => gate.acquire()).toThrow(UploadError);
    const req = source();
    await expect(stageUpload(req, dir, 100, 20)).rejects.toMatchObject({ status: 408 });
    expect(readdirSync(join(dir, "temporary"))).toEqual([]);
    release();
    expect(gate.count).toBe(0);
    gate.acquire()();
  });
});
