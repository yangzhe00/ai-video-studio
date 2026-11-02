import { useEffect, useState } from "react";

const peakCache = new Map<string, Promise<number[]>>();

export function extractAudioPeaks(buffer: AudioBuffer, count = 512): number[] {
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, index) => buffer.getChannelData(index));
  const peaks = Array.from({ length: count }, (_, index) => {
    const from = Math.floor(index * buffer.length / count);
    const to = Math.max(from + 1, Math.floor((index + 1) * buffer.length / count));
    let peak = 0;
    for (const channel of channels) for (let sample = from; sample < to && sample < channel.length; sample++)
      peak = Math.max(peak, Math.abs(channel[sample]));
    return peak;
  });
  const maximum = Math.max(...peaks, 0.001);
  return peaks.map(peak => Math.min(1, peak / maximum));
}

export function sampleClipPeaks(peaks: number[], inMs: number, outMs: number, durationMs: number, count = 96): number[] {
  if (!peaks.length || durationMs <= 0) return [];
  const from = Math.max(0, Math.min(1, inMs / durationMs));
  const to = Math.max(from, Math.min(1, outMs / durationMs));
  return Array.from({ length: count }, (_, index) => {
    const start = Math.floor((from + (to - from) * index / count) * peaks.length);
    const end = Math.max(start + 1, Math.ceil((from + (to - from) * (index + 1) / count) * peaks.length));
    return Math.max(...peaks.slice(start, end), 0);
  });
}

async function loadPeaks(url: string): Promise<number[]> {
  const existing = peakCache.get(url);
  if (existing) return existing;
  const task = (async () => {
    const response = await fetch(url, { credentials: "include" });
    if (!response.ok) throw new Error(`音频读取失败：${response.status}`);
    const bytes = await response.arrayBuffer();
    const Context = window.AudioContext ?? (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Context) throw new Error("当前环境不支持音频解码");
    const context = new Context();
    try { return extractAudioPeaks(await context.decodeAudioData(bytes)); }
    finally { await context.close(); }
  })();
  peakCache.set(url, task);
  void task.catch(() => peakCache.delete(url));
  return task;
}

/** Decode the real audio asset once; never draw decorative peaks for an undecodable file. */
export function AudioWaveform({ url, inMs, outMs, durationMs }: { url?: string; inMs: number; outMs: number; durationMs: number }) {
  const [peaks, setPeaks] = useState<number[] | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let live = true;
    setPeaks(null); setError(false);
    if (!url) { setError(true); return; }
    void loadPeaks(url).then(value => { if (live) setPeaks(value); }).catch(() => { if (live) setError(true); });
    return () => { live = false; };
  }, [url]);
  if (error) return <span className="episode-editor-waveform-unavailable" title="波形不可用，请检查音频素材">波形不可用</span>;
  if (!peaks) return <span className="episode-editor-waveform-loading" role="status">读取波形…</span>;
  const bars = sampleClipPeaks(peaks, inMs, outMs, durationMs);
  return <svg className="episode-editor-waveform" viewBox="0 0 96 28" preserveAspectRatio="none" role="img" aria-label="真实音频波形">
    {bars.map((value, index) => <line key={index} x1={index + 0.5} x2={index + 0.5}
      y1={14 - Math.max(1, value * 12)} y2={14 + Math.max(1, value * 12)} />)}
  </svg>;
}
