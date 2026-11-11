"""额度服务单测：预检/扣减/预警（T013，FR-E-03）。"""

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.core.errors import AppError
from app.models.entities import Base, User
from app.services import quota


@pytest.fixture()
def db():
    """内存库会话。"""
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    s = sessionmaker(bind=engine)()
    yield s
    s.close()


def _user(balance: float) -> User:
    return User(id="u1", phone="13800000000", quota_balance=balance)


def test_precheck_pass_and_fail(db):
    """余额充足放行，不足抛业务错误并带余额信息。"""
    u = _user(50)
    quota.precheck(u, 20)  # 不抛
    with pytest.raises(AppError) as e:
        quota.precheck(_user(10), 20)
    assert "额度不足" in e.value.message


def test_deduct_writes_ledger(db):
    """扣减落账本且余额递减。"""
    db.add(u := _user(100))
    db.commit()
    quota.deduct(db, u, 20, task_id=None, reason="提交生视频")
    db.commit()
    assert u.quota_balance == pytest.approx(80)
    from app.models.entities import QuotaLedger

    rows = db.query(QuotaLedger).all()
    assert len(rows) == 1 and rows[0].delta == pytest.approx(-20)


def test_deduct_insufficient_blocked(db):
    """扣减时余额不足直接拒绝（双重防线）。"""
    db.add(u := _user(5))
    db.commit()
    with pytest.raises(AppError):
        quota.deduct(db, u, 20, task_id=None, reason="x")


def test_refund_on_failure(db):
    """失败退还额度（worker 失败分支行为）。"""
    db.add(u := _user(100))
    db.commit()
    quota.deduct(db, u, 20, task_id=None, reason="预扣")
    quota.grant(db, u, 20, "失败退还")
    db.commit()
    assert u.quota_balance == pytest.approx(100)


def test_low_balance_warning():
    """余额 ≤ 初始额度 20% 触发预警（ constitution 数值）。"""
    assert quota.is_low_balance(_user(201)) is False
    assert quota.is_low_balance(_user(200)) is True
    assert quota.is_low_balance(_user(50)) is True
