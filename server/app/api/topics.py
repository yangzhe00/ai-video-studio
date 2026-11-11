"""选题与讲稿 API（A 域：FR-A-01~04）。"""

import json

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.db import get_db
from app.core.errors import AppError
from app.core.security import get_current_user
from app.models.entities import Script, Topic, User
from app.providers import registry

router = APIRouter(tags=["topics"])


class TopicOut(BaseModel):
    id: str
    keyword: str
    title: str
    angle: str
    status: str
    createdAt: str


class GenerateIn(BaseModel):
    keyword: str = Field(min_length=1, max_length=50)


class SegmentOut(BaseModel):
    index: int
    text: str
    prompt: str = ""
    assetId: str | None = None
    clipId: str | None = None


class ScriptOut(BaseModel):
    id: str
    topicId: str
    segments: list[SegmentOut]
    updatedAt: str


class SaveScriptIn(BaseModel):
    segments: list[SegmentOut]


def _topic_out(t: Topic) -> TopicOut:
    return TopicOut(
        id=t.id, keyword=t.keyword, title=t.title, angle=t.angle, status=t.status,
        createdAt=t.created_at.isoformat(),
    )


def _script_out(s: Script) -> ScriptOut:
    segs = [SegmentOut(**seg) for seg in s.segments]
    return ScriptOut(id=s.id, topicId=s.topic_id, segments=segs, updatedAt=s.updated_at.isoformat())


@router.post("/topics/generate", response_model=list[TopicOut])
def generate_topics(
    body: GenerateIn,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[TopicOut]:
    """关键词生成 5 条选题并落库为草稿（FR-A-01，数值取配置）。"""
    llm = registry.get_llm_provider()
    try:
        raw = llm.complete("", task_kind="topics", keyword=body.keyword, count=settings.topic_count)
        payload = json.loads(raw)["topics"][: settings.topic_count]
    except Exception as exc:  # LLM 不可用不阻断 B/C/D 域（PRD 降级登记）
        raise AppError("llm_unavailable", f"选题生成失败：{exc}", 503) from exc
    if not payload:
        raise AppError("llm_unavailable", "选题生成失败：模型未返回选题", 503)

    topics: list[Topic] = []
    for item in payload:
        t = Topic(user_id=user.id, keyword=body.keyword, title=item["title"], angle=item["angle"])
        db.add(t)
        topics.append(t)
    db.flush()
    return [_topic_out(t) for t in topics]


@router.get("/topics", response_model=list[TopicOut])
def list_topics(
    status: str | None = None,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[TopicOut]:
    """选题/草稿列表（仅本人）。"""
    q = db.query(Topic).filter(Topic.user_id == user.id)
    if status:
        q = q.filter(Topic.status == status)
    return [_topic_out(t) for t in q.order_by(Topic.created_at.desc()).limit(50).all()]


@router.post("/topics/{topic_id}/select", response_model=TopicOut)
def select_topic(
    topic_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> TopicOut:
    """选为我的选题。"""
    t = db.get(Topic, topic_id)
    if t is None or t.user_id != user.id:
        raise AppError("not_found", "选题不存在", 404)
    t.status = "selected"
    db.flush()
    return _topic_out(t)


@router.delete("/topics/{topic_id}")
def delete_topic(
    topic_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict[str, bool]:
    """删除选题（草稿清理，FR-A-04）。"""
    t = db.get(Topic, topic_id)
    if t is None or t.user_id != user.id:
        raise AppError("not_found", "选题不存在", 404)
    db.query(Script).filter(Script.topic_id == topic_id).delete()
    db.delete(t)
    return {"ok": True}


@router.post("/topics/{topic_id}/script", response_model=ScriptOut)
def generate_script(
    topic_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ScriptOut:
    """生成讲稿（分段，FR-A-02）；已有讲稿则覆盖（前端已确认防覆盖）。"""
    t = db.get(Topic, topic_id)
    if t is None or t.user_id != user.id:
        raise AppError("not_found", "选题不存在", 404)

    llm = registry.get_llm_provider()
    try:
        raw = llm.complete("", task_kind="script", title=t.title, segments=5)
        segs = [
            {"index": i, "text": s["text"], "prompt": "", "assetId": None, "clipId": None}
            for i, s in enumerate(json.loads(raw)["segments"])
        ]
    except Exception as exc:
        raise AppError("llm_unavailable", f"讲稿生成失败：{exc}", 503) from exc
    if not segs:
        raise AppError("llm_unavailable", "讲稿生成失败：模型未返回分段", 503)

    script = db.query(Script).filter(Script.topic_id == topic_id, Script.user_id == user.id).first()
    if script is None:
        script = Script(user_id=user.id, topic_id=topic_id, segments=segs)
        db.add(script)
    else:
        script.segments = segs
        # 解除 jsonb 变更检测依赖：显式标记
        from sqlalchemy.orm.attributes import flag_modified

        flag_modified(script, "segments")
    t.status = "selected"
    db.flush()
    return _script_out(script)


@router.get("/scripts", response_model=ScriptOut)
def get_script(
    topic_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ScriptOut:
    """按选题取讲稿（不存在 404，前端引导先生成）。"""
    script = db.query(Script).filter(Script.topic_id == topic_id, Script.user_id == user.id).first()
    if script is None:
        raise AppError("not_found", "讲稿不存在，请先生成讲稿", 404)
    return _script_out(script)


@router.patch("/scripts/{script_id}", response_model=ScriptOut)
def save_script(
    script_id: str,
    body: SaveScriptIn,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ScriptOut:
    """保存讲稿编辑（分段文本/提示词/素材关联，FR-A-02）。"""
    script = db.get(Script, script_id)
    if script is None or script.user_id != user.id:
        raise AppError("not_found", "讲稿不存在", 404)
    script.segments = [seg.model_dump() for seg in body.segments]
    from sqlalchemy.orm.attributes import flag_modified

    flag_modified(script, "segments")
    db.flush()
    return _script_out(script)


@router.post("/scripts/{script_id}/prompts", response_model=ScriptOut)
def generate_prompts(
    script_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ScriptOut:
    """讲稿段落 → 分镜提示词（FR-A-03）。"""
    script = db.get(Script, script_id)
    if script is None or script.user_id != user.id:
        raise AppError("not_found", "讲稿不存在", 404)

    llm = registry.get_llm_provider()
    texts = [seg["text"] for seg in script.segments]
    try:
        raw = llm.complete("", task_kind="prompts", segments_text=texts)
        prompts = {p["index"]: p["prompt"] for p in json.loads(raw)["prompts"]}
    except Exception as exc:
        raise AppError("llm_unavailable", f"分镜提示词生成失败：{exc}", 503) from exc

    segs = list(script.segments)
    for seg in segs:
        seg["prompt"] = prompts.get(seg["index"], seg.get("prompt", ""))
    script.segments = segs
    from sqlalchemy.orm.attributes import flag_modified

    flag_modified(script, "segments")
    db.flush()
    return _script_out(script)
