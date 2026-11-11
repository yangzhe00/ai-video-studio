"""Mock 生图 Provider：同步返回占位图 key（真实图片由 demo 图生成或纯色占位）。"""

import uuid

from app.providers.base import ProviderState

_JOBS: dict[str, dict] = {}


class MockImageGenProvider:
    name = "mock_image_gen"

    def submit(self, params: dict) -> str:
        """提交生图任务。"""
        task_id = f"mockig_{uuid.uuid4().hex[:12]}"
        _JOBS[task_id] = {"fail_category": params.get("mock_fail_category")}
        return task_id

    def query(self, provider_task_id: str) -> ProviderState:
        """立即成功（演示不等待）。"""
        job = _JOBS.get(provider_task_id, {})
        if job.get("fail_category"):
            return ProviderState(state="failed", fail_category=job["fail_category"], fail_detail="Mock 注入的失败")
        return ProviderState(state="success")

    def result(self, provider_task_id: str) -> dict:
        """返回占位图 key（9:16 尺寸标记）。"""
        return {"image_key": f"mock://image_{provider_task_id}", "width": 720, "height": 1280}
