import json

import pytest

from ai_video_api.errors import ApiError
from ai_video_api.projects import get_project, list_projects, project_summary


class FakeProjectsDb:
    async def fetch_all(self, sql, *values):
        if "resource_revisions" in sql:
            return [{"resource_type": "episode", "resource_id": "episode-1", "revision": 2}]
        assert values == ("owner-1",)
        return [ROW]

    async def fetch_one(self, sql, *values):
        if values == ("project-1", "owner-1"):
            return ROW
        return None


ROW = {
    "id": "project-1", "owner_id": "owner-1", "title": "示例", "revision": 2,
    "updated_at": 1000, "recent_episode_id": "episode-1",
    "document_json": json.dumps({"version": 1, "episodes": [{"id": "episode-1", "title": "第 1 集", "shots": [{"id": "shot-1"}]}], "assets": [], "characters": []}),
}


def test_project_summary_matches_node_shape():
    assert project_summary(ROW) == {"id": "project-1", "title": "示例", "revision": 2,
                                    "updatedAt": 1000, "recentEpisode": {"id": "episode-1", "title": "第 1 集", "shotCount": 1}}


@pytest.mark.asyncio
async def test_project_reads_are_owner_scoped():
    db = FakeProjectsDb()
    assert (await list_projects(db, "owner-1"))[0]["id"] == "project-1"
    project = await get_project(db, "owner-1", "project-1")
    assert project["resourceRevisions"] == [{"resourceType": "episode", "resourceId": "episode-1", "revision": 2}]
    with pytest.raises(ApiError) as error:
        await get_project(db, "owner-2", "project-1")
    assert error.value.status == 404
