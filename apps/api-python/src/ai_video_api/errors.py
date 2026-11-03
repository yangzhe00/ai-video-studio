from __future__ import annotations

from fastapi.responses import JSONResponse


ERROR_CODES = {
    400: "invalid_request", 401: "unauthorized", 403: "forbidden",
    404: "not_found", 405: "method_not_allowed", 409: "conflict",
    413: "invalid_request", 415: "unsupported_media", 429: "rate_limited",
    503: "service_unavailable",
}


class ApiError(Exception):
    def __init__(self, status: int, message: str, *, code: str | None = None,
                 conflict: object | None = None, retry_after_seconds: int | None = None):
        super().__init__(message)
        self.status = status
        self.code = code or ERROR_CODES.get(status, "internal_error" if status >= 500 else "invalid_request")
        self.conflict = conflict
        self.retry_after_seconds = retry_after_seconds


def error_response(error: ApiError) -> JSONResponse:
    body: dict[str, object] = {"error": str(error), "code": error.code}
    if error.conflict is not None:
        body["conflict"] = error.conflict
    headers = {"Cache-Control": "no-store"}
    if error.retry_after_seconds is not None:
        headers["Retry-After"] = str(error.retry_after_seconds)
    return JSONResponse(body, status_code=error.status, headers=headers)
