"""任务执行 worker：asyncio 后台轮询，统一驱动异步任务状态机。

每个任务生命周期：
submitted → queued → (provider submit) running → (poll) success/failed
成功后按类型落结果：生图→Asset、生视频→Clip、TTS→segments 音频、合成→Composition。
Mock Provider 约 2 次轮询（轮询间隔 1s）后落定，演示等待可控。
"""

import asyncio
import traceback

from app.core.db import SessionLocal
from app.core.errors import AppError
from app.models.entities import Asset, Clip, Composition, Task
from app.providers import registry
from app.services import quota, state_machine

POLL_INTERVAL_SEC = 1.0
# 真实供应商单次生成通常 1-3 分钟，轮询过快无意义且浪费请求
REMOTE_POLL_INTERVAL_SEC = 3.0

# 任务类型消耗额度（演示固定值，真实接入后按供应商计费替换）
QUOTA_COSTS = {"image_gen": 5, "video_gen": 20, "tts": 2, "compose": 10}

_running: bool = False


def _make_placeholder_clip_video(task: Task, result: dict) -> str:
    """Mock 片段视频：生成 9:16 纯色占位 mp4（ffmpeg），返回存储 key。"""
    from app.services.compose import make_placeholder_video

    duration = float(result.get("duration_sec", 8))
    return make_placeholder_video(duration)


async def execute_task(task_id: str) -> None:
    """执行单个任务（独立 DB 会话，后台线程安全）。"""
    db = SessionLocal()
    try:
        task = db.get(Task, task_id)
        if task is None:
            return

        provider = _provider_for(task.type) if task.type != "compose" else None

        if provider is None:
            # 合成任务：本地 ffmpeg 直执行（不走供应商）
            state_machine.transition(task, "queued")
            db.commit()
            state_machine.transition(task, "running")
            db.commit()
            try:
                from app.services.compose import compose_video

                params = task.params
                output_key = compose_video(
                    clips=list(params.get("clip_keys", [])),
                    audios=list(params.get("audio_keys", [])),
                    output_key=str(params.get("output_key", f"outputs/{task.id}.mp4")),
                    subtitle_texts=params.get("subtitles"),
                )
            except Exception as exc:
                state_machine.transition(task, "failed")
                task.fail_category = "provider_fault"
                task.fail_detail = str(exc)
                db.commit()
                return
            state_machine.transition(task, "success")
            task.result = {"output_key": output_key}
            if task.params.get("composition_id"):
                comp = db.get(Composition, task.params["composition_id"])
                if comp is not None:
                    comp.status = "success"
                    comp.output_path = output_key
            db.commit()
            return

        # queued → 提交供应商
        state_machine.transition(task, "queued")
        provider_task_id = provider.submit(dict(task.params))
        task.provider_task_id = provider_task_id
        db.commit()

        # running → 轮询至落定
        state_machine.transition(task, "running")
        if task.started_at is None:
            from app.models.entities import utcnow

            task.started_at = utcnow()
        db.commit()

        final = await _poll_until_done(provider, provider_task_id, task)
        if final.state == "failed":
            state_machine.transition(task, "failed")
            task.fail_category = final.fail_category
            task.fail_detail = final.fail_detail
            # 失败退还额度（审核不通过不自动重试但仍退额度，FR-E-02）
            quota.grant(db, _user(db, task), task.consumed_quota, f"任务失败退还 {task.id}")
            db.commit()
            return

        # 成功落结果
        result = provider.result(provider_task_id)
        _persist_result(db, task, result)
        state_machine.transition(task, "success")
        task.finished_at = task.finished_at or _now()
        db.commit()
    except AppError:
        db.rollback()
        task = db.get(Task, task_id)
        if task:
            state_machine.transition(task, "failed")
            task.fail_category = "param_error"
            task.fail_detail = traceback.format_exc(limit=1)
            db.commit()
    except Exception as exc:  # 供应商故障兜底
        db.rollback()
        task = db.get(Task, task_id)
        if task:
            state_machine.transition(task, "failed")
            task.fail_category = "provider_fault"
            task.fail_detail = str(exc)
            db.commit()
    finally:
        db.close()


