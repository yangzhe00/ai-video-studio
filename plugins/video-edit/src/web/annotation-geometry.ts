export interface Rect { left: number; top: number; width: number; height: number }
export interface Point { x: number; y: number }

export function containedVideoRect(container: Rect, videoWidth: number, videoHeight: number): Rect {
  if (videoWidth <= 0 || videoHeight <= 0 || container.width <= 0 || container.height <= 0)
    return { left: 0, top: 0, width: 0, height: 0 };
  const scale = Math.min(container.width / videoWidth, container.height / videoHeight);
  const width = videoWidth * scale, height = videoHeight * scale;
  return { left: (container.width - width) / 2, top: (container.height - height) / 2, width, height };
}

export function normalizedPoint(clientX: number, clientY: number, content: Rect): Point {
  const clamp = (value: number) => Math.max(0, Math.min(1, value));
  return { x: clamp((clientX - content.left) / content.width), y: clamp((clientY - content.top) / content.height) };
}

export function normalizedBox(start: Point, end: Point) {
  return { x: Math.min(start.x, end.x), y: Math.min(start.y, end.y),
    width: Math.abs(start.x - end.x), height: Math.abs(start.y - end.y) };
}
