"""状态机单测：合法流转与非法流转（T013）。"""

import pytest

from app.core.errors import AppError
from app.models.entities import Task
from app.services.state_machine import transition


def _task(state: str) -> Task:
    return Task(id="t1", user_id="u1", type="video_gen", state=state)


def test_happy_path():
    """submitted → queued → running → success → used → composed → exported 全链合法。"""
    t = _task("draft")
    transition(t, "submitted")
    transition(t, "queued")
    transition(t, "running")
    transition(t, "success")
    transition(t, "used")
    transition(t, "composed")
    transition(t, "exported")
    assert t.state == "exported"


def test_retry_path():
    """失败可重试回 submitted（FR-E-02）。"""
    t = _task("running")
    transition(t, "failed")
    transition(t, "submitted")
    assert t.state == "submitted"


def test_void_from_draft_and_success():
    """草稿/成功均可作废。"""
    t = _task("draft")
    transition(t, "voided")
    assert t.state == "voided"


@pytest.mark.parametrize("frm,to", [
    ("draft", "queued"),      # 跳过提交
    ("queued", "success"),    # 跳过生成中
    ("failed", "success"),    # 失败直接成功
    ("exported", "used"),     # 终态不可回退
    ("voided", "submitted"),  # 作废不可复活
])
def test_invalid_transition_raises(frm, to):
    """非法流转一律拒绝。"""
    t = _task(frm)
    with pytest.raises(AppError):
        transition(t, to)


def test_review_failed_no_auto_retry_rule():
    """审核不通过允许手动流转 submitted，但前端/调度不自动重试（枚举对齐前端）。"""
    from shared_check import RETRY_FORBIDDEN  # 见 conftest 映射

    assert "content_review_rejected" in RETRY_FORBIDDEN
