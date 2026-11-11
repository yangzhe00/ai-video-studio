"""FastAPI 应用入口：路由装配、建表、种子模板、后台 worker 生命周期。"""

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import assets, auth, compose, files, quota, tasks, topics
from app.core.db import SessionLocal, init_db
from app.core.errors import install_exception_handlers
from app.services.seed import seed_templates
from app.services.worker import start_worker, stop_worker


@asynccontextmanager
async def lifespan(app: FastAPI):
    """启动：建表 + 种子模板 + 启 worker；关闭：停 worker。"""
    init_db()
    db = SessionLocal()
    try:
        seed_templates(db)
    finally:
        db.close()
    start_worker(app)
    yield
    stop_worker(app)


app = FastAPI(title="Taskify 视频成片工作台 API", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

install_exception_handlers(app)

app.include_router(auth.router, prefix="/api")
app.include_router(auth.me_router, prefix="/api")
app.include_router(topics.router, prefix="/api")
app.include_router(assets.router, prefix="/api")
app.include_router(tasks.router, prefix="/api")
app.include_router(compose.router, prefix="/api")
app.include_router(quota.router, prefix="/api")
app.include_router(files.router, prefix="/api")


@app.get("/api/health")
def health() -> dict[str, str]:
    """健康检查。"""
    return {"status": "ok"}
