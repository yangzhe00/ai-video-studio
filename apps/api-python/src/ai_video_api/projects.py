from __future__ import annotations

import json
from typing import Any

from ai_video_api.db import Database
from ai_video_api.errors import ApiError


def project_summary(row: dict[str, Any]) -> dict[str, Any]:
    document = json.loads(row["document_json"])
    episodes = document.get("episodes", [])
    recent = next((entry for entry in episodes if entry.get("id") == row["recent_episode_id"]), None)
    if recent is None and episodes:
        recent = episodes[0]
    return {
        "id": row["id"], "title": row["title"], "revision": row["revision"],
        "updatedAt": row["updated_at"],
        "recentEpisode": {"id": recent["id"], "title": recent["title"],
                          "shotCount": len(recent.get("shots") or [])} if recent else None,
    }


async def list_projects(db: Database, account_id: str) -> list[dict[str, Any]]:
    rows = await db.fetch_all("SELECT id,title,revision,updated_at,recent_episode_id,document_json FROM projects WHERE owner_id=%s ORDER BY updated_at DESC,created_at DESC", account_id)
    return [project_summary(row) for row in rows]


async def resource_revisions(db: Database, project_id: str) -> list[dict[str, Any]]:
    rows = await db.fetch_all("SELECT resource_type,resource_id,revision FROM resource_revisions WHERE project_id=%s", project_id)
    return [{"resourceType": row["resource_type"], "resourceId": row["resource_id"],
             "revision": row["revision"]} for row in rows]


async def get_project(db: Database, account_id: str, project_id: str) -> dict[str, Any]:
    row = await db.fetch_one("SELECT id,title,revision,updated_at,recent_episode_id,document_json FROM projects WHERE id=%s AND owner_id=%s", project_id, account_id)
    if row is None:
        raise ApiError(404, "项目不存在")
    return {**project_summary(row), "document": json.loads(row["document_json"]),
            "resourceRevisions": await resource_revisions(db, project_id)}
