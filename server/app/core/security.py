"""鉴权与行级隔离（constitution：行级数据隔离服务端强制）。"""

from datetime import datetime, timedelta, timezone

import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.db import get_db
from app.models.entities import User

bearer = HTTPBearer(auto_error=False)


def create_token(user_id: str) -> str:
    """签发 JWT（含过期时间）。"""
    payload = {
        "sub": user_id,
        "exp": datetime.now(timezone.utc) + timedelta(hours=settings.jwt_expire_hours),
    }
    return jwt.encode(payload, settings.secret_key, algorithm="HS256")


def get_current_user(
    cred: HTTPAuthorizationCredentials | None = Depends(bearer),
    db: Session = Depends(get_db),
) -> User:
    """解析 Bearer Token 并返回当前用户（未登录 401）。"""
    if cred is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "未登录")
    try:
        payload = jwt.decode(cred.credentials, settings.secret_key, algorithms=["HS256"])
    except jwt.ExpiredSignatureError as err:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "会话已过期") from err
    except jwt.InvalidTokenError as err:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "无效令牌") from err

    user = db.get(User, payload["sub"])
    if user is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "用户不存在")
    return user


def ensure_owner(user: User, owner_id: str) -> None:
    """行级隔离断言：非本人资源一律 404（不泄露存在性）。"""
    if user.id != owner_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "资源不存在")
