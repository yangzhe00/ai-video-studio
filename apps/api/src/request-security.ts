import type { IncomingMessage, ServerResponse } from "node:http";
import { AVS_REQUEST_HEADER_NAME, AVS_REQUEST_HEADER_VALUE } from "@ai-video/api-contracts";
import type { ApiConfig } from "./config.ts";

export class RequestSecurityError extends Error {
  readonly status = 403;
}

const stateChanging = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const allowedMethods = new Set(["GET", ...stateChanging]);

export function validateSecurityConfig(config: ApiConfig): void {
  if (config.allowedOrigin) {
    const url = new URL(config.allowedOrigin);
    if (!(["http:", "https:"].includes(url.protocol)) || url.origin !== config.allowedOrigin || url.username || url.password) {
      throw new Error("API_ALLOWED_ORIGIN must be an exact HTTP origin");
    }
  }
  if (process.env.NODE_ENV === "production") {
    if (!config.allowedOrigin || !config.allowedOrigin.startsWith("https://") || config.secureCookies !== true) {
      throw new Error("Production API requires HTTPS API_ALLOWED_ORIGIN and Secure cookies");
    }
  }
}

export function checkRequestSecurity(req: IncomingMessage, res: ServerResponse, config: ApiConfig): boolean {
  const method = req.method ?? "GET";
  // Error responses must also vary by Origin; never emit permissive CORS headers for a rejected origin.
  res.setHeader("vary", "Origin, Sec-Fetch-Site");
  const origin = req.headers.origin;
  if (origin && origin !== config.allowedOrigin) throw new RequestSecurityError("来源不允许");
  if (req.headers["sec-fetch-site"] === "cross-site") throw new RequestSecurityError("跨站请求不允许");
  if (origin) {
    res.setHeader("access-control-allow-origin", origin);
    res.setHeader("access-control-allow-credentials", "true");
  }
  if (method === "OPTIONS") {
    if (!origin || !config.allowedOrigin || origin !== config.allowedOrigin ||
      !allowedMethods.has(String(req.headers["access-control-request-method"] ?? ""))) {
      throw new RequestSecurityError("预检请求不允许");
    }
    res.writeHead(204, {
      "access-control-allow-methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
      "access-control-allow-headers": "content-type, x-avs-request",
      "access-control-max-age": "600",
    });
    res.end();
    return true;
  }
  if (stateChanging.has(method) && req.headers[AVS_REQUEST_HEADER_NAME.toLowerCase()] !== AVS_REQUEST_HEADER_VALUE) {
    throw new RequestSecurityError("请求安全标识无效");
  }
  return false;
}
