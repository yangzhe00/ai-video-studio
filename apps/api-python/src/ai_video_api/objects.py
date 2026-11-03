from __future__ import annotations

import asyncio
import re
from pathlib import Path
from typing import AsyncIterator

from fastapi.responses import StreamingResponse

from ai_video_api.db import Database
from ai_video_api.errors import ApiError, error_response

_RANGE = re.compile(r"^bytes=([0-9]*)-([0-9]*)$")
_SUFFIX = {"image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "video/mp4": "mp4",
           "audio/mpeg": "mp3", "audio/wav": "wav", "audio/x-wav": "wav", "audio/mp4": "m4a"}


class MediaRangeError(Exception):
    pass


def parse_media_range(header: str | None, size: int) -> tuple[int, int] | None:
    if header is None:
        return None
    if size < 0:
        raise ValueError("Invalid media size")
    match = _RANGE.fullmatch(header)
    if match is None or size == 0 or not any(match.groups()):
        raise MediaRangeError("请求范围无效")
    first, second = match.groups()
    if not first:
        suffix = int(second)
        if suffix == 0 or suffix > 2**53 - 1:
            raise MediaRangeError("请求范围无效")
        return max(0, size - suffix), size - 1
    start = int(first)
    requested_end = int(second) if second else size - 1
    if start > 2**53 - 1 or requested_end > 2**53 - 1 or start >= size or requested_end < start:
        raise MediaRangeError("请求范围无效")
    return start, min(requested_end, size - 1)


async def _read_file(path: Path, start: int, end: int) -> AsyncIterator[bytes]:
    with path.open("rb") as stream:
        stream.seek(start)
        remaining = end - start + 1
        while remaining > 0:
            chunk = await asyncio.to_thread(stream.read, min(1024 * 1024, remaining))
            if not chunk:
                break
            remaining -= len(chunk)
            yield chunk


async def get_object_response(db: Database, account_id: str, object_id: str,
                              range_header: str | None):
    row = await db.fetch_one("SELECT mime,size,path FROM objects WHERE id=%s AND owner_id=%s", object_id, account_id)
    if row is None:
        raise ApiError(404, "素材不存在")
    size = row["size"]
    try:
        byte_range = parse_media_range(range_header, size)
    except MediaRangeError as error:
        response = error_response(ApiError(416, str(error)))
        response.headers["Content-Range"] = f"bytes */{size}"
        return response
    path = Path(row["path"])
    if not path.is_file():
        raise ApiError(410, "素材文件已失效")
    start, end = byte_range if byte_range is not None else (0, size - 1)
    suffix = _SUFFIX.get(row["mime"], "bin")
    headers = {
        "Content-Length": str(end - start + 1 if byte_range else size),
        "Accept-Ranges": "bytes", "Cache-Control": "private, max-age=60",
        "Content-Disposition": f'inline; filename="asset-{object_id}.{suffix}"',
        "X-Content-Type-Options": "nosniff",
    }
    if byte_range is not None:
        headers["Content-Range"] = f"bytes {start}-{end}/{size}"
    return StreamingResponse(_read_file(path, start, end), media_type=row["mime"],
                             status_code=206 if byte_range else 200, headers=headers)
