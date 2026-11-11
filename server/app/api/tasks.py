"""任务 API（B 域生视频提交 + E 域任务中心 / 重试 FR-E-01/02）。"""

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.errors import AppError
from app.core.security import get_current_user
from app.models.entities import Clip, Script, Task, User
from app.services import quota, state_machine
from app.services.worker import QUOTA_COSTS, submit_task

router = APIRouter(prefix="/tasks", tags=["tasks"])

RETRY_FORBIDDEN = {"content_review_rejected"}


class TaskOut(BaseModel):
    id: str
    type: str
    state: str
    failCategory: str | None
    failDetail: str | None
    consumedQuota: float
    sourcePage: str | None
    params: dict
    result: dict
    createdAt: str
    finishedAt: str | None


class VideoGenIn(BaseModel):
    scriptId: str
    segmentIndex: int
    assetId: str
    prompt: str


@router.post("/video-gen", response_model=TaskOut)
def submit_video_gen(
    body: VideoGenIn,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> TaskOut:
    """逐段提交图生视频任务：额度预检 → 预扣 → 入队（FR-B-03）。"""
    script = db.get(Script, body.scriptId)
    if script is None or script.user_id != user.id:
        raise AppError("not_found", "讲稿不存在", 404)
    if not body.prompt.strip():
        raise AppError("empty_prompt", "该段落缺少提示词")

    cost = QUOTA_COSTS["video_gen"]
    quota.precheck(user, cost)  # 不足时 422 携带余额，前端禁用/拦截

    task = Task(
        user_id=user.id,
        type="video_gen",
        state="draft",
        params={
            "script_id": body.scriptId,
            "segment_index": body.segmentIndex,
            "asset_id": body.assetId,
            "prompt": body.prompt,
            "duration_sec": 8,
        },
        source_page="/generate",
    )
    db.add(task)
    db.flush()
    submit_task(db, task, cost)
    return _task_out(task)


@router.get("", response_model=list[TaskOut])
def list_tasks(
    type: str | None = Query(default=None),
    state: str | None = Query(default=None),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[TaskOut]:
    """任务中心列表：按类型/状态筛选，仅本人（FR-E-01）。"""
    q = db.query(Task).filter(Task.user_id == user.id)
    if type:
        q = q.filter(Task.type == type)
    if state:
        q = q.filter(Task.state == state)
    return [_task_out(t) for t in q.order_by(Task.created_at.desc()).limit(100).all()]


@router.post("/{task_id}/retry", response_model=TaskOut)
def retry_task(
    task_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> TaskOut:
    """失败重试：审核不通过禁止重试，其余重新预扣并入队（FR-E-02）。"""
    task = db.get(Task, task_id)
    if task is None or task.user_id != user.id:
        raise AppError("not_found", "任务不存在", 404)
    if task.state != "failed":
        raise AppError("invalid_state", "仅失败任务可重试", 409)
    if task.fail_category in RETRY_FORBIDDEN:
        raise AppError("retry_forbidden", "内容审核不通过的任务不可重试，请修改内容后重新提交", 409)
    if task.fail_category == "param_error":
        raise AppError("retry_forbidden", "参数错误需先修改内容再重新提交", 409)

    cost = QUOTA_COSTS[task.type]
    quota.precheck(user, cost)
    state_machine.transition(task, "submitted")
    # 重试重新扣费（失败时已退还）
    quota.deduct(db, user, cost, task.id, f"任务重试 {task.type}")
    task.consumed_quota = cost
    task.fail_category = None
    task.fail_detail = None
    task.finished_at = None
    db.flush()
    return _task_out(task)


@router.post("/{task_id}/void", response_model=TaskOut)
def void_task(
    task_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> TaskOut:
    """作废任务（草稿/失败态）。"""
    task = db.get(Task, task_id)
    if task is None or task.user_id != user.id:
        raise AppError("not_found", "任务不存在", 404)
    state_machine.transition(task, "voided")
    db.flush()
    return _task_out(task)


@router.delete("/clips/{clip_id}")
def delete_clip(
    clip_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict[str, bool]:
    """删除片段（FR-B-04）。"""
    clip = db.get(Clip, clip_id)
    if clip is None or clip.user_id != user.id:
        raise AppError("not_found", "片段不存在", 404)
    db.delete(clip)
    return {"ok": True}


def _task_out(t: Task) -> TaskOut:
    return TaskOut(
        id=t.id, type=t.type, state=t.state,
        failCategory=t.fail_category, failDetail=t.fail_detail,
        consumedQuota=t.consumed_quota, sourcePage=t.source_page,
        params=t.params or {}, result=t.result or {},
        createdAt=t.created_at.isoformat(),
        finishedAt=t.finished_at.isoformat() if t.finished_at else None,
    )
