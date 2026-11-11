"""Mock 视频生成 Provider：模拟排队→生成中→成功全流程，输出占位视频。

演示模式核心：注入参数 mock_fail_category 可复现各类失败（任务中心验证用）。
"""

import time
import uuid

from app.providers.base import ProviderState

# 内存任务表：provider_task_id → 状态数据（进程生命周期内有效）
_JOBS: dict[str, dict] = {}

POLL_COUNT_KEY = "polls"
FAIL_AT_POLL = 2  # 第 2 次轮询前保持生成中，之后落定


class MockVideoGenProvider:
    name = "mock_video_gen"

    def submit(self, params: dict) -> str:
        """提交 Mock 任务；mock_fail_category 注入失败。"""
        task_id = f"mockvg_{uuid.uuid4().hex[:12]}"
        fail_category = params.get("mock_fail_category")
        _JOBS[task_id] = {
            "submit_at": time.monotonic(),
            POLL_COUNT_KEY: 0,
            "fail_category": fail_category,
            "duration": params.get("duration_sec", 8),
        }
        return task_id

    def query(self, provider_task_id: str) -> ProviderState:
        """按轮询次数推进状态：1 次=running，2 次后成功/失败。"""
        job = _JOBS.get(provider_task_id)
        if job is None:
            return ProviderState(state="failed", fail_category="param_error", fail_detail="任务不存在")

        job[POLL_COUNT_KEY] += 1
        if job["fail_category"]:
            if job[POLL_COUNT_KEY] >= FAIL_AT_POLL:
                return ProviderState(
                    state="failed",
                    fail_category=job["fail_category"],
                    fail_detail="Mock 注入的失败（演示用）",
                )
            return ProviderState(state="running")

        if job[POLL_COUNT_KEY] >= FAIL_AT_POLL:
            return ProviderState(state="success")
        return ProviderState(state="running")

    def result(self, provider_task_id: str) -> dict:
        """返回占位视频时长（合成服务对 Mock 片段用黑场视频生成）。"""
        job = _JOBS.get(provider_task_id, {})
        return {"video_key": f"mock://clip_{provider_task_id}", "duration_sec": job.get("duration", 8)}
