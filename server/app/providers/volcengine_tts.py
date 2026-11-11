"""火山引擎 TTS Provider 骨架（Key 未配置时 registry 回退 Mock）。"""

import uuid

import httpx


class VolcengineTTSProvider:
    name = "volcengine_tts"

    def __init__(self) -> None:
        from app.core.config import settings

        self.api_key = settings.volcengine_tts_key

    def submit(self, params: dict) -> str:
        """提交 TTS 任务（text/voice，真实 API 按火山文档补全）。"""
        raise NotImplementedError("火山 TTS 未接入：请配置 VOLCENGINE_TTS_KEY")

    def query(self, provider_task_id: str) -> ProviderState:
        raise NotImplementedError("火山 TTS 未接入")

    def result(self, provider_task_id: str) -> dict:
        raise NotImplementedError("火山 TTS 未接入")

    def _client(self) -> httpx.AsyncClient:
        _ = uuid.uuid4
        return httpx.AsyncClient(timeout=30)
