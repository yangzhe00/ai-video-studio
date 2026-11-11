"""文件服务 API：按存储 key 读取本地文件（演示用 token 查询参数鉴权）。"""

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import FileResponse

from app.providers.mock.storage import LocalStorageProvider

router = APIRouter(prefix="/files", tags=["files"])


@router.get("/{key:path}")
def get_file(key: str, token: str | None = Query(default=None)) -> FileResponse:
    """返回本地文件（图片/视频/音频）。

    说明：<video>/<img> 无法携带 Authorization 头，故支持 ?token= 形式；
    演示环境按不可猜测 key 隔离，生产应改为签名 URL。
    """
    _ = token  # 鉴权由 key 不可猜测性兜底（演示）；接入签名 URL 时在此校验
    storage = LocalStorageProvider()
    path = storage.local_path(key)
    try:
        return FileResponse(path)
    except (FileNotFoundError, OSError) as err:
        raise HTTPException(404, "文件不存在") from err
