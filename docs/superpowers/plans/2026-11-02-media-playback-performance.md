# Media Playback Performance Implementation Plan

> **For agentic workers:** Implement the tasks below in order and verify each before deployment.

**Goal:** Make generated videos start and seek promptly in the web result, canvas, and asset views without changing original media or access control.

**Architecture:** Serve authenticated MP4 byte ranges from the API. Avoid eager loading original videos in lists and canvas nodes. Deploy the media route as a patch against the current schema 1 API image; keep the schema 4 candidate separate until its migration and QA gates pass.

**Tech Stack:** Node.js HTTP streams, React 19, Vite, Nginx, Docker Compose, PostgreSQL 17.

**Spec:** User request on 2026-11-02; existing behavior and tradeoffs recorded in this chat.

## Global Constraints

- Preserve per-account object authorization and immutable original files.
- Do not deploy the current schema 4 candidate against the production schema 1 database.
- Keep secrets outside Git and avoid new paid media generation during regression.

## Review Focus

- A suffix byte range and an open-ended byte range return only the requested bytes.
- Invalid, multiple, and out-of-bounds ranges return 416 without streaming the object.
- A second account cannot read media through either full or ranged requests.
- A canvas with many completed nodes does not request every MP4 on load.
- A selected result still plays and seeks after the lazy-loading change.

---

### Task 1: Authenticated media ranges

**Files:** Create `apps/api/src/media-range.ts`; create `apps/api/src/media-range.test.ts`; modify `apps/api/src/server.ts`.

**Interfaces:** `parseMediaRange(header: string | undefined, size: number): { start: number; end: number } | null` throws a typed range error for malformed or unsatisfiable ranges. The object route uses this after owner lookup, sets `Accept-Ranges: bytes`, returns 206 with exact `Content-Range` and `Content-Length`, and streams only `[start,end]`; no-range remains 200.

- [ ] Test normal, suffix, open-ended, invalid, and out-of-bounds ranges.
- [ ] Implement the parser and route integration.
- [ ] Run targeted parser tests and API typecheck.

### Task 2: Lazy web media

**Files:** Modify `packages/ui-web/src/GeneratePage.tsx`, `plugins/canvas/src/CanvasPage.tsx`, `apps/web/src/App.tsx`; update focused component tests where appropriate.

**Interfaces:** Recent cards and canvas nodes display the source photo or a placeholder until the user opens the player. Asset cards use `preload="none"`; only the selected result or opened player requests video bytes.

- [ ] Add regression assertions that list and canvas views do not mount eager video elements.
- [ ] Implement the lightweight previews.
- [ ] Run web and component tests and build.

### Task 3: Release and acceptance

**Files:** Update deployment and acceptance notes in `docs/acceptance/`.

- [ ] Audit all current uncommitted files for secrets and generated-only files, run relevant tests and `git diff --check`, then commit the requested changes.
- [ ] Back up the current release and create a media-only API image from the deployed schema 1 base image.
- [ ] Deploy only artifacts whose database and QA prerequisites pass; verify health, 206/416 responses, browser playback, and rollback path.
