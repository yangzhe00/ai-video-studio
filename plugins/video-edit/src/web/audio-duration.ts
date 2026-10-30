/** Read playback duration for a voice asset; the server still validates its real media content. */
export function readAudioDuration(url: string, timeoutMs = 15_000): Promise<number> {
  return new Promise((resolve, reject) => {
    const audio = document.createElement("audio");
    let finished = false;
    const finish = (value?: number, error?: Error) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      audio.removeEventListener("loadedmetadata", inspect);
      audio.removeEventListener("durationchange", inspect);
      audio.removeEventListener("error", failed);
      audio.removeAttribute("src");
      audio.load();
      if (error) reject(error);
      else resolve(value!);
    };
    const inspect = () => {
      if (Number.isFinite(audio.duration) && audio.duration > 0) finish(Math.round(audio.duration * 1000));
    };
    const failed = () => finish(undefined, new Error("录音无法试听或读取时长"));
    const timer = setTimeout(() => finish(undefined, new Error("读取录音时长超时，请重试")), timeoutMs);
    audio.addEventListener("loadedmetadata", inspect);
    audio.addEventListener("durationchange", inspect);
    audio.addEventListener("error", failed);
    audio.preload = "metadata";
    audio.src = url;
    audio.load();
  });
}
