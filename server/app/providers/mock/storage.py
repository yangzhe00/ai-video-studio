"""本地磁盘存储 Provider（constitution：本地起步，预留 S3/OSS 同接口）。"""

import os
import shutil
from pathlib import Path

from app.core.config import settings

# 服务端根目录（server/），相对 storage_dir 以此为基准，保证 ffmpeg 拿到绝对路径
SERVER_ROOT = Path(__file__).resolve().parents[3]


class LocalStorageProvider:
    name = "local_disk"

    def _abs(self, key: str) -> str:
        """存储 key → 绝对路径（禁止路径穿越）。"""
        base = Path(settings.storage_dir)
        if not base.is_absolute():
            base = SERVER_ROOT / base
        safe = os.path.normpath(key).lstrip("/")
        if safe.startswith(".."):
            raise ValueError(f"非法存储 key: {key}")
        return str(base / safe)

    def save(self, key: str, data: bytes, content_type: str = "application/octet-stream") -> str:
        """保存文件到本地磁盘，返回 key。"""
        _ = content_type  # 本地存储按扩展名保存，无需 content type
        path = self._abs(key)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "wb") as f:
            f.write(data)
        return key

    def open(self, key: str) -> bytes:
        """读取文件。"""
        with open(self._abs(key), "rb") as f:
            return f.read()

    def delete(self, key: str) -> None:
        """删除文件。"""
        path = self._abs(key)
        if os.path.isdir(path):
            shutil.rmtree(path)
        elif os.path.exists(path):
            os.remove(path)

    def local_path(self, key: str) -> str:
        """返回本地绝对路径（ffmpeg 合成需要真实文件路径）。"""
        return self._abs(key)
