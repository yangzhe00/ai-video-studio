# Cursor Cloud Agent Inspiration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let one idea request create a Cursor Cloud Agent and return three validated 5–10 second single-shot scripts.

**Architecture:** Add a Cursor provider adapter that uses `POST /v1/agents`, `GET /v1/agents/{id}`, and `GET /v1/agents/{id}/runs/{runId}`. Persist both provider IDs in SQLite and reuse the existing idea worker, state transitions, and validator.

**Tech Stack:** TypeScript, Node fetch, SQLite, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-29-idea-cursor-cloud-agent-design.md`

## Global Constraints

- Credentials stay on the API server.
- No duplicate create request after an uncertain response.
- The three-variant response shape and account limits stay unchanged.
- Do not overwrite unrelated worktree changes.

## Review Focus

- No key: return `not_configured` without external request.
- Lost create response: recover by deterministic Cursor agent ID.
- Terminal error/cancellation: never mark as ready.
- Finished malformed JSON or repeated prompts: reject through shared validator.
- API timeout or 429: leave the request recoverable, without submitting twice.

---

### Task 1: Cursor protocol adapter

**Files:** Create `apps/api/src/idea-cursor.ts`; test `apps/api/src/idea-cursor.test.ts`.

**Interfaces:** `createIdeaCursorRun(config,input,ideaSetId,fetcher)` returns agent and run IDs. `readIdeaCursorRun(config,agentId,runId,fetcher)` returns pending or validated ready result.

- [x] Write protocol tests for create, model omission/selection, run states, malformed result, missing key, and transport uncertainty.
- [x] Implement bounded authenticated JSON requests and strict Cursor endpoint validation.
- [x] Run the focused tests.

### Task 2: Durable provider routing

**Files:** Modify `apps/api/src/config.ts`, `apps/api/src/db.ts`, `apps/api/src/prompt-ideas.ts`, `apps/api/src/idea-agent-worker.ts`, `apps/api/src/server.ts`; test `apps/api/src/db.test.ts`, `apps/api/src/idea-cursor.test.ts`.

**Interfaces:** `IDEA_PROVIDER=cursor`, `CURSOR_API_KEY`, optional `IDEA_CURSOR_MODEL`; database v9 adds `provider_run_id`.

- [x] Write tests for replay, restart recovery, and v8-to-v9 migration.
- [x] Route Cursor creates and poll persisted runs without new creates.
- [x] Run API tests, TypeScript build, and boundary check.

### Task 3: Server deployment and key handoff

**Files:** Modify `.env.example` and `README.draft.md`; deploy only relevant API files to a new server release.

- [x] Document where to place the server-only Cursor key.
- [x] Back up the production database and deploy the tested release.
- [x] Verify health and use authenticated `GET /v1/models` after the operator installs the key.
