/** The lane's viewport rect already includes horizontal scrolling and zoom. */
export function rulerTimeAtX(clientX: number, laneLeft: number, pixelsPerSecond: number, durationMs: number): number {
  if (!Number.isFinite(pixelsPerSecond) || pixelsPerSecond <= 0) return 0;
  const raw = (clientX - laneLeft) / pixelsPerSecond * 1000;
  return Math.max(0, Math.min(durationMs, Math.round(raw / 100) * 100));
}

export function fitTimelineZoom(durationMs: number, visibleWidth: number, basePixelsPerSecond = 76): number {
  if (durationMs <= 0 || visibleWidth <= 0) return 1;
  const zoom = (visibleWidth - 116) / (durationMs / 1000 * basePixelsPerSecond);
  return Math.max(0.25, Math.min(2.5, Math.round(zoom * 100) / 100));
}
