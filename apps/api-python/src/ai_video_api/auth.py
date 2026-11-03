from __future__ import annotations

import base64
import hashlib
import hmac
import os
import re
import secrets
import time
from typing import Any

from ai_video_api.db import Database
from ai_video_api.errors import ApiError


EMAIL_PATTERN = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")
SESSION_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000


def normalize_email(value: object) -> str:
    if not isinstance(value, str):
        raise ApiError(400, "邮箱格式无效")
    email = value.strip().lower()
    if len(email) > 254 or not EMAIL_PATTERN.fullmatch(email):
        raise ApiError(400, "邮箱格式无效")
    return email


def validate_password(value: object) -> str:
    if not isinstance(value, str) or not 10 <= len(value) <= 128:
        raise ApiError(400, "密码长度需为 10 到 128 个字符")
    return value


def hash_password(password: str) -> str:
    salt = secrets.token_hex(16)
    derived = hashlib.scrypt(password.encode(), salt=salt.encode(), n=16384, r=8, p=1, dklen=64)
    return f"{salt}:{derived.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        salt, encoded = stored.split(":", 1)
        expected = bytes.fromhex(encoded)
        if not salt or len(expected) != 64:
            return False
        actual = hashlib.scrypt(password.encode(), salt=salt.encode(), n=16384, r=8, p=1, dklen=64)
        return hmac.compare_digest(actual, expected)
    except (ValueError, TypeError):
        return False


def digest_session(session_id: str, secret: str) -> str:
    return hmac.new(secret.encode(), session_id.encode(), hashlib.sha256).hexdigest()


def session_token(cookie_header: str | None, cookie_name: str = "avs_session") -> str | None:
    for part in (cookie_header or "").split(";"):
        item = part.strip()
        prefix = f"{cookie_name}="
        if item.startswith(prefix):
            return item[len(prefix):]
    return None


async def create_session(db: Database, account_id: str, secret: str) -> tuple[str, int]:
    token = base64.urlsafe_b64encode(os.urandom(32)).rstrip(b"=").decode()
    expires = int(time.time() * 1000) + SESSION_LIFETIME_MS
    await db.execute("INSERT INTO sessions (id, account_id, expires_at) VALUES (%s, %s, %s)",
                     digest_session(token, secret), account_id, expires)
    return token, expires


async def session_account(db: Database, cookie_header: str | None, secret: str, cookie_name: str = "avs_session") -> str | None:
    token = session_token(cookie_header, cookie_name)
    if not token:
        return None
    row = await db.fetch_one("SELECT account_id FROM sessions WHERE id = %s AND expires_at > %s",
                             digest_session(token, secret), int(time.time() * 1000))
    return row["account_id"] if row else None


async def clear_session(db: Database, cookie_header: str | None, secret: str, cookie_name: str = "avs_session") -> None:
    token = session_token(cookie_header, cookie_name)
    if token:
        await db.execute("DELETE FROM sessions WHERE id = %s", digest_session(token, secret))
