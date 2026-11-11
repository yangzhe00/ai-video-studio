"""Provider Mock 与 ffmpeg 占位媒体单测（T013）。"""

import shutil

import pytest

from app.providers.mock.image_gen import MockImageGenProvider
from app.providers.mock.llm import MockLLMProvider
from app.providers.mock.tts import MockTTSProvider
from app.providers.mock.video_gen import MockVideoGenProvider

ffmpeg_available = shutil.which("ffmpeg") is not None


def test_mock_video_gen_lifecycle():
    """提交 → running → success 全流程。"""
    p = MockVideoGenProvider()
    tid = p.submit({"duration_sec": 6})
    assert p.query(tid).state == "running"
    assert p.query(tid).state == "success"
    result = p.result(tid)
    assert result["duration_sec"] == 6


def test_mock_video_gen_fail_injection():
    """注入失败分类（任务中心演示用）。"""
    p = MockVideoGenProvider()
    tid = p.submit({"mock_fail_category": "quota_insufficient"})
    p.query(tid)
    state = p.query(tid)
    assert state.state == "failed"
    assert state.fail_category == "quota_insufficient"


def test_mock_llm_topics_script_prompts():
    """LLM Mock 输出结构化 JSON，格式与真实供应商约定一致。"""
    p = MockLLMProvider()
    topics = __import__("json").loads(p.complete("", task_kind="topics", keyword="居家收纳", count=5))
    assert len(topics["topics"]) == 5
    assert all("title" in t and "angle" in t for t in topics["topics"])

    script = __import__("json").loads(p.complete("", task_kind="script", title="收纳神器", segments=5))
    assert len(script["segments"]) == 5

    prompts = __import__("json").loads(p.complete("", task_kind="prompts", segments_text=["a", "b"]))
    assert len(prompts["prompts"]) == 2


def test_mock_tts_and_image():
    """TTS/生图 Mock 立即成功并返回结果键。"""
    tts = MockTTSProvider()
    tid = tts.submit({"text": "五个字五" * 4})
    assert tts.query(tid).state == "success"
    assert tts.result(tid)["duration_sec"] > 0

    img = MockImageGenProvider()
    tid2 = img.submit({})
    assert img.query(tid2).state == "success"
    assert img.result(tid2)["width"] == 720


@pytest.mark.skipif(not ffmpeg_available, reason="ffmpeg 未安装")
def test_ffmpeg_placeholder_media():
    """ffmpeg 可用性冒烟：占位视频/静音音轨真实生成（T012 依赖）。"""
    from app.services.compose import make_placeholder_audio, make_placeholder_video

    key = make_placeholder_video(2)
    from app.providers.mock.storage import LocalStorageProvider

    data = LocalStorageProvider().open(key)
    assert data[:4] == b"\x00\x00\x00" or len(data) > 1000  # 非空二进制
    akey = make_placeholder_audio(2)
    assert len(LocalStorageProvider().open(akey)) > 100
