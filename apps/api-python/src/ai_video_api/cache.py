from __future__ import annotations

import hashlib
import json
from collections.abc import Awaitable, Callable
from typing import TypeVar

from redis.asyncio import Redis
from redis.exceptions import RedisError

T = TypeVar("T")


class ShortCache:
    """Best-effort cache for explicitly safe, rebuildable directory data."""

    def __init__(self, redis: Redis):
        self.redis = redis

    async def get_or_load(self, key: str, ttl_seconds: int, load: Callable[[], Awaitable[T]]) -> T:
        if ttl_seconds < 1 or ttl_seconds > 300:
            raise ValueError("Short cache TTL must be between 1 and 300 seconds")
        redis_key = "avs:cache:" + hashlib.sha256(key.encode()).hexdigest()
        try:
            raw = await self.redis.get(redis_key)
            if raw is not None:
                return json.loads(raw)
        except (RedisError, json.JSONDecodeError):
            pass
        result = await load()
        try:
            await self.redis.set(redis_key, json.dumps(result, ensure_ascii=False), ex=ttl_seconds)
        except (RedisError, TypeError):
            pass
        return result
