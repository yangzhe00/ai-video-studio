import os
import uuid

import pytest
from redis.asyncio import Redis

from ai_video_api.errors import ApiError
from ai_video_api.limits import RedisRateLimiter


@pytest.mark.asyncio
async def test_two_instances_share_a_single_bucket():
    url = os.environ.get("REDIS_TEST_URL")
    if not url:
        pytest.skip("REDIS_TEST_URL is required for real Redis integration")
    redis = Redis.from_url(url)
    key = f"test:{uuid.uuid4()}"
    first, second = RedisRateLimiter(redis), RedisRateLimiter(redis)
    try:
        await first.check(key, 2, 10_000)
        await second.check(key, 2, 10_000)
        with pytest.raises(ApiError) as caught:
            await first.check(key, 2, 10_000)
        assert caught.value.status == 429
        assert 1 <= caught.value.retry_after_seconds <= 10
        assert await redis.pttl(first.redis_key(key)) > 0
    finally:
        await redis.delete(first.redis_key(key))
        await redis.aclose()


@pytest.mark.asyncio
async def test_redis_unavailable_blocks_protected_operation():
    redis = Redis.from_url("redis://127.0.0.1:1/0", socket_connect_timeout=0.1)
    try:
        with pytest.raises(ApiError) as caught:
            await RedisRateLimiter(redis).check("test", 2)
        assert caught.value.status == 503
    finally:
        await redis.aclose()
