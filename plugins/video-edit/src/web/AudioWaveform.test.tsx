import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { AudioWaveform, extractAudioPeaks, sampleClipPeaks } from "./AudioWaveform";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("real audio waveform", () => {
  it("uses decoded samples and selects only the retained source range", () => {
    const channel = Float32Array.from([0, 0.1, 0.8, 0.2, 0, 0.4, 0.2, 0]);
    const buffer = { numberOfChannels: 1, length: channel.length, getChannelData: () => channel } as unknown as AudioBuffer;
    expect(extractAudioPeaks(buffer, 4)).toEqual([0.125, 1, 0.5, 0.25]);
    expect(sampleClipPeaks([0.1, 0.8, 0.2, 0.4], 1000, 3000, 4000, 2)).toEqual([0.8, 0.2]);
  });

  it("draws peaks after decoding the actual audio asset", async () => {
    const channel = Float32Array.from([0, 0.2, 0.7, 0.1, 0, 0.3, 0.6, 0]);
    const decodeAudioData = vi.fn(async () => ({ numberOfChannels: 1, length: channel.length,
      getChannelData: () => channel } as unknown as AudioBuffer));
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new Uint8Array([1, 2, 3]))));
    vi.stubGlobal("AudioContext", class { decodeAudioData = decodeAudioData; close = async () => {}; });
    render(<AudioWaveform url="/test-real-audio-unique.wav" inMs={0} outMs={1000} durationMs={1000} />);
    expect(await screen.findByRole("img", { name: "真实音频波形" })).toBeTruthy();
    expect(document.querySelectorAll(".episode-editor-waveform line")).toHaveLength(96);
    expect(decodeAudioData).toHaveBeenCalledOnce();
  });
});
