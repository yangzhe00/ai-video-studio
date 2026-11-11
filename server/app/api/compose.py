"""合成 API（C 域模板/配音/字幕/合成 + D 域成片与版本）。"""

import json

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.errors import AppError
from app.core.security import get_current_user
from app.models.entities import Clip, Composition, Script, Task, Template, Topic, User
from app.services.worker import QUOTA_COSTS, submit_task

router = APIRouter(tags=["compose"])


class TemplateOut(BaseModel):
    id: str
    name: str
    style: dict


class TtsIn(BaseModel):
    scriptId: str
    voice: str = "female_warm"


class CheckOut(BaseModel):
    missing: list[str]
    ready: bool


class ComposeIn(BaseModel):
    scriptId: str
    templateId: str


class CompositionOut(BaseModel):
    id: str
    topicId: str
    topicTitle: str
    versionNo: int
    status: str
    videoUrl: str | None
    createdAt: str


@router.get("/templates", response_model=list[TemplateOut])
def list_templates(
    _: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[TemplateOut]:
    """内置模板列表（后端预置，无编辑界面 FR-C-01）。"""
    rows = db.query(Template).filter(Template.enabled.is_(True)).all()
    return [TemplateOut(id=t.id, name=t.name, style=t.style) for t in rows]


@router.post("/compose/tts")
def generate_tts(
    body: TtsIn,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    """为讲稿每段创建 TTS 配音任务（可试听，FR-C-02）。"""
    script = db.get(Script, body.scriptId)
    if script is None or script.user_id != user.id:
        raise AppError("not_found", "讲稿不存在", 404)

    task_ids: list[str] = []
    for seg in script.segments:
        task = Task(
            user_id=user.id,
            type="tts",
            state="draft",
            params={
                "script_id": script.id,
                "segment_index": seg["index"],
                "text": seg["text"],
                "voice": body.voice,
            },
            source_page="/compose",
        )
        db.add(task)
        db.flush()
        submit_task(db, task, QUOTA_COSTS["tts"])
        task_ids.append(task.id)
    return {"taskIds": task_ids}


@router.get("/compose/check", response_model=CheckOut)
def check_compose(
    script_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> CheckOut:
    """合成前要素校验：逐段检查片段与配音，明确列出缺什么（FR-C-04）。"""
    script = db.get(Script, script_id)
    if script is None or script.user_id != user.id:
        raise AppError("not_found", "讲稿不存在", 404)

    missing: list[str] = []
    for seg in script.segments:
        idx = seg["index"]
        has_clip = _latest_clip(db, user.id, script.id, idx) is not None
        has_audio = _latest_audio(db, user.id, script.id, idx) is not None
        if not has_clip:
            missing.append(f"第 {idx + 1} 段缺少视频片段")
        if not has_audio:
            missing.append(f"第 {idx + 1} 段缺少配音")
    return CheckOut(missing=missing, ready=not missing)


@router.post("/compose", response_model=dict)
def submit_compose(
    body: ComposeIn,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    """提交合成任务：要素缺失禁止提交，并按选题累计版本号（FR-C-04 / D-02）。"""
    script = db.get(Script, body.scriptId)
    if script is None or script.user_id != user.id:
        raise AppError("not_found", "讲稿不存在", 404)
    template = db.get(Template, body.templateId)
    if template is None:
        raise AppError("not_found", "模板不存在", 404)

    check = check_compose(body.scriptId, user, db)
    if not check.ready:
        raise AppError("missing_elements", "；".join(check.missing), 422)

    clip_keys: list[str] = []
    audio_keys: list[str] = []
    subtitles: list[str] = []
    for seg in script.segments:
        clip = _latest_clip(db, user.id, script.id, seg["index"])
        audio = _latest_audio(db, user.id, script.id, seg["index"])
        clip_keys.append(clip.video_path if clip else "")
        audio_keys.append(str(audio.result.get("audio_key", "")) if audio else "")
        subtitles.append(seg["text"])

    version_no = db.query(Composition).filter(Composition.topic_id == script.topic_id).count() + 1
    comp = Composition(
        user_id=user.id, topic_id=script.topic_id, task_id=None, template_id=template.id,
        version_no=version_no, status="submitted",
    )
    db.add(comp)
    db.flush()

    task = Task(
        user_id=user.id,
        type="compose",
        state="draft",
        params={
            "clip_keys": clip_keys,
            "audio_keys": audio_keys,
            "subtitles": subtitles,
            "output_key": f"outputs/{comp.id}.mp4",
            "composition_id": comp.id,
        },
        source_page="/compose",
    )
    db.add(task)
    db.flush()
    comp.task_id = task.id
    submit_task(db, task, QUOTA_COSTS["compose"])

    _trim_versions(db, script.topic_id)
    return {"taskId": task.id, "compositionId": comp.id, "versionNo": version_no}


@router.get("/compositions", response_model=list[CompositionOut])
def list_compositions(
    topic_id: str | None = None,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[CompositionOut]:
    """成片/版本历史列表（仅本人）。"""
    q = db.query(Composition).filter(Composition.user_id == user.id)
    if topic_id:
        q = q.filter(Composition.topic_id == topic_id)
    rows = q.order_by(Composition.created_at.desc()).limit(50).all()

    out: list[CompositionOut] = []
    for c in rows:
        task = db.get(Task, c.task_id) if c.task_id else None
        topic = db.get(Topic, c.topic_id)
        video_url = None
        if task is not None and task.state == "success" and task.result.get("output_key"):
            video_url = f"/api/files/{task.result['output_key']}"
        out.append(
            CompositionOut(
                id=c.id, topicId=c.topic_id,
                topicTitle=topic.title if topic else "未命名选题",
                versionNo=c.version_no, status=task.state if task else c.status,
                videoUrl=video_url, createdAt=c.created_at.isoformat(),
            )
        )
    return out


@router.delete("/compositions/{comp_id}")
def delete_composition(
    comp_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict[str, bool]:
    """删除成片版本（FR-D-02）。"""
    c = db.get(Composition, comp_id)
    if c is None or c.user_id != user.id:
        raise AppError("not_found", "成片不存在", 404)
    db.delete(c)
    return {"ok": True}


@router.get("/clips")
def list_clips(
    script_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[dict]:
    """按讲稿聚合各段最新片段（生成任务页/合成页共用）。"""
    script = db.get(Script, script_id)
    if script is None or script.user_id != user.id:
        raise AppError("not_found", "讲稿不存在", 404)
    out: list[dict] = []
    for seg in script.segments:
        clip = _latest_clip(db, user.id, script.id, seg["index"])
        out.append(
            {
                "segmentIndex": seg["index"],
                "clipId": clip.id if clip else None,
                "videoUrl": f"/api/files/{clip.video_path}" if clip else None,
                "durationSec": clip.duration_sec if clip else 0,
            }
        )
    return out


def _latest_clip(db: Session, user_id: str, script_id: str, segment_index: int) -> Clip | None:
    """该段最新成功片段（关联任务参数判定）。"""
    tasks = (
        db.query(Task)
        .filter(Task.user_id == user_id, Task.type == "video_gen", Task.state == "success")
        .order_by(Task.created_at.desc())
        .all()
    )
    for t in tasks:
        if t.params.get("script_id") == script_id and int(t.params.get("segment_index", -1)) == segment_index:
            clip = db.query(Clip).filter(Clip.task_id == t.id).first()
            if clip is not None:
                return clip
    return None


def _latest_audio(db: Session, user_id: str, script_id: str, segment_index: int) -> Task | None:
    """该段最新成功 TTS 任务（含音频产物）。"""
    tasks = (
        db.query(Task)
        .filter(Task.user_id == user_id, Task.type == "tts", Task.state == "success")
        .order_by(Task.created_at.desc())
        .all()
    )
    for t in tasks:
        if (
            t.params.get("script_id") == script_id
            and int(t.params.get("segment_index", -1)) == segment_index
            and t.result.get("audio_key")
        ):
            return t
    return None


def _trim_versions(db: Session, topic_id: str) -> None:
    """版本保留最近 10 版（CONFIG.maxVersionsPerTopic）。"""
    from app.core.config import settings

    rows = (
        db.query(Composition)
        .filter(Composition.topic_id == topic_id)
        .order_by(Composition.created_at.desc())
        .all()
    )
    for old in rows[settings.max_versions_per_topic :]:
        db.delete(old)
