"""应用配置：全部密钥/开关走环境变量（constitution IV），Mock 默认开启。"""

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")

    app_env: str = "demo"  # demo / production
    secret_key: str = "dev-only-change-me-please-use-32-bytes-min"
    jwt_expire_hours: int = 72

    database_url: str = "postgresql+psycopg://taskify:taskify@localhost:5432/taskify"

    storage_dir: str = "data/uploads"
    storage_provider: str = "mock"  # mock(本地磁盘) / s3 预留

    # 超时阈值（秒）：生视频 15min / 合成 30min（constitution 已确认数值）
    video_gen_timeout_sec: int = 15 * 60
    compose_timeout_sec: int = 30 * 60
    # 演示初始额度
    default_quota: float = 1000.0
    # 额度预警阈值：剩余 20%（constitution 数值）
    quota_warn_ratio: float = 0.2
    # 选题每次生成条数（已确认 5 条）
    topic_count: int = 5
    # 素材限制：20MB，jpg/png/webp
    asset_max_size_mb: int = 20
    asset_mime_types: list[str] = ["image/jpeg", "image/png", "image/webp"]
    # 版本历史保留最近 10 版
    max_versions_per_topic: int = 10
    # 验证码有效期/重发间隔（秒）
    sms_code_ttl_sec: int = 300
    sms_resend_interval_sec: int = 60

    # Provider 开关：未配置真实 Key 时一律回退 Mock
    # --- 可灵图生视频（沿用第一版 ai-video-studio：北京节点 + kling-2.5-turbo）---
    video_gen_provider: str = "kling"  # kling / mock
    kling_api_key: str = ""
    kling_base_url: str = "https://api-beijing.klingai.com"
    kling_model: str = "kling-2.5-turbo"
    kling_resolution: str = "720p"

    image_gen_provider: str = "mock"
    # --- LLM：Cursor Cloud Agents（沿用第一版 ai-video-studio）---
    llm_provider: str = "cursor"  # cursor / mock
    cursor_api_key: str = ""
    cursor_base_url: str = "https://api.cursor.com/v1"
    cursor_model: str = ""  # 空 = 账号默认（Auto）
    cursor_timeout_sec: int = 180  # Cloud Agent 单次 run 最长等待
    cursor_poll_interval_sec: float = 2.0

    tts_provider: str = "mock"  # mock / volcengine
    volcengine_tts_key: str = ""
    sms_provider: str = "mock"  # mock / tencent
    tencent_sms_key: str = ""


settings = Settings()
