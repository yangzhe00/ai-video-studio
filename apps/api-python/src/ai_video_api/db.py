from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from contextvars import ContextVar
from typing import Any

from psycopg import AsyncConnection
from psycopg.rows import dict_row
from psycopg_pool import AsyncConnectionPool


class Database:
    def __init__(self, url: str):
        self.pool = AsyncConnectionPool(url, min_size=1, max_size=10, timeout=5,
                                        open=False, kwargs={"row_factory": dict_row})
        self._transaction_connection: ContextVar[AsyncConnection[Any] | None] = ContextVar("transaction_connection", default=None)

    async def open(self) -> None:
        await self.pool.open()
        await self.pool.wait()
        row = await self.fetch_one("SELECT version FROM api_schema_version LIMIT 1")
        if row is None or row["version"] != 4:
            await self.pool.close()
            raise RuntimeError("Unsupported or missing PostgreSQL schema version")

    async def close(self) -> None:
        await self.pool.close()

    @asynccontextmanager
    async def _connection(self) -> AsyncIterator[AsyncConnection[Any]]:
        current = self._transaction_connection.get()
        if current is not None:
            yield current
        else:
            async with self.pool.connection() as connection:
                yield connection

    async def fetch_one(self, sql: str, *values: object) -> dict[str, Any] | None:
        async with self._connection() as connection:
            cursor = await connection.execute(sql, values)
            return await cursor.fetchone()

    async def fetch_all(self, sql: str, *values: object) -> list[dict[str, Any]]:
        async with self._connection() as connection:
            cursor = await connection.execute(sql, values)
            return await cursor.fetchall()

    async def execute(self, sql: str, *values: object) -> int:
        async with self._connection() as connection:
            cursor = await connection.execute(sql, values)
            return cursor.rowcount

    @asynccontextmanager
    async def transaction(self) -> AsyncIterator[None]:
        if self._transaction_connection.get() is not None:
            yield
            return
        async with self.pool.connection() as connection:
            async with connection.transaction():
                token = self._transaction_connection.set(connection)
                try:
                    yield
                finally:
                    self._transaction_connection.reset(token)

    async def advisory_lock(self, key: str) -> None:
        if self._transaction_connection.get() is None:
            raise RuntimeError("Advisory lock requires a transaction")
        await self.fetch_one("SELECT pg_advisory_xact_lock(hashtext(%s))", key)
