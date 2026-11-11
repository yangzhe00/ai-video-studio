"""认证 API：手机号+验证码（演示模式 Mock 回显验证码）。"""

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.db import get_db
from app.core.errors import AppError
from app.core.security import create_token, get_current_user
from app.models.entities import SmsCode, User, utcnow
from app.providers import registry
from app.services import quota

router = APIRouter(prefix="/auth", tags=["auth"])
me_router = APIRouter(tags=["auth"])


class SendCodeIn(BaseModel):
    phone: str = Field(pattern=r"^1\d{10}$")


class SendCodeOut(BaseModel):
    demoCode: str


class LoginIn(BaseModel):
    phone: str = Field(pattern=r"^1\d{10}$")
    code: str = Field(min_length=4, max_length=6)


class LoginOut(BaseModel):
    token: str


class MeOut(BaseModel):
    id: str
    phone: str
    quotaBalance: float
    quotaWarn: bool


@router.post("/send-code")
def send_code(body: SendCodeIn, db: Session = Depends(get_db)) -> SendCodeOut:
    """发送验证码：60s 防刷（FR-E-04），Mock 直接回显。"""
    last = (
        db.query(SmsCode)
        .filter(SmsCode.phone == body.phone)
        .order_by(SmsCode.created_at.desc())
        .first()
    )
    if last is not None:
        elapsed = (datetime.now(timezone.utc) - _aware(last.created_at)).total_seconds()
        if elapsed < settings.sms_resend_interval_sec:
            raise AppError("too_frequent", f"请 {int(settings.sms_resend_interval_sec - elapsed)} 秒后再试", 429)

    provider = registry.get_sms_provider()
    code = provider.send_code(body.phone, "")
    db.add(
        SmsCode(
            phone=body.phone,
            code=code,
            expires_at=datetime.now(timezone.utc) + timedelta(seconds=settings.sms_code_ttl_sec),
        )
    )
    db.flush()
    return SendCodeOut(demoCode=code)


@router.post("/login")
def login(body: LoginIn, db: Session = Depends(get_db)) -> LoginOut:
    """校验验证码并签发 JWT；新手机号自动建账号并发放初始额度。"""
    record = (
        db.query(SmsCode)
        .filter(SmsCode.phone == body.phone, SmsCode.code == body.code, SmsCode.used.is_(False))
        .order_by(SmsCode.created_at.desc())
        .first()
    )
    if record is None:
        raise AppError("invalid_code", "验证码错误")
    if _aware(record.expires_at) < datetime.now(timezone.utc):
        raise AppError("code_expired", "验证码已过期，请重新获取")

    record.used = True
    user = db.query(User).filter(User.phone == body.phone).first()
    if user is None:
        user = User(phone=body.phone, quota_balance=0)
        db.add(user)
        db.flush()
        quota.grant(db, user, settings.default_quota, "新用户初始额度")
    db.flush()
    return LoginOut(token=create_token(user.id))


@me_router.get("/me")
def me(user: User = Depends(get_current_user)) -> MeOut:
    """当前用户信息与额度余额（含 20% 预警标记）。"""
    return MeOut(
        id=user.id,
        phone=user.phone,
        quotaBalance=user.quota_balance,
        quotaWarn=quota.is_low_balance(user),
    )


def _aware(dt: datetime) -> datetime:
    """兼容 sqlite 返回的 naive datetime。"""
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
