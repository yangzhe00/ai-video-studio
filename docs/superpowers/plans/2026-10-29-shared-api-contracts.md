# Shared API Contracts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Audit existing JSON API boundaries and establish `@ai-video/api-contracts` as the shared request, response, and error-code package consumed by the API and all three clients.

**Architecture:** Keep `@ai-video/project-schema` responsible for persisted project DSL and `@ai-video/project-core` for domain rules. The new package composes those types into transport envelopes, validates external JSON, and defines stable error codes without changing successful wire payloads. Binary uploads and SSE remain separate media/event protocols.

**Tech Stack:** pnpm workspace, TypeScript, Zod 3, Node HTTP, React/Tauri/Expo, Vitest.

**Spec:** User request in the architecture chat, 2026-10-29; see `.codex/.agent/cli_all.md` for project boundaries.

## Global Constraints

- Preserve existing URL paths, success statuses, cookies, project revisions, request IDs, approval IDs, and paid-operation recovery semantics.
- Do not put provider keys, local file paths, or object bytes in JSON contracts.
- Keep `project-schema` independent from HTTP transport and avoid package dependency cycles.
- Maintain old error `error` text while adding stable optional `code` for backward compatibility.

## Review Focus

- Invalid request fields return 400 before side effects; unchanged retry IDs still replay the original operation.
- Old servers without `code` remain readable by all clients.
- A 409 project conflict retains the `conflict` snapshot.
- Unknown/higher project DSL versions fail validation without rewriting data.
- Upload bytes and SSE streams bypass JSON parsing.

---

### Task 1: Inventory and transport contract package

**Files:** Create `docs/architecture/api-contract-audit.md`, `packages/api-contracts/package.json`, `packages/api-contracts/src/{index,requests,responses,errors}.ts`, `packages/api-contracts/src/contracts.test.ts`; modify `pnpm-lock.yaml`.

**Interfaces:** `parseApiRequest(method,path,raw)`, `parseApiResponse(raw)`, `parseApiError(raw,status)`, `errorCodeForStatus(status)`; public DTO types and Zod schemas for auth, ideas, projects, runs, edits, and their envelopes.

- [x] Record each route's method, request, response, current producer and consumers; separate JSON, media bytes, and SSE.
- [x] Write tests for valid/invalid bodies, nested project/run envelopes, legacy error bodies, conflict snapshots, and unsupported DSL version.
- [x] Implement schemas and exports with no app imports; verify `pnpm --filter @ai-video/api-contracts test` and `build`.

### Task 2: Integrate producers and consumers

**Files:** Modify `apps/api/package.json`, `apps/api/src/server.ts`, `apps/web/package.json`, `apps/web/src/api.ts`, `apps/desktop/package.json`, `apps/desktop/src/lib/cloud.ts`, `apps/mobile/package.json`, `apps/mobile/src/api.ts`, `scripts/check-boundaries.mjs`, existing API/client tests.

**Interfaces:** Server validates JSON bodies at the HTTP edge and emits coded errors; clients parse shared response envelopes and legacy-compatible error bodies.

- [x] Add focused API tests for malformed bodies, code/status mapping, 409 conflict snapshots and replay behavior.
- [x] Wire shared request parser and error response at the API boundary without altering domain checks or SSE/binary routes.
- [x] Wire shared response/error parsing into Web, desktop, and mobile adapters; preserve current public adapter signatures.
- [x] Run package, API and affected client tests/builds; run boundary check and `git diff --check`.

### Task 3: Documentation and external regression handoff

**Files:** Modify `.codex/.agent/api.md`; create `docs/acceptance/2026-10-29-api-contracts-regression-scope.md`.

**Interfaces:** A concrete test matrix with account isolation, three scripts, project commands/conflict, run confirmation/recovery, edits/render, upload, SSE, web/desktop/mobile boundaries and required screenshots.

- [x] Document the new package and API/SDK boundaries, protocol versioning and rollout compatibility.
- [x] Send the regression scope to the existing “测试” chat with explicit authorization from the user; ask it to attach or save screenshot evidence.
- [x] Review the returned test status and screenshots; report unresolved items without claiming acceptance from unit tests alone.
