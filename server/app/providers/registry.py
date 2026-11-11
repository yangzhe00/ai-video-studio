"""Provider 注册表：按配置选择 Mock 或真实实现（ constitution II）。"""

from app.core.config import settings


def get_video_gen_provider():
    """视频生成 Provider（可灵/Mock）。"""
    if settings.video_gen_provider == "kling" and settings.kling_api_key:
        from app.providers.kling import KlingVideoGenProvider

        return KlingVideoGenProvider()
    from app.providers.mock.video_gen import MockVideoGenProvider

    return MockVideoGenProvider()


def get_image_gen_provider():
    """生图 Provider。"""
    from app.providers.mock.image_gen import MockImageGenProvider

    return MockImageGenProvider()


def get_llm_provider():
    """LLM Provider（Cursor Cloud Agents / Mock）。"""
    if settings.llm_provider == "cursor" and settings.cursor_api_key:
        from app.providers.cursor_llm import CursorLLMProvider

        return CursorLLMProvider()
    from app.providers.mock.llm import MockLLMProvider

    return MockLLMProvider()


def get_tts_provider():
    """TTS Provider（火山引擎/Mock）。"""
    if settings.tts_provider == "volcengine" and settings.volcengine_tts_key:
        from app.providers.volcengine_tts import VolcengineTTSProvider

        return VolcengineTTSProvider()
    from app.providers.mock.tts import MockTTSProvider

    return MockTTSProvider()


def get_sms_provider():
    """短信 Provider（演示默认 Mock，回显验证码）。"""
    from app.providers.mock.sms import MockSmsProvider

    return MockSmsProvider()


def get_storage_provider():
    """存储 Provider（本地磁盘，预留 S3/OSS 接口）。"""
    from app.providers.mock.storage import LocalStorageProvider

    return LocalStorageProvider()
