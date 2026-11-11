"""可灵图生视频 Provider（真实接入，接口约定沿用第一版 ai-video-studio）。

第一版验证过的调用形态：
- 提交：`POST {base}/image-to-video/kling-2.5-turbo`
  body `{contents:[{type:"prompt",text},{type:"first_frame",url}], settings:{resolution,duration}, options:{external_task_id}}`
  其中 first_frame.url 直接传 `data:image/...;base64,...`，无需先把图传公网。
- 查询：`GET {base}/tasks?task_ids=<id>`，状态 submitted/processing/succeeded/failed，
  视频地址在 `data[0].outputs[]` 里 type=video 的 url。
- 鉴权：`Authorization: Bearer <KLING_API_KEY>`（api-key 形式，北京节点）。

provider 内部自行读素材文件与落盘下载，业务层（tasks API / worker）零改动。
"""

import base64
import mimetypes
import uuid

import httpx

from app.core.config import settings
from app.providers.base import ProviderState

TRUSTED_DOMAINS = ("klingai.com", "inkwai.com")
TRUSTED_HOSTS = ("v2-fdl.kechuangai.com",)
MAX_VIDEO_BYTES = 100_000_000

# 可灵 message / code → 统一失败分类（PRD 1.1 枚举）
FAIL_KEYWORDS = (
    (("审核", "敏感", "违规", "sensitive", "policy"), "content_review_rejected"),
    (("额度", "余额", "quota", "balance", "insufficient"), "quota_insufficient"),
    (("参数", "invalid", "parameter"), "param_error"),
)


