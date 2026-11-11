"""素材 API（B 域：上传 FR-B-02 / 站内生图 FR-B-01）。"""

import os
import uuid

from fastapi import APIRouter, Depends, File, UploadFile
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.db import get_db
from app.core.errors import AppError
from app.core.security import get_current_user
from app.models.entities import Asset, Task, User
from app.providers import registry
from app.services.worker import QUOTA_COSTS, submit_task

router = APIRouter(prefix="/assets", tags=["assets"])

ALLOWED = set(settings.asset_mime_types)


class AssetOut(BaseModel):
    id: str
    source: str
    url: str
    mimeType: str
    sizeBytes: int
    createdAt: str


class GenerateImageIn(BaseModel):
    prompt: str


@router.post("/upload", response_model=list[AssetOut])
async def upload_assets(
    files: list[UploadFile] = File(...),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[AssetOut]:
    """批量上传图片：格式与大小校验（20MB / jpg,png,webp）。"""
    storage = registry.get_storage_provider()
    out: list[AssetOut] = []
    for f in files:
        if f.content_type not in ALLOWED:
            raise AppError("unsupported_type", f"不支持的格式: {f.content_type}（仅 jpg/png/webp）")
        data = await f.read()
        if len(data) > settings.asset_max_size_mb * 1024 * 1024:
            raise AppError("file_too_large", f"文件超过 {settings.asset_max_size_mb}MB 限制")

        ext = os.path.splitext(f.filename or "x.jpg")[1] or ".jpg"
        key = f"assets/{uuid.uuid4().hex}{ext}"
        storage.save(key, data, f.content_type or "image/jpeg")
        asset = Asset(
            user_id=user.id, source="upload", path=key,
            mime_type=f.content_type or "image/jpeg", size_bytes=len(data),
        )
        db.add(asset)
        db.flush()
        out.append(_asset_out(asset))
    return out


@router.post("/generate", response_model=dict)
def generate_image(
    body: GenerateImageIn,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    """站内 AI 生图：创建异步任务并预扣额度，返回任务 ID 供轮询。"""
    if not body.prompt.strip():
        raise AppError("empty_prompt", "请输入画面描述")
    task = Task(
        user_id=user.id, type="image_gen", state="draft",
        params={"prompt": body.prompt}, source_page="/assets",
    )
    db.add(task)
    db.flush()
    submit_task(db, task, QUOTA_COSTS["image_gen"])
    return {"taskId": task.id}


@router.get("", response_model=list[AssetOut])
def list_assets(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[AssetOut]:
    """素材库列表（仅本人，倒序）。"""
    rows = (
        db.query(Asset)
        .filter(Asset.user_id == user.id)
        .order_by(Asset.created_at.desc())
        .limit(100)
        .all()
    )
    return [_asset_out(a) for a in rows]


def _asset_out(a: Asset) -> AssetOut:
    return AssetOut(
        id=a.id, source=a.source, url=f"/api/files/{a.path}",
        mimeType=a.mime_type, sizeBytes=a.size_bytes, createdAt=a.created_at.isoformat(),
    )
