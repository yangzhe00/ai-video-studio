import os

import psycopg
import pytest

from ai_video_api.db import Database


@pytest.mark.asyncio
async def test_schema_gate_and_transaction_rollback():
    url = os.environ.get("PG_TEST_URL")
    if not url:
        pytest.skip("PG_TEST_URL is required for isolated PostgreSQL integration")
    async with await psycopg.AsyncConnection.connect(url) as setup:
        await setup.execute("DROP TABLE IF EXISTS python_migration_probe")
        await setup.execute("DROP TABLE IF EXISTS api_schema_version")
        await setup.execute("CREATE TABLE api_schema_version (version BIGINT NOT NULL)")
        await setup.execute("INSERT INTO api_schema_version (version) VALUES (4)")
        await setup.execute("CREATE TABLE python_migration_probe (id INTEGER PRIMARY KEY)")

    db = Database(url)
    await db.open()
    try:
        assert (await db.fetch_one("SELECT version FROM api_schema_version"))["version"] == 4
        with pytest.raises(RuntimeError, match="boom"):
            async with db.transaction():
                await db.advisory_lock("python-migration-probe")
                await db.execute("INSERT INTO python_migration_probe (id) VALUES (%s)", 1)
                raise RuntimeError("boom")
        assert await db.fetch_one("SELECT id FROM python_migration_probe WHERE id=%s", 1) is None
        async with db.transaction():
            await db.execute("INSERT INTO python_migration_probe (id) VALUES (%s)", 2)
        assert (await db.fetch_one("SELECT id FROM python_migration_probe WHERE id=%s", 2))["id"] == 2
    finally:
        await db.close()

    async with await psycopg.AsyncConnection.connect(url) as setup:
        await setup.execute("UPDATE api_schema_version SET version=99")
    incompatible = Database(url)
    with pytest.raises(RuntimeError, match="schema version"):
        await incompatible.open()
