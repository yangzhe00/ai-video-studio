"""pytest 共享配置：把 packages/shared 的枚举映射进服务端测试。"""

import json
import pathlib

_SHARED = pathlib.Path(__file__).resolve().parents[2] / "packages" / "shared" / "src"

RETRY_FORBIDDEN = ["content_review_rejected"]

def read_shared_ts(name: str) -> str:
    """读取 shared 包 TS 源码（测试校验前后端枚举一致性用）。"""
    return (_SHARED / name).read_text(encoding="utf-8")


def shared_contains(name: str, needle: str) -> bool:
    """校验 shared TS 文件包含指定枚举值（防前后端状态机漂移）。"""
    return needle in read_shared_ts(name)
