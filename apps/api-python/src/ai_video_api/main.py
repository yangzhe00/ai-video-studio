from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import time
from contextlib import asynccontextmanager
from uuid import uuid4

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse, Response
from starlette.exceptions import HTTPException as StarletteHTTPException
from psycopg.errors import UniqueViolation
from redis.asyncio import Redis

from ai_video_api.auth import (
    clear_session, create_session, hash_password, normalize_email, session_account,
    validate_password, verify_password,
)
from ai_video_api.cache import ShortCache
from ai_video_api.db import Database
from ai_video_api.errors import ApiError, error_response
from ai_video_api.limits import RedisRateLimiter
from ai_video_api.objects import get_object_response
from ai_video_api.project_create import create_project
from ai_video_api.projects import get_project, list_projects
from ai_video_api.security import check_request_security, client_ip
from ai_video_api.settings import Settings

logger = logging.getLogger(__name__)


async def read_json(request: Request) -> dict[str, object]:
    if request.headers.get("content-type", "").split(";", 1)[0].strip().lower() != "application/json":
        raise ApiError(415, "请求必须使用 application/json")
    body = bytearray()
    async for chunk in request.stream():
        body.extend(chunk)
        if len(body) > 1_000_000:
            raise ApiError(413, "上传内容超过大小限制")
    try:
        value = json.loads(body)
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ApiError(400, "请求 JSON 无效") from error
    if not isinstance(value, dict):
        raise ApiError(400, "请求 JSON 无效")
    return value


