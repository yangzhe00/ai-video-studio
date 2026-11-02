import { accessSync, constants, statSync } from "node:fs";

export class MediaSourceUnavailableError extends Error {
  constructor(readonly kind: "visual" | "audio", readonly sourcePath: string) {
    super(kind === "visual"
      ? "画面素材丢失或无法读取，请恢复原素材或重新上传后重试"
      : "配音或音乐素材丢失或无法读取，请恢复原素材或重新上传后重试");
  }
}

/** File paths and media command output stay in server diagnostics, never in operation.error. */
export function assertReadableMediaSource(path: string, kind: "visual" | "audio"): void {
  try {
    accessSync(path, constants.R_OK);
    if (!statSync(path).isFile()) throw new Error("not a regular file");
  } catch { throw new MediaSourceUnavailableError(kind, path); }
}

export function publicMediaTaskError(error: unknown, action: "preview" | "export"): string {
  if (error instanceof MediaSourceUnavailableError) return error.message;
  const raw = error instanceof Error ? `${error.message}\n${(error as NodeJS.ErrnoException).code ?? ""}` : String(error);
  if (/ENOENT|EACCES|EPERM|No such file or directory|Permission denied/i.test(raw)) {
    return "素材丢失或无法读取，请恢复原素材或重新上传后重试";
  }
  return action === "preview"
    ? "精准预览失败，请检查素材后重试；若持续失败请联系支持"
    : "整集导出失败，请检查素材后重试；若持续失败请联系支持";
}

/** Older failed operations may already contain a raw command; sanitize them on every read. */
export function publicStoredMediaTaskError(error: string | null, action: "preview" | "export"): string | null {
  if (error === null) return null;
  const safe = new Set([
    "画面素材丢失或无法读取，请恢复原素材或重新上传后重试",
    "配音或音乐素材丢失或无法读取，请恢复原素材或重新上传后重试",
    "素材丢失或无法读取，请恢复原素材或重新上传后重试",
    "精准预览失败，请检查素材后重试；若持续失败请联系支持",
    "整集导出失败，请检查素材后重试；若持续失败请联系支持",
  ]);
  return safe.has(error) ? error : publicMediaTaskError(new Error(error), action);
}

export function logMediaTaskFailure(action: "preview" | "export", operationId: string, error: unknown): void {
  const detail = error instanceof Error ? error.stack ?? error.message : String(error);
  const source = error instanceof MediaSourceUnavailableError ? ` source=${error.sourcePath}` : "";
  process.stderr.write(`[${action}] operation ${operationId} failed:${source} ${detail}\n`);
}
