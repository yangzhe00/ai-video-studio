import { resolve } from "node:path";

export interface ApiConfig {
  dataDir: string;
  sessionSecret: string;
  port?: number;
  secureCookies?: boolean;
  demoQuota?: number;
  maxUploadBytes?: number;
  allowedOrigin?: string;
  klingApiKey?: string;
  klingBaseUrl?: string;
  workerEnabled?: boolean;
}

export function configFromEnv(): ApiConfig {
  const dataDir = process.env.API_DATA_DIR;
  const sessionSecret = process.env.API_SESSION_SECRET;
  if (!dataDir || !sessionSecret || sessionSecret.length < 32) {
    throw new Error("API_DATA_DIR and API_SESSION_SECRET (at least 32 characters) are required");
  }
  return {
    dataDir: resolve(dataDir), sessionSecret,
    port: Number(process.env.PORT || 8787),
    secureCookies: process.env.API_SECURE_COOKIES !== "false",
    allowedOrigin: process.env.API_ALLOWED_ORIGIN,
    demoQuota: Number(process.env.API_DEMO_QUOTA || 3),
    maxUploadBytes: Number(process.env.API_MAX_UPLOAD_BYTES || 20_000_000),
    klingApiKey: process.env.KLING_API_KEY,
    klingBaseUrl: process.env.KLING_BASE_URL || "https://api-beijing.klingai.com",
    workerEnabled: true,
  };
}
