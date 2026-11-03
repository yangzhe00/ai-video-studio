from pathlib import Path

import pytest

from ai_video_api.settings import Settings


def test_required_configuration_and_schema_version(tmp_path: Path):
    env = {
        "DATABASE_URL": "postgresql://localhost/test",
        "REDIS_URL": "redis://localhost:6379/0",
        "API_DATA_DIR": str(tmp_path),
        "API_SESSION_SECRET": "s" * 32,
        "API_ALLOWED_ORIGIN": "http://127.0.0.1:1422",
    }
    settings = Settings.from_env(env)
    assert settings.data_dir == tmp_path.resolve()
    assert settings.allowed_origin == "http://127.0.0.1:1422"
    assert settings.port == 8787

    for missing in ("DATABASE_URL", "REDIS_URL", "API_DATA_DIR", "API_SESSION_SECRET"):
        with pytest.raises(ValueError):
            Settings.from_env({k: v for k, v in env.items() if k != missing})


def test_production_requires_https_and_secure_cookies(tmp_path: Path):
    env = {
        "DATABASE_URL": "postgresql://localhost/test", "REDIS_URL": "redis://localhost:6379/0",
        "API_DATA_DIR": str(tmp_path), "API_SESSION_SECRET": "s" * 32,
        "API_ALLOWED_ORIGIN": "http://example.com", "API_ENV": "production",
    }
    with pytest.raises(ValueError, match="HTTPS"):
        Settings.from_env(env)
    env["API_ALLOWED_ORIGIN"] = "https://example.com"
    env["API_SECURE_COOKIES"] = "false"
    with pytest.raises(ValueError, match="Secure"):
        Settings.from_env(env)
