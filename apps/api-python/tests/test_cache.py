import pytest
from redis.asyncio import Redis

from ai_video_api.cache import ShortCache


@pytest.mark.asyncio
async def test_redis_failure_bypasses_read_cache():
    redis = Redis.from_url("redis://127.0.0.1:1/0", socket_connect_timeout=0.1)
    calls = 0

    async def load():
        nonlocal calls
        calls += 1
        return {"voices": ["voice-a"]}

    try:
        cache = ShortCache(redis)
        assert await cache.get_or_load("tts-voices:v1", 30, load) == {"voices": ["voice-a"]}
        assert calls == 1
    finally:
        await redis.aclose()
