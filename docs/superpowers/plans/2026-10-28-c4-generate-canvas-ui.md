# C4 Generate and Canvas UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the approved C4 奶油胶片 Generate and Canvas screens in the desktop app while keeping the existing local project, Kling task recovery, editing, and export flows usable.

**Architecture:** Keep the current Tauri project and media ports. Add a project-scoped studio document for episodes, characters, nodes, and edges; the active episode mirrors its timeline into the existing flat clip fields used by the exporter. Render Generate and Canvas as React views sharing one manifest owner, with CSS tokens sampled from the approved Pen screens.

**Tech Stack:** React 19, TypeScript 6, CSS, Tauri 2, Rust serde, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-28-generate-canvas-workflow-design.md`; visual reference `design/ai-video-studio-ui-options.pen`, frames `C4 奶油胶片 · 生成` and `C4 奶油胶片 · 画布`.

**Implementation status (2026-10-28):** C4 screens, episode/character graph, local persistence, result handoff and episode timeline export entry are implemented. The 1440 × 900 browser preview was compared with the approved Pen frames and saved under `design/previews/implementation-c4-*.png`. The native Tauri binary compiled and launched. A native-window capture was unavailable, and no live paid generation or full episode export was performed.

## Global Constraints

- One canvas represents one episode; characters are shared across episodes and start from a local reference photo.
- Paid video generation is always an explicit user action; an unresolved submission is refreshed, never resubmitted.
- Only 5 or 10 second silent Kling image-to-video is executable in the first release.
- Existing project assets, shots, jobs, clips, captions, and export behavior remain available.
- C4 visual targets: warm ivory workspace `#F7F2EB`, near-white panels `#FFFCF8`, terracotta primary `#B96C4A`, dark ink `#2B2A26`, and 1440 × 900 reference layout.

## Review Focus

- A legacy project without studio data opens into a default episode containing its existing clips.
- Missing reference photos never become runnable video inputs.
- A pending or unknown Kling job offers refresh, not another paid submission.
- Switching episodes retains each episode's clip order and current export target.
- Canvas connections reject invalid directions and cycles without charging or mutating saved jobs.

---

### Task 1: Project-scoped episodes and graph

**Files:**
- Create: `packages/project-core/src/studio.ts`
- Create: `packages/project-core/src/studio.test.ts`
- Modify: `packages/project-core/src/project.ts`, `packages/project-core/src/index.ts`
- Modify: `apps/desktop/src-tauri/src/project.rs`

**Interfaces:** `ensureStudio(manifest)`, `createEpisode(manifest,title)`, `selectEpisode(manifest,id)`, `addStudioNode(manifest,episodeId,node)`, `connectStudioNodes(manifest,episodeId,from,to)`, `moveStudioNode(manifest,episodeId,nodeId,x,y)`, `createCharacter(manifest,name,description,assetId)`. The optional `studio` property survives Rust open/save and generation task updates.

- [x] Add tests for legacy migration, independent episode timelines, character reuse, and invalid graph connections.
- [x] Implement the minimal typed model and pure operations.
- [x] Preserve optional studio data through Tauri serialization and save.
- [x] Run project-core and Rust project tests.

### Task 2: C4 application shell and Generate page

**Files:**
- Create: `apps/desktop/src/features/studio/StudioWorkspace.tsx`, `GeneratePage.tsx`, `StudioIcons.tsx`, `Studio.css`
- Modify: `apps/desktop/src/App.tsx`, `apps/desktop/src/App.css`
- Test: `apps/desktop/src/features/studio/StudioWorkspace.test.tsx`, `apps/desktop/src/App.test.tsx`

**Interfaces:** The workspace owns `ProjectManifestV2`, asset previews, save state, and selected screen. Generate receives image import, shot save/submit/refresh, and add-result-to-canvas actions. The project picker remains available inside the workspace.

- [ ] Add interaction tests for project entry, image selection, shot creation, submit confirmation, pending refresh, and successful result handoff.
- [x] Implement the C4 shell, centered composer, segmented Generate/Canvas switch, prompt controls, and real recent task cards.
- [x] Run targeted frontend tests and build.

### Task 3: C4 Canvas page and episode export

**Files:**
- Create: `apps/desktop/src/features/studio/CanvasPage.tsx`
- Modify: `apps/desktop/src/features/studio/StudioWorkspace.tsx`, `Studio.css`
- Test: `apps/desktop/src/features/studio/StudioWorkspace.test.tsx`

**Interfaces:** Canvas receives active episode, graph operations, asset preview URLs, timeline updates, and `exportProject(root,outputName)`. It renders draggable nodes and SVG connectors in a pannable, zoomable workspace.

- [ ] Add tests for creating a reference-photo character, adding and connecting nodes, persistence after reopen, moving nodes, adding a successful video to the timeline, and episode switching.
- [x] Implement the C4 light grid, left toolbar, character/text/video/timeline nodes, connection controls, selected-node editor, and episode controls.
- [x] Wire successful generated assets into the selected episode timeline and retain the legacy editor for detailed clip, caption, and export controls.
- [x] Run targeted frontend tests and build.

### Task 4: Visual and runtime acceptance

**Files:**
- Modify only files found necessary in Tasks 1–3 and focused tests.

- [x] Compare 1440 × 900 running Generate and Canvas browser screenshots against the approved C4 Pen previews.
- [ ] Exercise New/Open, image import, character creation, node movement/connection, task status, timeline handoff, and export entry in the running desktop app.
- [x] Run the required focused tests and build; report any paid-generation or native-runtime step not observed.
