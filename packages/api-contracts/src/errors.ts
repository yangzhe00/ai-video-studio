import { z } from "zod";

export const ApiErrorCodeSchema = z.enum([
  "invalid_request", "unauthorized", "forbidden", "not_found", "conflict",
  "quota_exceeded", "rate_limited", "unsupported_media", "method_not_allowed",
  "service_unavailable", "provider_error", "billing_unavailable", "task_uncertain", "internal_error",
]);
export type ApiErrorCode = z.infer<typeof ApiErrorCodeSchema>;

/** `code` is optional on the wire so clients can still read older API releases. */
export const ApiErrorEnvelopeSchema = z.object({
  error: z.string().min(1), code: ApiErrorCodeSchema.optional(), conflict: z.unknown().optional(),
}).passthrough();
export type ApiErrorEnvelope = z.infer<typeof ApiErrorEnvelopeSchema>;

export function errorCodeForStatus(status: number): ApiErrorCode {
  switch (status) {
    case 400: case 413: return "invalid_request";
    case 401: return "unauthorized";
    case 403: return "forbidden";
    case 404: return "not_found";
    case 405: return "method_not_allowed";
    case 409: return "conflict";
    case 415: return "unsupported_media";
    case 429: return "rate_limited";
    case 503: return "service_unavailable";
    default: return status >= 500 ? "internal_error" : "invalid_request";
  }
}

export function makeApiError(status: number, message: string, conflict?: unknown, code?: ApiErrorCode): ApiErrorEnvelope {
  return { error: message, code: code ?? errorCodeForStatus(status), ...(conflict === undefined ? {} : { conflict }) };
}

export function parseApiError(raw: unknown, status: number): ApiErrorEnvelope & { code: ApiErrorCode } {
  const parsed = ApiErrorEnvelopeSchema.safeParse(raw);
  if (!parsed.success) return makeApiError(status, `请求失败：${status}`) as ApiErrorEnvelope & { code: ApiErrorCode };
  return { ...parsed.data, code: parsed.data.code ?? errorCodeForStatus(status) };
}
