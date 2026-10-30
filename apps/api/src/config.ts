import { resolve } from "node:path";
import { parseTtsVoices, type TtsVoice } from "./tts-voices.ts";

export interface ApiConfig {
  dataDir: string;
  databaseUrl: string;
  sessionSecret: string;
  port?: number;
  secureCookies?: boolean;
  demoQuota?: number;
  maxUploadBytes?: number;
  uploadTimeoutMs?: number;
  maxConcurrentUploads?: number;
  maxAccountObjects?: number;
  maxAccountStorageBytes?: number;
  maxTotalStorageBytes?: number;
  maxTotalDemoCredits?: number;
  allowedOrigin?: string;
  trustedProxyIps?: string[];
  authLoginAccountLimit?: number;
  klingApiKey?: string;
  klingBaseUrl?: string;
  klingTtsApiKey?: string;
  klingTtsBaseUrl?: string;
  klingTtsVoices?: TtsVoice[];
  agentEditModelBaseUrl?: string;
  agentEditModelApiKey?: string;
  agentEditModelId?: string;
  ideaModelBaseUrl?: string;
  ideaModelApiKey?: string;
  ideaModelId?: string;
  ideaProvider?: "chat" | "agents" | "cursor";
  ideaAgentApiKey?: string;
  ideaAgentModel?: string;
  ideaAgentBaseUrl?: string;
  ideaCursorApiKey?: string;
  ideaCursorModel?: string;
  ideaCursorBaseUrl?: string;
  ideaModelTimeoutMs?: number;
  ideaDailyLimit?: number;
  ideaPlatformDailyLimit?: number;
  workerEnabled?: boolean;
}

export function configFromEnv(): ApiConfig {
  const dataDir = process.env.API_DATA_DIR;
  const sessionSecret = process.env.API_SESSION_SECRET;
  const databaseUrl = process.env.DATABASE_URL;
  if (!dataDir || !databaseUrl || !sessionSecret || sessionSecret.length < 32) {
    throw new Error("API_DATA_DIR, DATABASE_URL and API_SESSION_SECRET (at least 32 characters) are required");
  }
  const ideaProvider = process.env.IDEA_PROVIDER ?? "chat";
  if (ideaProvider !== "chat" && ideaProvider !== "agents" && ideaProvider !== "cursor") {
    throw new Error("IDEA_PROVIDER must be chat, agents, or cursor");
  }
  const positiveInt = (key: string, fallback: number): number => {
    const raw = process.env[key];
    const value = raw === undefined ? fallback : Number(raw);
    if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${key} must be a positive integer`);
    return value;
  };
  return {
    dataDir: resolve(dataDir), databaseUrl, sessionSecret,
    port: Number(process.env.PORT || 8787),
    secureCookies: process.env.API_SECURE_COOKIES !== "false",
    allowedOrigin: process.env.API_ALLOWED_ORIGIN,
    trustedProxyIps: process.env.API_TRUSTED_PROXY_IPS?.split(",").map(value => value.trim()).filter(Boolean) ?? [],
    demoQuota: positiveInt("API_DEMO_QUOTA", 3),
    maxUploadBytes: positiveInt("API_MAX_UPLOAD_BYTES", 20_000_000),
    uploadTimeoutMs: positiveInt("API_UPLOAD_TIMEOUT_MS", 30_000),
    maxConcurrentUploads: positiveInt("API_MAX_CONCURRENT_UPLOADS", 3),
    maxAccountObjects: positiveInt("API_MAX_ACCOUNT_OBJECTS", 100),
    maxAccountStorageBytes: positiveInt("API_MAX_ACCOUNT_STORAGE_BYTES", 200_000_000),
    maxTotalStorageBytes: positiveInt("API_MAX_TOTAL_STORAGE_BYTES", 2_000_000_000),
    maxTotalDemoCredits: positiveInt("API_MAX_TOTAL_DEMO_CREDITS", 30),
    klingApiKey: process.env.KLING_API_KEY,
    klingBaseUrl: process.env.KLING_BASE_URL || "https://api-beijing.klingai.com",
    klingTtsApiKey: process.env.KLING_TTS_API_KEY,
    klingTtsBaseUrl: process.env.KLING_TTS_BASE_URL || "https://api-singapore.klingai.com",
    klingTtsVoices: parseTtsVoices(process.env.KLING_TTS_VOICES_JSON),
    agentEditModelBaseUrl: process.env.AGENT_EDIT_MODEL_BASE_URL,
    agentEditModelApiKey: process.env.AGENT_EDIT_MODEL_API_KEY,
    agentEditModelId: process.env.AGENT_EDIT_MODEL_ID,
    ideaModelBaseUrl: process.env.IDEA_MODEL_BASE_URL,
    ideaModelApiKey: process.env.IDEA_MODEL_API_KEY,
    ideaModelId: process.env.IDEA_MODEL_ID,
    ideaProvider,
    ideaAgentApiKey: process.env.OPENAI_API_KEY,
    ideaAgentModel: process.env.IDEA_AGENT_MODEL,
    ideaCursorApiKey: process.env.CURSOR_API_KEY,
    ideaCursorModel: process.env.IDEA_CURSOR_MODEL,
    ideaModelTimeoutMs: positiveInt("IDEA_MODEL_TIMEOUT_MS", 30_000),
    ideaDailyLimit: positiveInt("IDEA_DAILY_LIMIT", 20),
    ideaPlatformDailyLimit: positiveInt("IDEA_PLATFORM_DAILY_LIMIT", 200),
    workerEnabled: true,
  };
}
