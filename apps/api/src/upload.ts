import { createHash, randomUUID } from "node:crypto";
import type { IncomingMessage } from "node:http";
import { mkdir, open, rm } from "node:fs/promises";
import { join } from "node:path";

export class UploadError extends Error {
  constructor(readonly status: number, message: string, readonly retryAfterSeconds?: number) { super(message); }
}

export class UploadGate {
  private active = 0;
  constructor(readonly maximum = 3) {}
  acquire(): () => void {
    if (this.active >= this.maximum) throw new UploadError(429, "上传服务繁忙，请稍后重试", 1);
    this.active++;
    let released = false;
    return () => { if (!released) { released = true; this.active--; } };
  }
  get count(): number { return this.active; }
}

export async function stageUpload(req: IncomingMessage, dataDir: string, limit: number, timeoutMs = 30_000) {
  const length = req.headers["content-length"];
  if (length !== undefined && (!/^\d+$/.test(length) || Number(length) > limit)) throw new UploadError(413, "上传内容超过大小限制");
  const temporary = join(dataDir, "temporary");
  await mkdir(temporary, { recursive: true });
  const path = join(temporary, `${randomUUID()}.upload`);
  const file = await open(path, "wx", 0o600);
  const hash = createHash("sha256");
  let size = 0;
  let timedOut = false;
  let saved = false;
  let closed = false;
  const timer = setTimeout(() => { timedOut = true; req.destroy(new Error("upload timeout")); }, timeoutMs);
  timer.unref();
  try {
    for await (const piece of req) {
      const bytes = Buffer.isBuffer(piece) ? piece : Buffer.from(piece);
      size += bytes.length;
      if (size > limit) throw new UploadError(413, "上传内容超过大小限制");
      hash.update(bytes);
      let offset = 0;
      while (offset < bytes.length) {
        const written = (await file.write(bytes, offset, bytes.length - offset)).bytesWritten;
        if (written < 1) throw new UploadError(503, "上传暂存失败");
        offset += written;
      }
    }
    if (!req.complete) throw new UploadError(400, "上传已中断");
    if (size === 0) throw new UploadError(400, "素材为空");
    await file.sync();
    await file.close();
    closed = true;
    saved = true;
    return { path, size, sha256: hash.digest("hex") };
  } catch (error) {
    if (timedOut) throw new UploadError(408, "上传超时");
    if (error instanceof UploadError) throw error;
    throw new UploadError(400, "上传已中断");
  } finally {
    clearTimeout(timer);
    if (!closed) await file.close().catch(() => {});
    if (!saved) await rm(path, { force: true });
  }
}
