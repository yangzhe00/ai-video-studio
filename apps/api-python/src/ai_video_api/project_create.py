from __future__ import annotations

import hashlib
import json
import re
import time
from typing import Any
from uuid import uuid4

from ai_video_api.db import Database
from ai_video_api.errors import ApiError
from ai_video_api.projects import get_project

ID_PATTERN = re.compile(r"^[a-zA-Z0-9-]{8,80}$")
BRIEF_ID_PATTERN = re.compile(r"^[a-zA-Z0-9_-]{8,80}$")


def _json(value: object) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def _valid_id(value: object, *, brief: bool = False) -> bool:
    return isinstance(value, str) and bool((BRIEF_ID_PATTERN if brief else ID_PATTERN).fullmatch(value))


def parse_creation_brief(value: object) -> dict[str, Any]:
    if not isinstance(value, dict) or not _valid_id(value.get("id"), brief=True) or value.get("source") not in ("manual", "agent"):
        raise ApiError(400, "创作原文标识或来源无效")
    for field, label in (("originalText", "输入原文"), ("finalText", "最终创作内容")):
        text = value.get(field)
        if not isinstance(text, str) or not text.strip() or len(text) > 10_000:
            raise ApiError(400, f"{label}长度需为 1 到 10000 字")
    created, updated = value.get("createdAt"), value.get("updatedAt")
    if not isinstance(created, int) or isinstance(created, bool) or created < 0 or not isinstance(updated, int) or isinstance(updated, bool) or updated < created:
        raise ApiError(400, "创作原文时间无效")
    if value["source"] == "agent":
        if not _valid_id(value.get("ideaSetId"), brief=True) or not _valid_id(value.get("variantId"), brief=True):
            raise ApiError(400, "Agent 灵感来源无效")
    elif "ideaSetId" in value or "variantId" in value:
        raise ApiError(400, "手写原文不能关联 Agent 灵感")
    return {"id": value["id"], "source": value["source"], "originalText": value["originalText"],
            "finalText": value["finalText"],
            **({"ideaSetId": value["ideaSetId"], "variantId": value["variantId"]} if value["source"] == "agent" else {}),
            "createdAt": created, "updatedAt": updated}


async def _assert_initial_agent_brief(db: Database, account_id: str, brief: dict[str, Any]) -> None:
    if brief["source"] != "agent":
        return
    row = await db.fetch_one("SELECT input_text,state,selected_variant_id,edited_prompt FROM prompt_idea_sets WHERE id=%s AND owner_id=%s", brief["ideaSetId"], account_id)
    if not row or row["state"] != "ready" or row["selected_variant_id"] != brief["variantId"] or row["input_text"] != brief["originalText"] or row["edited_prompt"] != brief["finalText"]:
        raise ApiError(400, "Agent 创作原文须来自本账号已选定并保存的灵感")


async def create_project(db: Database, account_id: str, body: dict[str, object]) -> tuple[dict[str, Any], bool]:
    title = body.get("title")
    title = title.strip() if isinstance(title, str) else ""
    if not title or len(title) > 50 or title in (".", "..") or "/" in title or "\\" in title:
        raise ApiError(400, "项目名称无效")
    if "id" in body and not _valid_id(body["id"]):
        raise ApiError(400, "项目 ID 无效")
    if "initialEpisodeId" in body and not _valid_id(body["initialEpisodeId"]):
        raise ApiError(400, "分集 ID 无效")
    project_id = body.get("id") or str(uuid4())
    episode_id = body.get("initialEpisodeId") or str(uuid4())
    brief = parse_creation_brief(body["initialBrief"]) if "initialBrief" in body else None
    creation_payload = {"id": project_id, "title": title,
                        "initialEpisodeId": body.get("initialEpisodeId"), "initialBrief": brief}
    creation_hash = hashlib.sha256(_json(creation_payload).encode()).hexdigest()
    document = {"version": 1, "episodes": [{"id": episode_id, "title": "第 1 集", "shots": [], "timeline": []}],
                "assets": [], "characters": [], "briefs": [brief] if brief else []}
    replayed = False
    async with db.transaction():
        await db.advisory_lock(f"project-create:{project_id}")
        existing = await db.fetch_one("SELECT owner_id,creation_hash FROM projects WHERE id=%s", project_id)
        if existing:
            if existing["owner_id"] != account_id or existing["creation_hash"] != creation_hash:
                raise ApiError(409, "项目 ID 已用于其他创建内容")
            replayed = True
        else:
            if brief:
                await _assert_initial_agent_brief(db, account_id, brief)
            now = int(time.time() * 1000)
            await db.execute("INSERT INTO projects (id,owner_id,title,revision,document_json,created_at,updated_at,recent_episode_id,creation_hash) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)",
                             project_id, account_id, title, 1, _json(document), now, now, episode_id, creation_hash)
            await db.execute("INSERT INTO resource_revisions (project_id,resource_type,resource_id,revision) VALUES (%s,%s,%s,1)", project_id, "episode", episode_id)
            if brief:
                await db.execute("INSERT INTO resource_revisions (project_id,resource_type,resource_id,revision) VALUES (%s,%s,%s,1)", project_id, "brief", brief["id"])
    return await get_project(db, account_id, project_id), replayed