def _provider_for(task_type: str):
    """按任务类型取 Provider。"""
    if task_type == "video_gen":
        return registry.get_video_gen_provider()
    if task_type == "image_gen":
        return registry.get_image_gen_provider()
    if task_type == "tts":
        return registry.get_tts_provider()
    raise AppError("unknown_task_type", f"未知任务类型 {task_type}")


async def _poll_until_done(provider, provider_task_id: str, task: Task):
    """轮询供应商直到落定；超时标记失败（超时阈值见 shared CONFIG 对应服务端常量）。"""
    from app.core.config import settings

    timeout_sec = settings.video_gen_timeout_sec if task.type == "video_gen" else settings.compose_timeout_sec
    interval = REMOTE_POLL_INTERVAL_SEC if getattr(provider, "name", "") == "kling" else POLL_INTERVAL_SEC
    elapsed = 0.0
    while True:
        state = provider.query(provider_task_id)
        if state.state in ("success", "failed"):
            return state
        await asyncio.sleep(interval)
        elapsed += interval
        if elapsed >= timeout_sec:
            from app.providers.base import ProviderState

            return ProviderState(state="failed", fail_category="timeout", fail_detail="生成超时")


def _persist_result(db, task: Task, result: dict) -> None:
    """按任务类型持久化产物（Mock 产物落真实占位文件，保证前端可预览）。"""
    if task.type == "video_gen":
        # 真实供应商（可灵）已把 mp4 落到存储；Mock 才生成占位黑场视频
        real_key = str(result.get("video_key") or "")
        video_key = real_key if real_key and not real_key.startswith("mock://") else _make_placeholder_clip_video(task, result)
        clip = Clip(
            user_id=task.user_id,
            task_id=task.id,
            segment_index=int(task.params.get("segment_index", 0)),
            video_path=video_key,
            duration_sec=float(result.get("duration_sec", 8)),
        )
        db.add(clip)
        db.flush()
        task.result = {"clip_id": clip.id, "video_key": video_key}
    elif task.type == "image_gen":
        from app.services.compose import make_placeholder_image

        key = make_placeholder_image(str(task.params.get("prompt", "")))
        asset = Asset(
            user_id=task.user_id,
            source="generated",
            path=key,
            mime_type="image/png",
            size_bytes=0,
        )
        db.add(asset)
        db.flush()
        task.result = {"asset_id": asset.id, "image_key": key}
    elif task.type == "tts":
        from app.services.compose import make_placeholder_audio

        duration = float(result.get("duration_sec", 5))
        key = make_placeholder_audio(duration)
        task.result = {"audio_key": key, "duration_sec": duration}


def _user(db, task: Task):
    from app.models.entities import User

    return db.get(User, task.user_id)


def _now():
    from app.models.entities import utcnow

    return utcnow()


async def worker_loop() -> None:
    """后台 worker：扫描 submitted 任务并执行（演示单机进程内队列）。"""
    global _running
    _running = True
    while _running:
        db = SessionLocal()
        try:
            pending = (
                db.query(Task)
                .filter(Task.state == "submitted")
                .order_by(Task.created_at)
                .limit(10)
                .all()
            )
            task_ids = [t.id for t in pending]
        finally:
            db.close()

        for tid in task_ids:
            await execute_task(tid)
        await asyncio.sleep(0.5)


def start_worker(app) -> None:
    """FastAPI startup 钩子：启动 worker 协程。"""
    app.state.worker = asyncio.create_task(worker_loop())


def stop_worker(app) -> None:
    """FastAPI shutdown 钩子：停止 worker。"""
    _running = False
    task = getattr(app.state, "worker", None)
    if task:
        task.cancel()


def submit_task(db, task: Task, cost: float) -> None:
    """任务提交统一入口：额度预检 → 扣减 → 状态 draft/submitted → queued。

    失败重试走同一路径（state failed → submitted 由 API 层设置）。
    """
    from app.core.security import ensure_owner  # noqa: F401 行级隔离在 API 层完成

    user = _user(db, task)
    quota.precheck(user, cost)
    quota.deduct(db, user, cost, task.id, f"任务提交预扣 {task.type}")
    task.consumed_quota = cost
    if task.state in ("draft", "submitted"):
        state_machine.transition(task, "submitted")
    db.commit()
