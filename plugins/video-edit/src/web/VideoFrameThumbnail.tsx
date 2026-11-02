import { useEffect, useState } from "react";

const frameCache = new Map<string, string>();

/** Captures a frame from the clip's actual video asset; never substitutes a stock image. */
export function VideoFrameThumbnail({ url, atMs }: { url?: string; atMs: number }) {
  const key = url ? `${url}@${atMs}` : "";
  const [frame, setFrame] = useState(() => frameCache.get(key) ?? "");

  useEffect(() => {
    const cached = frameCache.get(key);
    setFrame(cached ?? "");
    if (!url || cached) return;
    let live = true;
    const video = document.createElement("video");
    video.preload = "auto";
    video.muted = true;
    video.playsInline = true;
    const capture = () => {
      const target = Math.min(Math.max(0, atMs / 1000), Math.max(0, video.duration - 0.05));
      if (!live || video.readyState < 2 || !video.videoWidth || Math.abs(video.currentTime - target) > 0.08) return;
      try {
        const canvas = document.createElement("canvas");
        const scale = Math.min(1, 320 / video.videoWidth);
        canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
        canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
        const context = canvas.getContext("2d");
        if (!context) return;
        context.drawImage(video, 0, 0, canvas.width, canvas.height);
        const image = canvas.toDataURL("image/jpeg", 0.72);
        if (!image || image === "data:,") return;
        if (frameCache.size >= 80) frameCache.delete(frameCache.keys().next().value!);
        frameCache.set(key, image);
        setFrame(image);
      } catch { /* The actual video remains available even if canvas capture is disallowed. */ }
    };
    const seekFrame = () => {
      const target = Math.min(Math.max(0, atMs / 1000), Math.max(0, video.duration - 0.05));
      if (Math.abs(video.currentTime - target) < 0.08) capture();
      else video.currentTime = target;
    };
    video.addEventListener("loadedmetadata", seekFrame);
    video.addEventListener("loadeddata", capture);
    video.addEventListener("seeked", capture);
    video.src = url;
    return () => {
      live = false;
      video.removeEventListener("loadedmetadata", seekFrame);
      video.removeEventListener("loadeddata", capture);
      video.removeEventListener("seeked", capture);
      video.pause(); video.removeAttribute("src");
    };
  }, [key, url, atMs]);

  return frame ? <img className="episode-editor-frame" src={frame} alt="视频真实缩略帧" />
    : <span className="episode-editor-frame-fallback" aria-hidden="true">▶</span>;
}
