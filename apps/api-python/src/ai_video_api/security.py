from __future__ import annotations

import ipaddress

from fastapi import Request

from ai_video_api.errors import ApiError
from ai_video_api.settings import Settings

STATE_CHANGING = frozenset({"POST", "PUT", "PATCH", "DELETE"})
ALLOWED_METHODS = frozenset({"GET", *STATE_CHANGING})


def check_request_security(request: Request, settings: Settings) -> bool:
    """Return True for a valid preflight; otherwise validate the request."""
    origin = request.headers.get("origin")
    if origin and origin != settings.allowed_origin:
        raise ApiError(403, "来源不允许")
    if request.headers.get("sec-fetch-site") == "cross-site":
        raise ApiError(403, "跨站请求不允许")
    if request.method == "OPTIONS":
        if not origin or origin != settings.allowed_origin or request.headers.get("access-control-request-method") not in ALLOWED_METHODS:
            raise ApiError(403, "预检请求不允许")
        return True
    if request.method in STATE_CHANGING and request.headers.get("x-avs-request") != "1":
        raise ApiError(403, "请求安全标识无效")
    return False


def client_ip(request: Request, trusted_proxy_ips: tuple[str, ...]) -> str:
    peer = request.client.host if request.client else "unknown"
    try:
        address = ipaddress.ip_address(peer)
        if isinstance(address, ipaddress.IPv6Address) and address.ipv4_mapped:
            peer = str(address.ipv4_mapped)
    except ValueError:
        pass
    if peer not in trusted_proxy_ips:
        return peer
    forwarded = request.headers.get("x-real-ip")
    if forwarded:
        try:
            return str(ipaddress.ip_address(forwarded))
        except ValueError:
            pass
    return peer
