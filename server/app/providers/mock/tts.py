"""Mock TTS Provider：生成占位音频 key（真实音频由合成服务用静音音轨占位）。"""

import time
import uuid

from app.providers.base import ProviderState

_JOBS: dict[str, dict] = {}


class MockTTSProvider:
    name = "mock_tts"

    def submit(self, params: dict) -> str:
        """提交 TTS 任务（text/voice）。"""
        task_id = f"mocktts_{uuid.uuid4().hex[:12]}"
        _JOBS[task_id] = {
            "duration": max(1, len(str(params.get("text", ""))) / 4),  # 约 4 字/秒
            "fail_category": params.get("mock_fail_category"),
        }
        return task_id

    def query(self, provider_task_id: str) -> ProviderState:
        """短暂 running 后成功。"""
        job = _JOBS.get(provider_task_id, {})
        if job.get("fail_category"):
            return ProviderState(state="failed", fail_category=job["fail_category"], fail_detail="Mock 注入的失败")
        return ProviderState(state="success", fail_detail=f"elapsed={time.monotonic():.0f}")

    def result(self, provider_task_id: str) -> dict:
        """返回音频时长（合成时生成对应静音/占位音轨）。"""
        job = _JOBS.get(provider_task_id, {})
        return {"audio_key": f"mock://audio_{provider_task_id}", "duration_sec": round(job.get("duration", 5), 2)}
