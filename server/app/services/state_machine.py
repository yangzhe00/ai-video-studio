"""任务状态机（唯一流转入口，与 packages/shared/src/task-state.ts 对齐）。

非法流转抛 AppError，防止绕过状态机直改 DB。
"""

from app.core.errors import AppError
from app.models.entities import Task

# 与前端 TaskTransitions 一致
TRANSITIONS: dict[str, set[str]] = {
    "draft": {"submitted", "voided"},
    "submitted": {"queued"},
    "queued": {"running"},
    "running": {"success", "failed"},
    "failed": {"submitted", "voided"},
    "success": {"used", "voided"},
    "used": {"composed"},
    "composed": {"exported"},
    "exported": set(),
    "voided": set(),
}


def transition(task: Task, to_state: str) -> None:
    """执行状态流转（原地修改 task.state），非法流转抛错。"""
    allowed = TRANSITIONS.get(task.state, set())
    if to_state not in allowed:
        raise AppError(
            "invalid_transition",
            f"非法状态流转: {task.state} → {to_state}",
            status_code=409,
        )
    task.state = to_state
