"""SQLAlchemy 实体定义（plan.md Data Model，9 张核心表）。

时间统一 UTC 存储；JSON 字段用通用 JSON 类型（可移植 sqlite/postgres）。
"""

from datetime import datetime, timezone
from uuid import uuid4

from sqlalchemy import JSON, Boolean, DateTime, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


def utcnow() -> datetime:
    """当前 UTC 时间。"""
    return datetime.now(timezone.utc)


def gen_id() -> str:
    """生成实体主键（UUID 短横线格式）。"""
    return str(uuid4())


class Base(DeclarativeBase):
    pass


class User(Base):
    """用户（一期无角色权限，FR-E-04）。"""

    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=gen_id)
    phone: Mapped[str] = mapped_column(String(11), unique=True, index=True)
    quota_balance: Mapped[float] = mapped_column(Float, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class Session(Base):
    """登录会话（JWT jti，支持过期与登出）。"""

    __tablename__ = "sessions"

    token: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), index=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class SmsCode(Base):
    """验证码（Mock/真实供应商共用存储）。"""

    __tablename__ = "sms_codes"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=gen_id)
    phone: Mapped[str] = mapped_column(String(11), index=True)
    code: Mapped[str] = mapped_column(String(6))
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    used: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class QuotaLedger(Base):
    """额度账本（每任务消耗明细，FR-E-03）。"""

    __tablename__ = "quota_ledger"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=gen_id)
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), index=True)
    task_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("tasks.id"), nullable=True)
    delta: Mapped[float] = mapped_column(Float)  # 扣减为负，充值/初始为正
    balance_after: Mapped[float] = mapped_column(Float)
    reason: Mapped[str] = mapped_column(String(200))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class Topic(Base):
    """选题（FR-A-01/04）。"""

    __tablename__ = "topics"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=gen_id)
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), index=True)
    keyword: Mapped[str] = mapped_column(String(200))
    title: Mapped[str] = mapped_column(String(200))
    angle: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(16), default="draft")  # draft/selected
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class Script(Base):
    """讲稿（段落内嵌 JSON，段落=分镜，FR-A-02/03）。"""

    __tablename__ = "scripts"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=gen_id)
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), index=True)
    topic_id: Mapped[str] = mapped_column(String(36), ForeignKey("topics.id"), index=True)
    segments: Mapped[list] = mapped_column(JSON, default=list)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)


class Asset(Base):
    """图片素材（上传/生图，FR-B-01/02）。"""

    __tablename__ = "assets"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=gen_id)
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), index=True)
    source: Mapped[str] = mapped_column(String(16))  # upload/generated
    path: Mapped[str] = mapped_column(Text)  # StorageProvider key
    mime_type: Mapped[str] = mapped_column(String(64))
    size_bytes: Mapped[int] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class Task(Base):
    """生成任务（全站统一状态机，FR-E-01/02）。"""

    __tablename__ = "tasks"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=gen_id)
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), index=True)
    type: Mapped[str] = mapped_column(String(16), index=True)  # image_gen/video_gen/tts/compose
    state: Mapped[str] = mapped_column(String(16), index=True, default="submitted")
    provider: Mapped[str] = mapped_column(String(32), default="mock")
    provider_task_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    fail_category: Mapped[str | None] = mapped_column(String(32), nullable=True)
    fail_detail: Mapped[str | None] = mapped_column(Text, nullable=True)
    params: Mapped[dict] = mapped_column(JSON, default=dict)
    result: Mapped[dict] = mapped_column(JSON, default=dict)
    consumed_quota: Mapped[float] = mapped_column(Float, default=0)
    source_page: Mapped[str | None] = mapped_column(String(64), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class Clip(Base):
    """视频片段（单条生视频结果，FR-B-04）。"""

    __tablename__ = "clips"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=gen_id)
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), index=True)
    task_id: Mapped[str] = mapped_column(String(36), ForeignKey("tasks.id"), index=True)
    segment_index: Mapped[int] = mapped_column(Integer)
    video_path: Mapped[str] = mapped_column(Text)
    duration_sec: Mapped[float] = mapped_column(Float, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class Template(Base):
    """合成模板（后端预置，FR-C-01）。"""

    __tablename__ = "templates"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=gen_id)
    name: Mapped[str] = mapped_column(String(100))
    style: Mapped[dict] = mapped_column(JSON, default=dict)  # 片头/片尾/字幕样式/BGM
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)


class Composition(Base):
    """合成记录（版本历史，FR-C-04/D-02）。"""

    __tablename__ = "compositions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=gen_id)
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), index=True)
    topic_id: Mapped[str] = mapped_column(String(36), ForeignKey("topics.id"), index=True)
    task_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("tasks.id"), nullable=True)
    template_id: Mapped[str] = mapped_column(String(36), ForeignKey("templates.id"))
    version_no: Mapped[int] = mapped_column(Integer)
    output_path: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(16), default="draft")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
