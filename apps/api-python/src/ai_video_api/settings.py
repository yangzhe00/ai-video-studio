from __future__ import annotations

import ipaddress
import os
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Mapping
from urllib.parse import urlsplit


@dataclass(frozen=True)
class Settings:
    database_url: str
    redis_url: str
    data_dir: Path
    session_secret: str
    allowed_origin: str | None
    secure_cookies: bool
    cookie_name: str
    cookie_path: str
    trusted_proxy_ips: tuple[str, ...]
    demo_quota: int
    auth_login_account_limit: int
    port: int
    environment: str

    @classmethod
    def from_env(cls, source: Mapping[str, str] | None = None) -> Settings:
        env = os.environ if source is None else source
        for key in ("DATABASE_URL", "REDIS_URL", "API_DATA_DIR", "API_SESSION_SECRET"):
            if not env.get(key):
                raise ValueError(f"{key} is required")
        secret = env["API_SESSION_SECRET"]
        if len(secret) < 32:
            raise ValueError("API_SESSION_SECRET must contain at least 32 characters")
        origin = env.get("API_ALLOWED_ORIGIN") or None
        if origin:
            parsed = urlsplit(origin)
            if parsed.scheme not in ("http", "https") or not parsed.hostname or parsed.username or parsed.password or parsed.path or parsed.query or parsed.fragment or f"{parsed.scheme}://{parsed.netloc}" != origin:
                raise ValueError("API_ALLOWED_ORIGIN must be an exact HTTP origin")
        environment = env.get("API_ENV", "development")
        secure = env.get("API_SECURE_COOKIES", "true") != "false"
        if environment == "production":
            if not origin or not origin.startswith("https://"):
                raise ValueError("Production requires HTTPS API_ALLOWED_ORIGIN")
            if not secure:
                raise ValueError("Production requires Secure cookies")
        cookie_name = env.get("API_COOKIE_NAME", "avs_session")
        cookie_path = env.get("API_COOKIE_PATH", "/")
        if not re.fullmatch(r"[A-Za-z0-9_-]{1,64}", cookie_name):
            raise ValueError("API_COOKIE_NAME is invalid")
        if not re.fullmatch(r"/[A-Za-z0-9/_-]*", cookie_path):
            raise ValueError("API_COOKIE_PATH is invalid")
        proxy_ips = tuple(part.strip() for part in env.get("API_TRUSTED_PROXY_IPS", "").split(",") if part.strip())
        for address in proxy_ips:
            ipaddress.ip_address(address)
        def positive(key: str, fallback: int) -> int:
            value = int(env.get(key, fallback))
            if value < 1:
                raise ValueError(f"{key} must be positive")
            return value
        return cls(
            database_url=env["DATABASE_URL"], redis_url=env["REDIS_URL"],
            data_dir=Path(env["API_DATA_DIR"]).resolve(), session_secret=secret,
            allowed_origin=origin, secure_cookies=secure, cookie_name=cookie_name, cookie_path=cookie_path, trusted_proxy_ips=proxy_ips,
            demo_quota=positive("API_DEMO_QUOTA", 3),
            auth_login_account_limit=positive("API_AUTH_LOGIN_ACCOUNT_LIMIT", 10),
            port=positive("PORT", 8787), environment=environment,
        )
