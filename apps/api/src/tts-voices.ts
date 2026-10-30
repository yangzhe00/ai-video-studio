import type { ApiConfig } from "./config.ts";

export interface TtsVoice { id: string; label: string; language: "zh" | "en" }

/** The English ID is from Kling's public TTS request example. Extra IDs require operator verification. */
const documentedVoice: TtsVoice = { id: "oversea_male1", label: "英文男声", language: "en" };

export function parseTtsVoices(raw: string | undefined): TtsVoice[] {
  if (!raw) return [documentedVoice];
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { throw new Error("KLING_TTS_VOICES_JSON must be valid JSON"); }
  if (!Array.isArray(parsed) || parsed.length > 100 || parsed.some(item =>
    !item || typeof item !== "object" || !/^[a-zA-Z0-9_-]{1,80}$/.test(item.id) ||
    typeof item.label !== "string" || !item.label.trim() || item.label.length > 80 ||
    !["zh", "en"].includes(item.language))) {
    throw new Error("KLING_TTS_VOICES_JSON contains invalid voice records");
  }
  const voices = parsed as TtsVoice[];
  if (new Set(voices.map(voice => voice.id)).size !== voices.length) throw new Error("KLING_TTS_VOICES_JSON has duplicate voice IDs");
  return voices;
}

export function ttsVoices(config: ApiConfig): TtsVoice[] {
  return config.klingTtsVoices ?? [documentedVoice];
}