def create_app(settings: Settings | None = None, database: Database | None = None,
               rate_limiter: RedisRateLimiter | None = None,
               redis_client: Redis | None = None) -> FastAPI:
    config = settings or Settings.from_env()
    own_db = database is None
    own_redis = redis_client is None
    db = database or Database(config.database_url)
    redis = redis_client or Redis.from_url(config.redis_url, socket_connect_timeout=2, socket_timeout=2)
    rate = rate_limiter or RedisRateLimiter(redis)

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        if own_db:
            await db.open()
        try:
            if own_redis:
                await redis.ping()
            app.state.ready = True
            yield
        finally:
            app.state.ready = False
            if own_redis:
                await redis.aclose()
            if own_db:
                await db.close()

    app = FastAPI(lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)

    @app.middleware("http")
    async def secure(request: Request, call_next):
        origin = request.headers.get("origin")
        try:
            preflight = check_request_security(request, config)
            if preflight:
                response: Response = Response(status_code=204, headers={
                    "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
                    "Access-Control-Allow-Headers": "content-type, x-avs-request",
                    "Access-Control-Max-Age": "600",
                })
            else:
                response = await call_next(request)
        except ApiError as error:
            response = error_response(error)
        except Exception:
            logger.exception("Unhandled API request error")
            response = error_response(ApiError(500, "服务器内部错误"))
        response.headers["Vary"] = "Origin, Sec-Fetch-Site"
        if origin and origin == config.allowed_origin:
            response.headers["Access-Control-Allow-Origin"] = origin
            response.headers["Access-Control-Allow-Credentials"] = "true"
        return response

    @app.exception_handler(ApiError)
    async def api_error_handler(_request: Request, error: ApiError):
        return error_response(error)

    @app.exception_handler(StarletteHTTPException)
    async def http_error_handler(_request: Request, error: StarletteHTTPException):
        message = "接口不存在" if error.status_code == 404 else "请求方法不允许" if error.status_code == 405 else "请求失败"
        return error_response(ApiError(error.status_code, message))

    @app.exception_handler(RequestValidationError)
    async def validation_error_handler(_request: Request, _error: RequestValidationError):
        return error_response(ApiError(400, "请求参数无效"))

    @app.get("/health")
    async def health():
        return JSONResponse({"ok": True}, headers={"Cache-Control": "no-store"})

    async def auth_rate(request: Request, email: str, kind: str) -> None:
        await rate.check(f"auth-ip:{kind}:{client_ip(request, config.trusted_proxy_ips)}", 200)
        account_hash = hashlib.sha256(email.encode()).hexdigest()
        limit = config.auth_login_account_limit if kind == "login" else 5
        await rate.check(f"auth-account:{kind}:{account_hash}", limit)

    async def authenticated_account(request: Request) -> str:
        account_id = await session_account(db, request.headers.get("cookie"), config.session_secret)
        if not account_id:
            raise ApiError(401, "请先登录")
        return account_id

    @app.post("/auth/register")
    async def register(request: Request):
        body = await read_json(request)
        if not isinstance(body.get("email"), str) or not isinstance(body.get("password"), str):
            raise ApiError(400, "请求内容不符合接口协议")
        email = normalize_email(body.get("email"))
        password = validate_password(body.get("password"))
        await auth_rate(request, email, "register")
        account_id = str(uuid4())
        password_hash = await asyncio.to_thread(hash_password, password)
        try:
            await db.execute("INSERT INTO accounts (id,email,password_hash,created_at,demo_quota) VALUES (%s,%s,%s,%s,%s)",
                             account_id, email, password_hash, int(time.time() * 1000), config.demo_quota)
        except UniqueViolation as error:
            raise ApiError(409, "邮箱已注册") from error
        session_id, expires = await create_session(db, account_id, config.session_secret)
        response = JSONResponse({"account": {"id": account_id, "email": email}, "expiresAt": expires},
                                status_code=201, headers={"Cache-Control": "no-store"})
        response.set_cookie("avs_session", session_id, max_age=604800, httponly=True,
                            secure=config.secure_cookies, samesite="lax", path="/")
        return response

    @app.post("/auth/login")
    async def login(request: Request):
        body = await read_json(request)
        if not isinstance(body.get("email"), str) or not isinstance(body.get("password"), str):
            raise ApiError(400, "请求内容不符合接口协议")
        email = normalize_email(body.get("email"))
        await auth_rate(request, email, "login")
        password = body.get("password") if isinstance(body.get("password"), str) else ""
        row = await db.fetch_one("SELECT id,password_hash FROM accounts WHERE email=%s", email)
        if not row or not await asyncio.to_thread(verify_password, password, row["password_hash"]):
            raise ApiError(401, "邮箱或密码错误")
        session_id, expires = await create_session(db, row["id"], config.session_secret)
        response = JSONResponse({"account": {"id": row["id"], "email": email}, "expiresAt": expires},
                                headers={"Cache-Control": "no-store"})
        response.set_cookie("avs_session", session_id, max_age=604800, httponly=True,
                            secure=config.secure_cookies, samesite="lax", path="/")
        return response

    @app.post("/auth/logout")
    async def logout(request: Request):
        await authenticated_account(request)
        await clear_session(db, request.headers.get("cookie"), config.session_secret)
        response = JSONResponse({"ok": True}, headers={"Cache-Control": "no-store"})
        response.delete_cookie("avs_session", path="/", httponly=True, samesite="lax")
        return response

    @app.get("/auth/me")
    async def me(request: Request):
        account_id = await authenticated_account(request)
        row = await db.fetch_one("SELECT id,email,demo_quota,demo_reserved,demo_used FROM accounts WHERE id=%s", account_id)
        return JSONResponse({"account": row}, headers={"Cache-Control": "no-store"})

    @app.get("/projects")
    async def projects(request: Request):
        account_id = await authenticated_account(request)
        return JSONResponse({"projects": await list_projects(db, account_id)}, headers={"Cache-Control": "no-store"})

    @app.post("/projects")
    async def create_project_route(request: Request):
        account_id = await authenticated_account(request)
        project, replayed = await create_project(db, account_id, await read_json(request))
        return JSONResponse({"project": project}, status_code=200 if replayed else 201,
                            headers={"Cache-Control": "no-store"})

    @app.get("/projects/{project_id}")
    async def project(request: Request, project_id: str):
        account_id = await authenticated_account(request)
        return JSONResponse({"project": await get_project(db, account_id, project_id)}, headers={"Cache-Control": "no-store"})

    @app.get("/objects/{object_id}")
    async def object_get(request: Request, object_id: str):
        account_id = await authenticated_account(request)
        return await get_object_response(db, account_id, object_id, request.headers.get("range"))

    app.state.database = db
    app.state.redis = redis
    app.state.rate_limiter = rate
    app.state.cache = ShortCache(redis)
    app.state.authenticated_account = authenticated_account
    return app
