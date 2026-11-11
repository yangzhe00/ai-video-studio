"""额度 API（E 域 FR-E-03：余额、明细、预警）。"""

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.db import get_db
from app.core.security import get_current_user
from app.models.entities import QuotaLedger, User

router = APIRouter(prefix="/quota", tags=["quota"])


class LedgerOut(BaseModel):
    id: str
    taskId: str | None
    delta: float
    balanceAfter: float
    reason: str
    createdAt: str


class QuotaOut(BaseModel):
    balance: float
    warn: bool
    warnThreshold: float
    ledger: list[LedgerOut]


@router.get("", response_model=QuotaOut)
def get_quota(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> QuotaOut:
    """额度余额 + 消耗明细（分页）。"""
    rows = (
        db.query(QuotaLedger)
        .filter(QuotaLedger.user_id == user.id)
        .order_by(QuotaLedger.created_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )
    return QuotaOut(
        balance=user.quota_balance,
        warn=user.quota_balance <= settings.default_quota * settings.quota_warn_ratio,
        warnThreshold=settings.default_quota * settings.quota_warn_ratio,
        ledger=[
            LedgerOut(
                id=r.id, taskId=r.task_id, delta=r.delta,
                balanceAfter=r.balance_after, reason=r.reason,
                createdAt=r.created_at.isoformat(),
            )
            for r in rows
        ],
    )
