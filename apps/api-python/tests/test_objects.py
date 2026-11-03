from pathlib import Path

import pytest

from ai_video_api.errors import ApiError
from ai_video_api.objects import get_object_response, parse_media_range, MediaRangeError


@pytest.mark.parametrize("header,expected", [
    (None, None), ("bytes=0-9", (0, 9)), ("bytes=95-", (95, 99)),
    ("bytes=-10", (90, 99)), ("bytes=-200", (0, 99)), ("bytes=95-200", (95, 99)),
])
def test_media_range_matches_node(header, expected):
    assert parse_media_range(header, 100) == expected


@pytest.mark.parametrize("header", ["bytes=", "bytes=-0", "bytes=10-5", "bytes=100-",
                                      "bytes=0-1,5-6", "items=0-1", "bytes=1.5-2"])
def test_media_range_rejects_invalid(header):
    with pytest.raises(MediaRangeError):
        parse_media_range(header, 100)


class FakeDb:
    def __init__(self, path: Path):
        self.path = path

    async def fetch_one(self, sql, *values):
        if values != ("object-123", "owner-1"):
            return None
        return {"mime": "video/mp4", "size": 100, "path": str(self.path)}


@pytest.mark.asyncio
async def test_object_stream_is_owner_scoped_and_range_exact(tmp_path: Path):
    path = tmp_path / "sample.mp4"
    path.write_bytes(bytes(range(100)))
    db = FakeDb(path)
    response = await get_object_response(db, "owner-1", "object-123", "bytes=10-19")
    chunks = [chunk async for chunk in response.body_iterator]
    assert response.status_code == 206
    assert response.headers["content-range"] == "bytes 10-19/100"
    assert b"".join(chunks) == bytes(range(10, 20))
    invalid = await get_object_response(db, "owner-1", "object-123", "bytes=200-")
    assert invalid.status_code == 416
    assert invalid.headers["content-range"] == "bytes */100"
    with pytest.raises(ApiError) as error:
        await get_object_response(db, "owner-2", "object-123", None)
    assert error.value.status == 404
