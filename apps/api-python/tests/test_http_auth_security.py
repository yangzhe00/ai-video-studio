from pathlib import Path

import httpx
import pytest

from ai_video_api.main import create_app
from ai_video_api.settings import Settings


class FakeDb:
    def __init__(self):
        self.accounts = {}
        self.sessions = {}

    async def execute(self, sql, *values):
        if sql.startswith("INSERT INTO accounts"):
            account_id, email, password_hash, created_at, demo_quota = values
            self.accounts[email] = {"id": account_id, "email": email, "password_hash": password_hash,
                                    "demo_quota": demo_quota, "demo_reserved": 0, "demo_used": 0}
        elif sql.startswith("INSERT INTO sessions"):
            digest, account_id, expires = values
            self.sessions[digest] = (account_id, expires)
        elif sql.startswith("DELETE FROM sessions"):
            self.sessions.pop(values[0], None)
        return 1

    async def fetch_one(self, sql, *values):
        if sql.startswith("SELECT id,password_hash FROM accounts"):
            return self.accounts.get(values[0])
        if sql.startswith("SELECT account_id FROM sessions"):
            session = self.sessions.get(values[0])
            return {"account_id": session[0]} if session and session[1] > values[1] else None
        if sql.startswith("SELECT id,email,demo_quota"):
            return next((account for account in self.accounts.values() if account["id"] == values[0]), None)
        raise AssertionError(sql)


class FakeRateLimiter:
    def __init__(self):
        self.calls = []

    async def check(self, key, limit, window_ms=60_000):
        self.calls.append((key, limit))


@pytest.fixture
def app(tmp_path: Path):
    settings = Settings.from_env({
        "DATABASE_URL": "postgresql://unused/test", "REDIS_URL": "redis://127.0.0.1:1/0",
        "API_DATA_DIR": str(tmp_path), "API_SESSION_SECRET": "s" * 32,
        "API_ALLOWED_ORIGIN": "http://127.0.0.1:1422", "API_SECURE_COOKIES": "false",
    })
    return create_app(settings, FakeDb(), FakeRateLimiter())


@pytest.mark.asyncio
async def test_origin_csrf_and_preflight(app):
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://api.test") as client:
        okay = await client.get("/health", headers={"Origin": "http://127.0.0.1:1422"})
        assert okay.status_code == 200
        assert okay.headers["access-control-allow-origin"] == "http://127.0.0.1:1422"
        denied = await client.get("/health", headers={"Origin": "https://attacker.test"})
        assert denied.status_code == 403
        assert denied.json() == {"error": "来源不允许", "code": "forbidden"}
        assert "access-control-allow-origin" not in denied.headers
        cross_site = await client.get("/health", headers={"Sec-Fetch-Site": "cross-site"})
        assert cross_site.status_code == 403
        no_marker = await client.post("/auth/login", json={"email": "a@b.co", "password": "bad"})
        assert no_marker.status_code == 403
        preflight = await client.options("/auth/login", headers={
            "Origin": "http://127.0.0.1:1422", "Access-Control-Request-Method": "POST"})
        assert preflight.status_code == 204
        bad_preflight = await client.options("/auth/login", headers={"Access-Control-Request-Method": "POST"})
        assert bad_preflight.status_code == 403


@pytest.mark.asyncio
async def test_register_login_old_cookie_contract(app):
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://api.test") as client:
        headers = {"X-AVS-Request": "1"}
        registered = await client.post("/auth/register", json={"email": " TEST@EXAMPLE.COM ", "password": "ExamplePassword123!"}, headers=headers)
        assert registered.status_code == 201
        assert registered.json()["account"]["email"] == "test@example.com"
        assert "avs_session=" in registered.headers["set-cookie"]
        assert "HttpOnly" in registered.headers["set-cookie"]
        me = await client.get("/auth/me")
        assert me.status_code == 200
        assert me.json()["account"]["email"] == "test@example.com"
        out = await client.post("/auth/logout", headers=headers)
        assert out.status_code == 200
        assert (await client.get("/auth/me")).status_code == 401
        wrong = await client.post("/auth/login", json={"email": "test@example.com", "password": "wrong"}, headers=headers)
        assert wrong.status_code == 401
        logged_in = await client.post("/auth/login", json={"email": "test@example.com", "password": "ExamplePassword123!"}, headers=headers)
        assert logged_in.status_code == 200


@pytest.mark.asyncio
async def test_errors_keep_shared_envelope(app):
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://api.test") as client:
        missing = await client.get("/missing")
        assert missing.status_code == 404
        assert missing.json() == {"error": "接口不存在", "code": "not_found"}
        malformed = await client.post("/auth/login", json={"email": "a@b.co"}, headers={"X-AVS-Request": "1"})
        assert malformed.status_code == 400
        assert malformed.json() == {"error": "请求内容不符合接口协议", "code": "invalid_request"}
