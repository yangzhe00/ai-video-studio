# Idea Agents API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Connect account-scoped three-script inspiration to the Codex Agents API with server-only credentials and recoverable sessions.

**Architecture:** Keep Chat Completions as the existing provider. An explicit provider switch routes new idea sets to an Agents API adapter. Persist each session ID and reconcile pending rows using session turns and saved final messages.

**Tech Stack:** Node 24 native fetch, TypeScript, SQLite, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-29-idea-agents-api-design.md`

## Global Constraints

- No credentials in Git, browser bundles, logs, or chat.
- Preserve `POST /prompt-ideas` and existing `{variants:[{id,title,description,prompt}]}` contract.
- No video credit consumption or automatic video generation.
- Do not commit unrelated dirty workspace files.

## Review Focus

- Lost create response with no session ID must not automatically resubmit.
- Session `idle` alone must not count as a successful turn.
- Recovery after process restart must not create a second session.
- Model output must have exactly three distinct valid variants.
- A missing/invalid key must show configuration or provider failure without exposing the key.

---

### Task 1: Agents transport and validation

**Files:** Create `apps/api/src/idea-agents.ts`; modify `apps/api/src/config.ts`, `apps/api/src/idea-model.ts`; test `apps/api/src/idea-agents.test.ts`.

**Interfaces:** `createIdeaAgentSession(config,input,ideaSetId,fetcher?)` returns session ID; `readIdeaAgentSession(config,sessionId,fetcher?)` returns pending, ready result, or typed error.

- [x] Write mock HTTP tests for request shape, JSON output, turn completion, and malformed output.
- [x] Run the focused test and check its results.
- [x] Implement the adapter and configuration using native fetch.
- [x] Run the focused test and `pnpm --filter @ai-video/api build`.

### Task 2: Durable idea lifecycle

**Files:** Modify `apps/api/src/db.ts`, `apps/api/src/prompt-ideas.ts`, `apps/api/src/server.ts`; create `apps/api/src/idea-agent-worker.ts`; test `apps/api/src/prompt-ideas.test.ts`.

**Interfaces:** `createPromptIdea` returns pending after a recorded Agent session; worker `tick()` reconciles rows after restart.

- [x] Write tests for no duplicate create and recovery after restart.
- [x] Add migration columns, provider routing, worker startup/timer, and reconcile logic.
- [x] Run focused tests and API build.

### Task 3: Configuration and release checks

**Files:** Modify `.env.example`, `README.draft.md`.

- [x] Document `IDEA_PROVIDER`, `OPENAI_API_KEY`, and `IDEA_AGENT_MODEL` as server-only values.
- [x] Run API tests, build, and boundary checks relevant to touched files.
- [ ] Report that live activation requires the user's secret set on the server and a fresh deployment; do not claim a real model call without evidence.
