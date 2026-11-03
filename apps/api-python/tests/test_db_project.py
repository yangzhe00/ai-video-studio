import os
import time
from uuid import uuid4

import pytest

from ai_video_api.db import Database
from ai_video_api.errors import ApiError
from ai_video_api.project_create import create_project
from ai_video_api.projects import list_projects


@pytest.mark.asyncio
async def test_existing_schema_project_create_replay_and_brief_scope():
    url = os.environ.get("PG_SCHEMA4_TEST_URL")
    if not url:
        pytest.skip("PG_SCHEMA4_TEST_URL requires an isolated schema-4 database")
    db = Database(url)
    await db.open()
    try:
        account_id = str(uuid4())
        await db.execute("INSERT INTO accounts (id,email,password_hash,created_at,demo_quota) VALUES (%s,%s,%s,%s,%s)",
                         account_id, f"{account_id}@example.test", "test-hash", int(time.time() * 1000), 3)
        brief = {"id": str(uuid4()), "source": "manual", "originalText": "一只小狗", "finalText": "一只小狗在厨房",
                 "createdAt": 1, "updatedAt": 1}
        body = {"id": str(uuid4()), "title": "测试项目", "initialEpisodeId": str(uuid4()), "initialBrief": brief}
        project, replayed = await create_project(db, account_id, body)
        assert not replayed
        assert project["document"]["briefs"] == [brief]
        assert {entry["resourceType"] for entry in project["resourceRevisions"]} == {"episode", "brief"}
        assert (await list_projects(db, account_id))[0]["id"] == body["id"]
        second, replayed = await create_project(db, account_id, body)
        assert replayed and second["id"] == project["id"]
        with pytest.raises(ApiError) as conflict:
            await create_project(db, account_id, {**body, "title": "其他名称"})
        assert conflict.value.status == 409
        agent_brief = {**brief, "id": str(uuid4()), "source": "agent", "ideaSetId": str(uuid4()), "variantId": str(uuid4())}
        with pytest.raises(ApiError) as unauthorized:
            await create_project(db, account_id, {"id": str(uuid4()), "title": "不合法灵感", "initialBrief": agent_brief})
        assert unauthorized.value.status == 400
    finally:
        await db.close()
