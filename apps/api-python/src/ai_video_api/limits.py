from __future__ import annotations

import hashlib
import math

from redis.asyncio import Redis
from redis.exceptions import RedisError

from ai_video_api.errors import ApiError


# The counter and expiry are one indivisible operation, so no unbounded key can
# survive a crash between INCR and PEXPIRE.
_RATE_SCRIPT = """
local count = redis.call('INCR', KEYS[1])
if count == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
return {count, redis.call('PTTL', KEYS[1])}
"""


class RedisRateLimiter:
    def __init__(self, redis: Redis):
        self.redis = redis

    @staticmethod
    def redis_key(key: str) -> str:
        return "avs:rate:" + hashlib.sha256(key.encode()).hexdigest()

    async def check(self, key: str, limit: int, window_ms: int = 60_000) -> None:
        if limit < 1 or window_ms < 1:
            raise ValueError("limit and window_ms must be positive")
        try:
            count, ttl = await self.redis.eval(_RATE_SCRIPT, 1, self.redis_key(key), window_ms)
        except RedisError as error:
            raise ApiError(503, "限流服务暂不可用，请稍后重试") from error
        if count > limit:
            raise ApiError(429, "请求过于频繁，请稍后再试", retry_after_seconds=max(1, math.ceil(ttl / 1000)))
