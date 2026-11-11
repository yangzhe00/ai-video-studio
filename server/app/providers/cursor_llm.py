"""Cursor Cloud Agents LLM Provider（沿用第一版 ai-video-studio 的灵感生成通道）。

Cursor 是异步 agent：`POST /v1/agents` 创建 run → 轮询 `GET /v1/agents/{id}/runs/{runId}`
直到 FINISHED 才拿到 `result`（JSON 字符串）。本项目 TextProvider 是同步契约，
因此在这里内部阻塞轮询，业务层（topics API）保持零改动。

三种 task_kind：topics（选题）/ script（分段讲稿）/ prompts（分镜提示词），
均强制模型只输出 JSON，解析失败抛 LLMProviderError 由 API 层转成可重试提示。
"""

import json
import re
import time
import uuid

import httpx

from app.core.config import settings

PENDING_STATUSES = {"CREATING", "RUNNING", "WAITING_FOR_BACKGROUND_WORK"}
FAILED_STATUSES = {"ERROR", "CANCELLED", "EXPIRED"}
FENCE_PATTERN = re.compile(r"^```(?:json)?\s*|\s*```$", re.IGNORECASE)

TOPICS_INSTRUCTIONS = """你是短视频选题策划。用户给出创作领域或关键词，请产出 5 条互不重复的中文竖屏短视频选题。
硬性要求：
- 每条含 title（不超过 20 个汉字，有钩子感，不加序号、不用书名号堆叠）与 angle（不超过 40 个汉字，说明切入角度和观众能得到什么）
- 5 条必须覆盖 5 个不同维度：反常识或误区破解、痛点共鸣清单、真实场景故事、对比或测评、避坑或实操步骤
- 不要套用「N 个技巧」这类与内容不符的数字模板，不要标题党滥用感叹号
- 不要编造具体品牌、人物、机构或数据
只输出一个 JSON 对象，不要解释、不要 Markdown：
{"topics":[{"title":"选题标题","angle":"切入角度"}]}"""

SCRIPT_INSTRUCTIONS = """你是竖屏短视频口播编剧。选题是：%TITLE%。
写一段 5 段式口播讲稿，每段对应 5 到 10 秒画面，约 25 到 45 个汉字。
段落结构：第 1 段钩子（提出反常识结论或问题，3 秒抓住注意力）；第 2 段痛点共鸣；第 3、4 段各给一个具体可执行的方法；第 5 段一句话收尾引导，不喊口号。
要求：口语化短句，像真人说话，不用书面语，不出现「首先其次最后」这类连接词，每段独立成句可直接拿去配音。
只输出一个 JSON 对象，不要解释、不要 Markdown：
{"segments":[{"text":"第一段口播"}]}，segments 必须恰好 5 条。"""

PROMPTS_INSTRUCTIONS = """你是图生视频提示词工程师。把每段口播文案转成竖屏 9:16 的单镜头中文画面提示词。
要求：每条不超过 80 个汉字，包含主体、动作、场景、光线、镜头景别（如近景、俯拍、中景）与氛围；写实风格；画面内不要出现文字、字幕、logo、水印；不做多人面部特写；不写旁白或台词。
输入段落（按 index 顺序）：
%SEGMENTS%
只输出一个 JSON 对象，不要解释、不要 Markdown：
{"prompts":[{"index":0,"prompt":"画面提示词"}]}，prompts 数量必须与输入段落数一致。"""


class LLMProviderError(RuntimeError):
    """LLM 调用失败（retryable 决定前端是否给"重试"入口）。"""

    def __init__(self, message: str, *, retryable: bool = True) -> None:
        super().__init__(message)
        self.retryable = retryable


