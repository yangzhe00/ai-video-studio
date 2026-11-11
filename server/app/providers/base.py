"""Provider 基类协议（constitution II：外部能力一律接口抽象 + Mock 可切）。

统一生命周期：submit() → query() → result()
- submit 提交任务，返回 provider_task_id
- query 轮询状态（queued/running/success/failed）
- result 成功后取结果（文件 key 或文本）
"""

from dataclasses import dataclass
from typing import Protocol


@dataclass
class ProviderState:
    """供应商侧任务状态快照。"""

    state: str  # queued / running / success / failed
    fail_category: str | None = None  # 对齐 shared FailCategory 枚举值
    fail_detail: str | None = None


class AsyncProvider(Protocol):
    """异步生成类 Provider（生图/生视频/TTS/合成）。"""

    name: str

    def submit(self, params: dict) -> str:
        """提交任务，返回供应商任务 ID。"""
        ...

    def query(self, provider_task_id: str) -> ProviderState:
        """轮询任务状态。"""
        ...

    def result(self, provider_task_id: str) -> dict:
        """获取结果（如生成的文件 key/文本）。"""
        ...


class TextProvider(Protocol):
    """同步文本类 Provider（LLM 选题/讲稿/提示词）。"""

    name: str

    def complete(self, prompt: str, **kwargs: object) -> str:
        """同步生成文本。"""
        ...


class SmsProvider(Protocol):
    """短信验证码 Provider。"""

    name: str

    def send_code(self, phone: str, code: str) -> None:
        """发送验证码短信。"""
        ...


class StorageProvider(Protocol):
    """对象存储 Provider（本地磁盘 Mock 实现，预留 S3/OSS）。"""

    name: str

    def save(self, key: str, data: bytes, content_type: str = "application/octet-stream") -> str:
        """保存文件，返回存储 key。"""
        ...

    def open(self, key: str) -> bytes:
        """读取文件内容。"""
        ...

    def delete(self, key: str) -> None:
        """删除文件。"""
        ...
