// Shared presentation contracts have no browser or native renderer dependency.
export type SurfaceState = "empty" | "loading" | "failed" | "unknown";

export interface StudioResult {
  id: string;
  title: string;
  durationSec: number;
  videoUrl?: string;
  status: "succeeded" | "loading" | "failed" | "unknown";
  taskId?: string;
  description?: string;
}