class CursorLLMProvider:
    """Cursor Cloud Agents 实现（OpenAI 之外的第二条真实 LLM 通道）。"""

    name = "cursor_cloud_agent"

    def __init__(self) -> None:
        self.api_key = settings.cursor_api_key
        self.base_url = settings.cursor_base_url.rstrip("/")

    # ---------- TextProvider 契约 ----------

    def complete(self, prompt: str, **kwargs: object) -> str:
        """同步返回结构化 JSON 文本（topic/script/prompt 三类）。"""
        kind = str(kwargs.get("task_kind", "topics"))
        instructions = self._instructions(kind, kwargs)
        raw = self._run_agent(instructions)
        return self._normalize_json(raw)

    # ---------- 指令组装 ----------

    def _instructions(self, kind: str, kwargs: dict[str, object]) -> str:
        if kind == "topics":
            keyword = str(kwargs.get("keyword", "")).strip()
            if not keyword:
                raise LLMProviderError("缺少创作关键词", retryable=False)
            return f"{TOPICS_INSTRUCTIONS}\n\n用户输入：{keyword}"
        if kind == "script":
            title = str(kwargs.get("title", "")).strip()
            return SCRIPT_INSTRUCTIONS.replace("%TITLE%", title or "未命名选题")
        if kind == "prompts":
            texts = [str(t) for t in kwargs.get("segments_text", [])]  # type: ignore[union-attr]
            numbered = "\n".join(f"{i}. {t}" for i, t in enumerate(texts)) or "1. 占位段落"
            return PROMPTS_INSTRUCTIONS.replace("%SEGMENTS%", numbered)
        raise LLMProviderError(f"未知的 task_kind: {kind}", retryable=False)

    # ---------- Cursor Agent 调用 ----------

    def _client(self) -> httpx.Client:
        return httpx.Client(
            base_url=self.base_url,
            headers={"Authorization": f"Bearer {self.api_key}", "content-type": "application/json"},
            timeout=httpx.Timeout(30.0, connect=10.0),
        )

    def _run_agent(self, instructions: str) -> str:
        """创建 agent run 并阻塞轮询至 FINISHED，返回 result 字符串。"""
        if not self.api_key:
            raise LLMProviderError("Cursor API Key 未配置", retryable=False)

        # Cursor 要求 agentId 严格为 bc-<uuid> 格式
        agent_id = f"bc-{uuid.uuid4()}"
        body: dict[str, object] = {
            "agentId": agent_id,
            "name": "taskify-idea",
            "prompt": {"text": instructions},
            "mode": "agent",
        }
        if settings.cursor_model:
            body["model"] = {"id": settings.cursor_model}

        deadline = time.monotonic() + settings.cursor_timeout_sec
        with self._client() as client:
            run_id = self._create_run(client, agent_id, body)
            while True:
                status, result = self._read_run(client, agent_id, run_id)
                if status == "FINISHED":
                    if not isinstance(result, str) or not result.strip():
                        raise LLMProviderError("Cursor 返回内容为空")
                    return result
                if status in FAILED_STATUSES:
                    raise LLMProviderError(f"Cursor 生成未完成（{status}）")
                if status not in PENDING_STATUSES:
                    raise LLMProviderError(f"Cursor 返回未知状态：{status}")
                if time.monotonic() >= deadline:
                    raise LLMProviderError("Cursor 生成超时，请重试")
                time.sleep(settings.cursor_poll_interval_sec)

    def _create_run(self, client: httpx.Client, agent_id: str, body: dict[str, object]) -> str:
        try:
            resp = client.post("/agents", json=body)
        except httpx.HTTPError as exc:
            raise LLMProviderError(f"Cursor 连接失败：{exc.__class__.__name__}") from exc
        if resp.status_code >= 400:
            raise self._http_error(resp)
        payload = resp.json()
        run_id = (payload.get("run") or {}).get("id")
        if not isinstance(run_id, str) or not run_id.startswith("run-"):
            raise LLMProviderError("Cursor 创建会话响应异常")
        return run_id

    def _read_run(self, client: httpx.Client, agent_id: str, run_id: str) -> tuple[str, object]:
        try:
            resp = client.get(f"/agents/{agent_id}/runs/{run_id}")
        except httpx.HTTPError as exc:
            raise LLMProviderError(f"Cursor 连接失败：{exc.__class__.__name__}") from exc
        if resp.status_code == 404:
            raise LLMProviderError("Cursor 会话不存在或已过期")
        if resp.status_code >= 400:
            raise self._http_error(resp)
        payload = resp.json()
        return str(payload.get("status", "")), payload.get("result")

    def _http_error(self, resp: httpx.Response) -> LLMProviderError:
        retryable = resp.status_code not in (401, 403)
        if resp.status_code in (401, 403):
            return LLMProviderError("Cursor 鉴权失败，请检查 CURSOR_API_KEY", retryable=False)
        return LLMProviderError(f"Cursor 服务异常（HTTP {resp.status_code}）", retryable=retryable)

    # ---------- JSON 清洗 ----------

    def _normalize_json(self, raw: str) -> str:
        """剥掉可能的 Markdown 围栏与前后缀，返回可 json.loads 的字符串。"""
        text = FENCE_PATTERN.sub("", raw.strip())
        start, end = text.find("{"), text.rfind("}")
        if start < 0 or end <= start:
            raise LLMProviderError("Cursor 未按要求返回 JSON")
        candidate = text[start : end + 1]
        try:
            json.loads(candidate)
        except json.JSONDecodeError as exc:
            raise LLMProviderError("Cursor 返回的 JSON 无法解析") from exc
        return candidate
