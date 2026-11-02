# Cursor Inspiration Six-Script Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep Cursor as the only inspiration provider and let one keyword yield three scripts plus one explicit batch of three more, durably capped at six.

**Architecture:** Store each Cursor call as an idempotent `prompt_idea_sets` row. A second row links to the first; root reads aggregate both rows into one `PromptIdeaSet`, while the worker continues to reconcile paid Cursor runs. Shared Web/Desktop UI calls the expansion endpoint and displays the root snapshot.

**Tech Stack:** Node 24, TypeScript, PostgreSQL, Zod, React 19, pnpm.

**Spec:** `docs/superpowers/specs/2026-11-02-cursor-idea-six-design.md`

## Global Constraints

- Maximum six scripts per root idea: three initial, three additional.
- Cursor Cloud Agents is the only provider for new inspiration requests.
- Preserve old completed records and separate Agent edit functionality.
- Persist paid request intent before calling Cursor; never automatically resubmit an uncertain POST.
- Do not expose credentials to clients or logs.

## Review Focus

- A second click while expansion is pending replays the same request, with one Cursor POST; Task 2 test.
- An expansion failure leaves the initial three selectable; Task 2 and Task 3 tests.
- A second successful expansion request returns conflict without a Cursor POST; Task 2 test.
- Results from another account never appear in the root snapshot; Task 2 test.
- Duplicate prompts across batches fail the expansion without replacing the initial three; Task 2 test.

---

### Task 1: PostgreSQL schema and shared protocol

**Files:** Modify `apps/api/src/db.ts`, `apps/api/src/schema.sql`, `apps/api/src/postgres-db.test.ts`, `packages/api-contracts/src/requests.ts`, `packages/api-contracts/src/responses.ts`; create `apps/api/src/schema-v4.sql`.

**Interfaces:** Add nullable `parent_idea_set_id` to `prompt_idea_sets`, a partial unique index allowing at most one nonfailed expansion per parent, and schema version 4. `PromptIdeaSet` gains nullable `expansionState`, `expansionError`, `expansionClientRequestId`. New request contract: `POST /prompt-ideas/:id/more` with `{clientRequestId}`.

- [ ] Write migration and contract tests for schema 3→4, request validation and the new response fields.
- [ ] Run the focused tests and verify they fail for the intended missing behavior.
- [ ] Implement schema v4, migrate/boot version handling, legacy pending-provider reconciliation and Zod schemas.
- [ ] Run the focused tests and verify they pass.

### Task 2: Cursor-only inspiration and expansion

**Files:** Modify `apps/api/src/prompt-ideas.ts`, `apps/api/src/idea-agent-worker.ts`, `apps/api/src/idea-cursor.ts`, `apps/api/src/server.ts`, `apps/api/src/idea-cursor.test.ts`, `apps/api/src/prompt-ideas.test.ts`; extract Cursor result parsing from `apps/api/src/idea-model.ts` to `apps/api/src/idea-result.ts`.

**Interfaces:** `createPromptIdea(db, ownerId, config, body)` always creates a Cursor root. `createMorePromptIdeas(db, ownerId, config, rootId, body)` returns the aggregated root snapshot and `replayed`. Root `getPromptIdea` and `listPromptIdeas` aggregate one linked expansion. Cursor creation accepts optional previous scripts to request distinct alternatives; the worker assigns `variant-4` through `variant-6` and rejects cross-batch duplicates. `POST /prompt-ideas/:id/more` routes through the same cost rate gate.

- [ ] Add focused tests for first/second batch, idempotency, 6-script cap, owner isolation, duplicate output, failure/retry and uncertain recovery.
- [ ] Run the focused tests and verify the new cases fail.
- [ ] Implement root aggregation, expansion reservation, Cursor prompt context, worker reconciliation and route.
- [ ] Run the focused tests and verify they pass.

### Task 3: Shared Web/Desktop interaction

**Files:** Modify `packages/ui-web/src/PromptIdeas.tsx`, `packages/ui-web/src/PromptIdeas.test.tsx`, `apps/web/src/App.tsx`, `apps/desktop/src/App.tsx`, `packages/ui-web/src/styles.css` only if layout requires it.

**Interfaces:** `PromptIdeas` gains `onMore(id, clientRequestId)`. The root snapshot stays visible during expansion, and hosts poll while either generation is pending. The component persists an expansion request ID until it observes the corresponding server snapshot; the second batch is disabled after six scripts.

- [ ] Add UI tests for the new button, three→six cards, pending/error states, request-ID recovery and six-script limit.
- [ ] Run the focused UI tests and verify they fail.
- [ ] Implement the shared component and the two host callbacks/polling conditions.
- [ ] Run UI tests and Web/Desktop builds.

### Task 4: Remove unused inspiration adapters and update docs

**Files:** Delete `apps/api/src/idea-agents.ts`, `apps/api/src/idea-agents.test.ts`, the Chat Completions generation code/tests in `apps/api/src/idea-model.ts` and `apps/api/src/idea-model.test.ts`; modify `apps/api/src/config.ts`, `apps/api/src/agent-edit-provider.ts`, `apps/api/src/agent-edit.ts`, `.env.example`, `.codex/.agent/api.md`, and migration verification scripts/docs that require schema 3.

**Interfaces:** `ApiConfig` exposes only Cursor inspiration settings; Agent edit uses only `AGENT_EDIT_MODEL_*` and keeps its existing Chat Completions behavior.

- [ ] Update tests that relied on the old default `chat` provider and add a guard for missing dedicated Agent edit configuration.
- [ ] Remove unused provider switch/config/imports and update deployment and architecture documentation.
- [ ] Run API tests/build, shared UI tests/build, boundary check, `git diff --check`, and inspect the diff for unrelated edits.

## Execution

Implement natively in this session. Do not commit or deploy without checking pre-existing worktree changes and the production schema migration gate.

## Implementation record (2026-11-02)

Implemented the schema 4 migration, shared API contract, Cursor-only creation and reconciliation, one linked expansion batch, and shared Web/Desktop controls. The API suite passed serially against an isolated local PostgreSQL 14 instance (22 files, 90 tests); a later added Agent edit configuration guard passed separately (1). Focused shared UI tests passed (10), shared contract tests passed (7), Web App tests passed (28), and Desktop App tests passed (19). API/contracts/UI typechecks, Web/Desktop production builds, workspace boundary check, and `git diff --check` passed. The local test database was removed. Production was not migrated or deployed; release still requires the schema 1→4 rehearsal in `deploy/postgres/schema1-to4.md` and real Cursor acceptance.