class KlingVideoGenProvider:
    name = "kling"

    def __init__(self) -> None:
        self.api_key = settings.kling_api_key
        self.base_url = settings.kling_base_url.rstrip("/")

    # ---------- AsyncProvider 契约 ----------

    def submit(self, params: dict) -> str:
        """提交图生视频（有素材走 image-to-video，无素材退化 text-to-video）。"""
        prompt = str(params.get("prompt") or "").strip()
        if not prompt:
            raise ValueError("提示词为空，无法提交可灵生成")

        data_uri = self._image_data_uri(params.get("asset_id"))
        contents: list[dict[str, object]] = [{"type": "prompt", "text": prompt}]
        if data_uri:
            contents.append({"type": "first_frame", "url": data_uri})
        endpoint = "image-to-video" if data_uri else "text-to-video"

        body = {
            "contents": contents,
            "settings": {
                "resolution": settings.kling_resolution,
                "duration": self._duration(params.get("duration_sec")),
            },
            "options": {"external_task_id": f"taskify-{uuid.uuid4().hex[:16]}"},
        }
        with self._client() as client:
            resp = client.post(f"/{endpoint}/{settings.kling_model}", json=body)
        if resp.status_code >= 400:
            raise RuntimeError(f"可灵提交失败（HTTP {resp.status_code}）")
        payload = resp.json()
        if payload.get("code") != 0:
            raise RuntimeError(f"可灵提交被拒：{payload.get('message')}")
        task_id = (payload.get("data") or {}).get("id")
        if not task_id:
            raise RuntimeError("可灵提交响应缺少任务 ID")
        return str(task_id)

    def query(self, provider_task_id: str) -> ProviderState:
        """轮询可灵任务状态。"""
        try:
            task = self._fetch_task(provider_task_id)
        except httpx.HTTPError as exc:
            return ProviderState(state="failed", fail_category="provider_fault", fail_detail=f"可灵查询失败：{exc.__class__.__name__}")
        if task is None:
            return ProviderState(state="failed", fail_category="param_error", fail_detail="可灵任务不存在")

        status = str(task.get("status", ""))
        if status in ("submitted", "processing"):
            return ProviderState(state="running")
        if status == "succeeded":
            return ProviderState(state="success")
        message = str(task.get("message") or "可灵生成失败")
        return ProviderState(state="failed", fail_category=self._categorize(message), fail_detail=message)

    def result(self, provider_task_id: str) -> dict:
        """取视频地址并下载到本地存储，返回存储 key。"""
        task = self._fetch_task(provider_task_id)
        outputs = (task or {}).get("outputs") or []
        video_url = next((str(o.get("url")) for o in outputs if o.get("type") == "video" and o.get("url")), None)
        if not video_url:
            raise RuntimeError("可灵返回结果中没有视频地址")

        data = self._download(video_url)
        from app.providers.registry import get_storage_provider

        key = f"clips/kling_{uuid.uuid4().hex[:16]}.mp4"
        get_storage_provider().save(key, data, content_type="video/mp4")
        return {"video_key": key, "duration_sec": 10, "source": "kling"}

    # ---------- 内部 ----------

    def _client(self) -> httpx.Client:
        return httpx.Client(
            base_url=self.base_url,
            headers={"Authorization": f"Bearer {self.api_key}", "content-type": "application/json"},
            timeout=httpx.Timeout(60.0, connect=15.0),
        )

    def _image_data_uri(self, asset_id: object) -> str | None:
        """按 asset_id 读本地素材，转 base64 data URI（可灵支持直接内联首帧）。"""
        if not asset_id:
            return None
        from app.core.db import SessionLocal
        from app.models.entities import Asset
        from app.providers.registry import get_storage_provider

        db = SessionLocal()
        try:
            asset = db.get(Asset, str(asset_id))
            if asset is None or not asset.path:
                return None
            path = str(asset.path)
            mime = asset.mime_type or mimetypes.guess_type(path)[0] or "image/png"
        finally:
            db.close()

        try:
            data = get_storage_provider().open(path)
        except Exception:
            return None
        return f"data:{mime};base64,{base64.b64encode(data).decode()}"

    def _fetch_task(self, provider_task_id: str) -> dict | None:
        with self._client() as client:
            resp = client.get("/tasks", params={"task_ids": provider_task_id})
        if resp.status_code >= 400:
            raise httpx.HTTPStatusError("kling query failed", request=resp.request, response=resp)
        payload = resp.json()
        if payload.get("code") != 0:
            raise httpx.HTTPStatusError("kling code error", request=resp.request, response=resp)
        data = payload.get("data")
        entries = data if isinstance(data, list) else (data or {}).get("result", [])
        return entries[0] if entries else None

    def _download(self, video_url: str) -> bytes:
        """下载成片，校验域名白名单（防止结果地址被篡改）。"""
        current = video_url
        with httpx.Client(timeout=httpx.Timeout(180.0, connect=15.0), follow_redirects=False) as client:
            for _ in range(5):
                url = httpx.URL(current)
                if url.scheme != "https" or not self._trusted(str(url.host)):
                    raise RuntimeError("可灵返回的视频地址不可信")
                resp = client.get(current)
                if resp.status_code in (301, 302, 303, 307, 308):
                    location = resp.headers.get("location")
                    if not location:
                        raise RuntimeError("可灵视频下载重定向无效")
                    current = str(url.join(location))
                    continue
                if resp.status_code >= 400:
                    raise RuntimeError(f"可灵视频下载失败（HTTP {resp.status_code}）")
                data = resp.content
                if not data:
                    raise RuntimeError("可灵视频内容为空")
                if len(data) > MAX_VIDEO_BYTES:
                    raise RuntimeError("可灵视频超过大小上限")
                return data
        raise RuntimeError("可灵视频重定向次数过多")

    def _trusted(self, host: str) -> bool:
        return host in TRUSTED_HOSTS or any(host == d or host.endswith(f".{d}") for d in TRUSTED_DOMAINS)

    def _duration(self, value: object) -> int:
        """可灵仅支持 5 / 10 秒；段目标 8 秒取 10 保证覆盖。"""
        try:
            sec = float(value)  # type: ignore[arg-type]
        except (TypeError, ValueError):
            sec = 8.0
        return 5 if sec <= 5 else 10

    def _categorize(self, message: str) -> str:
        lowered = message.lower()
        for keywords, category in FAIL_KEYWORDS:
            if any(k in message or k in lowered for k in keywords):
                return category
        return "provider_fault"
