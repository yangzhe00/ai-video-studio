# Docker API Deployment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the production API's systemd process with one Docker Compose container while preserving the live SQLite data, Nginx endpoint, and a tested rollback.

**Architecture:** The current Nginx container keeps HTTPS and static web hosting. Compose runs one API container from the active SQLite release, injects the existing environment file, and mounts the existing data directory.

**Tech Stack:** Docker Engine, Compose, Node 24, pnpm 10.30.1, SQLite, Nginx.

**Spec:** `docs/superpowers/specs/2026-10-29-docker-api-deployment-design.md`

## Global Constraints

- Do not publish the uncutover PostgreSQL worktree as the SQLite production API.
- Do not print, copy into Git, or bake provider keys and session secrets into an image.
- Keep the existing Nginx IP URL and HTTP API contracts.
- Preserve the old release, service definition, live data, and rollback path.

## Review Focus

- An image built on a Mac must not contain Darwin native media binaries: build and probe on Linux.
- An unconfigured staging container must not process the live SQLite database or paid job queue.
- A failed container startup must restore the old API without overwriting user data.
- The Nginx container must be able to reach the new bridge-bound API port.
- Container restart must preserve data and API availability.

---

### Task 1: Container source and runtime contract

**Files:** Create `deploy/docker/Dockerfile.api`, `deploy/docker/compose.yaml`, `.dockerignore`, and deployment documentation.

**Interfaces:** `API_IMAGE`, `API_BIND_IP`, `API_UID`, and `API_GID` select the image and server binding; API secrets come from `/etc/ai-video-studio/api.env`.

- [x] Create a Linux image that installs the API workspace closure from the lockfile and probes `ffprobe`.
- [x] Define a single API service with bind mount, health check, restart, and bridge-only port.
- [x] Validate `docker compose config` and build an image from the active release.
- [x] Smoke test an isolated container and inspect its health, media tools, and fresh database.

### Task 2: Production cutover and rollback proof

**Files:** Server `/srv/ai-video-studio/docker/compose.yaml`, `/var/backups/ai-video-studio/*`.

**Interfaces:** `docker compose up -d api` replaces `ai-video-studio.service`; Nginx proxy remains `172.23.0.1:8787`.

- [x] Record active release and database integrity; back up the SQLite DB and environment file.
- [x] Stop and disable the systemd API; start the pinned Compose image.
- [x] Verify container health and public HTTPS/API behavior.
- [x] Keep the scripted failure rollback in `cutover.sh`; the successful switch did not require invoking it, so the failure path was not exercised live.

### Task 3: Regression evidence and developer documentation

**Files:** Modify `.codex/.agent/AGENTS.md`, `.codex/.agent/api.md`, `.codex/.agent/cli_all.md`; create a dated deployment report.

**Interfaces:** Test chat receives live URL, nonbillable regression scope, and screenshot request.

- [x] Send the test chat a production regression task and collect its result and screenshots.
- [x] Verify Docker and container restart policies, data mount, exact image/release, checks, and rollback command.
- [x] Update development documentation to state the actual Docker deployment and later PostgreSQL boundary.
- [x] Run `git diff --check` and report residual risks.
