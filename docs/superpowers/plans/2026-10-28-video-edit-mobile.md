# Cross-Platform Video Edit and Mobile Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the same generated shot be trimmed at its start/end, subtitled, and given a cover from desktop, web, or mobile, with one cloud-rendered version visible across all three platforms.

**Architecture:** `plugins/video-edit` owns a versioned non-destructive recipe and pure edit commands. Platform-specific Web and native entry points present the same data without sharing DOM code. A backend render worker produces immutable MP4/cover objects; rendering has its own operation ID and events, separate from Agent generation. Existing timeline clips pin their selected asset until explicitly replaced.

**Tech Stack:** TypeScript 6, React 19, Expo/React Native, Node 24, FFmpeg/ffprobe backend, Vitest, pnpm workspace.

**Spec:** `docs/superpowers/specs/2026-10-28-agent-first-multiplatform-architecture-design.md`.

## Global Constraints

- First version supports only trim start/end time, manual subtitles, and cover frame selection. No spatial crop or aspect ratio control.
- The generated original remains immutable, and the previous rendered revision remains accessible.
- Caption and cover times use source-video milliseconds and are validated against the retained interval.
- The mobile bundle must not import `plugins/canvas` or Web DOM components.
- Final files on all platforms come from one backend render pipeline.
- A rendered revision changes the episode's current preview only after success; existing timeline clips are not silently rewritten.

## Review Focus

- Trimming past a subtitle flags the issue instead of deleting the subtitle.
- A cover frame outside the retained range is rejected.
- Retrying the same recipe revision returns one render operation and one output object.
- Render failure leaves the original and previous successful revision playable.
- A mobile edit followed by desktop/web refresh shows the same revision and output file.

---

### Task 1: Versioned video edit recipe and plugin manifest

**Files:** Create `plugins/video-edit/package.json`, `src/core.ts`, `src/index.ts`, `src/core.test.ts`; extend plugin SDK manifest tests; modify project-core episode shot/version references.

**Interfaces:** `VideoEditRecipeV1{id,sourceAssetId,trimStartMs,trimEndMs,captions,coverSourceMs,revision}`; `applyVideoEdit(recipe,command,expectedRevision)` validates source-relative ranges and increments revision. Export `videoEditPlugin` with `supportedPlatforms: ["desktop","web","mobile"]` and distinct platform UI entry points.

- [ ] Add tests for valid trim/caption/cover edits, out-of-range positions, stale revision, original preservation and platform registration.
- [ ] Implement pure command handlers and plugin metadata without DOM/native dependencies in `src/core.ts`.
- [ ] Run plugin, plugin-sdk, and project-core tests/build.
- [ ] Commit only task files.

### Task 2: Cloud render task and immutable output versions

**Files:** Create `apps/api/src/render.ts`, `src/render-worker.ts`, tests; update object storage and episode shot commands; add an FFmpeg availability check at API startup.

**Interfaces:** `POST /video-edits/:id/render` takes `{renderOperationId,expectedRevision}` and returns a stable task ID. The render worker reads the immutable source object, applies start/end trim and subtitle overlay, captures the cover at `coverSourceMs`, writes immutable MP4/cover objects, and atomically points the episode shot's current preview to the new revision. It reuses the run event format but never calls the Agent model or Kling.

- [ ] Add tests for duplicate render request, FFmpeg failure, partial output cleanup, success after restart, and timeline asset pinning.
- [ ] Implement bounded render queue, worker recovery, output validation and event updates.
- [ ] Run API tests and render a small local fixture; open both MP4 and cover file.
- [ ] Commit only task files.

### Task 3: Desktop and web video edit views

**Files:** Create `plugins/video-edit/src/web/VideoEditor.tsx`, styles and tests; modify desktop/web result cards and plugin mounts; extract shared preview/caption controls into `packages/ui-web` as needed.

**Interfaces:** `VideoEditor` receives recipe, source URL, `onSave`, `onRender`, render status, and `onUseInTimeline`. It provides start/end handles, subtitle timings, cover scrubbing, preview and original/revision selection. It saves recipe metadata without triggering a render until the user clicks completion.

- [ ] Add interaction tests for trim bounds, subtitle retention warning, cover bounds, draft save, duplicate completion click and explicit timeline replacement.
- [ ] Implement accessible keyboard and pointer controls using shared semantic theme tokens.
- [ ] Run plugin, desktop and web tests/build; compare C4/cyan states in running views.
- [ ] Commit only task files.

### Task 4: Mobile app and native plugin UI

**Files:** Create `apps/mobile` Expo app files, `packages/ui-native`, `plugins/video-edit/src/native/VideoEditor.tsx` and tests; add `mobilePlugins` static registry without canvas.

**Interfaces:** Register/login, project/episode/result list, Agent input/status and a full-screen native video editor. The native editor calls the same recipe/render API and uses the same pure commands as desktop/web; its UI uses touch-friendly controls and no DOM imports.

- [ ] Add tests for platform plugin registration, trim/caption/cover actions, API resume after app reopen, and absence of canvas imports.
- [ ] Implement the Expo app, native player, login/session storage and three-end editor actions.
- [ ] Run TypeScript/tests, build an Expo development bundle, and inspect on a real device or simulator when available; report any device validation not observed.
- [ ] Commit only task files.
