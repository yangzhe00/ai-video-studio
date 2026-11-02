export class MediaRangeError extends Error {
  constructor() { super("请求范围无效"); }
}

/** Parse one HTTP byte range. Multiple ranges are deliberately unsupported. */
export function parseMediaRange(header: string | undefined, size: number): { start: number; end: number } | null {
  if (header === undefined) return null;
  if (!Number.isSafeInteger(size) || size < 0) throw new Error("Invalid media size");
  const match = /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!match || size === 0 || (!match[1] && !match[2])) throw new MediaRangeError();

  if (!match[1]) {
    const suffix = Number(match[2]);
    if (!Number.isSafeInteger(suffix) || suffix === 0) throw new MediaRangeError();
    return { start: Math.max(0, size - suffix), end: size - 1 };
  }

  const start = Number(match[1]);
  const requestedEnd = match[2] ? Number(match[2]) : size - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(requestedEnd) || start >= size || requestedEnd < start) {
    throw new MediaRangeError();
  }
  return { start, end: Math.min(requestedEnd, size - 1) };
}
