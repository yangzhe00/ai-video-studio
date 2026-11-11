"""额度服务：预检/扣减/预警（FR-E-03，每用户独立额度）。"""

from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.errors import AppError
from app.models.entities import QuotaLedger, User


def precheck(user: User, cost: float) -> None:
    """提交前额度预检：余额不足抛 402 类业务错误（前端禁用/拦截展示余额）。"""
    if user.quota_balance < cost:
        raise AppError(
            "quota_insufficient",
            f"额度不足：当前余额 {user.quota_balance:g}，本次需要 {cost:g}",
            status_code=422,
        )


def is_low_balance(user: User) -> bool:
    """低于阈值（初始额度 20%）预警判定。"""
    threshold = settings.default_quota * settings.quota_warn_ratio
    return user.quota_balance <= threshold


def deduct(db: Session, user: User, cost: float, task_id: str | None, reason: str) -> None:
    """扣减额度并写账本（预检通过后调用；失败重试不重复扣减）。"""
    if cost <= 0:
        return
    if user.quota_balance < cost:
        raise AppError("quota_insufficient", "额度不足", status_code=422)
    user.quota_balance -= cost
    db.add(
        QuotaLedger(
            user_id=user.id,
            task_id=task_id,
            delta=-cost,
            balance_after=user.quota_balance,
            reason=reason,
        )
    )


def grant(db: Session, user: User, amount: float, reason: str) -> None:
    """发放额度（初始/充值/失败退还）。"""
    user.quota_balance += amount
    db.add(
        QuotaLedger(
            user_id=user.id,
            delta=amount,
            balance_after=user.quota_balance,
            reason=reason,
        )
    )
