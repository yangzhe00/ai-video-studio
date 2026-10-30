# Agent Platform Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prepare the existing desktop application for cloud Agent execution and reusable desktop/web/mobile plugins without changing its currently working local project content.

**Architecture:** Keep `project-core` as the stable project domain. Move graph-specific state into a versioned canvas extension, extend the static plugin manifest to contribute platform UI and capabilities, and turn the C4/cyan palette into semantic tokens consumed by shared Web controls. The current desktop UI remains operational while its canvas view becomes a plugin entry.

**Tech Stack:** pnpm workspace, React 19, TypeScript 6, CSS, Vitest, Tauri 2.

**Spec:** `docs/superpowers/specs/2026-10-28-agent-first-multiplatform-architecture-design.md` and `docs/superpowers/specs/2026-10-28-desktop-shell-global-theme-design.md`.

## Global Constraints

- Desktop and web can load the canvas plugin; mobile must not import it.
- Video edit is a separate plugin supported on all three platforms.
- Existing `ProjectManifestV2` data and unknown Kling task IDs remain readable during migration.
- No page may call a provider directly after the cloud migration; the foundation keeps existing behavior until the API exists.
- The desktop 48px native header remains desktop-only; shared Web UI begins beneath it.

## Review Focus

- A legacy project with no `studio` data still opens and keeps its episode clips.
- A legacy project with connected canvas nodes preserves IDs and edges after extension migration.
- Mobile plugin resolution excludes canvas without deleting graph data.
- Switching C4/cyan updates shared controls as well as page surfaces without resetting input state.
- Plugin registration rejects duplicate IDs and missing dependencies before mounting a route.

---

### Task 1: Extend the static plugin contract

**Files:** Modify `packages/plugin-sdk/src/index.ts`, `packages/plugin-sdk/src/index.test.ts`; create `plugins/canvas/package.json`, `plugins/canvas/src/index.ts`; modify `apps/desktop/src/lib/plugins.ts`.

**Interfaces:** `FeaturePlugin` gains `contributes.routes`, `contributes.capabilities`, and optional `contributes.nodeTypes`, while retaining `contributes.panels`. Export `canvasPlugin` with `supportedPlatforms: ["desktop", "web"]`; registration continues to use `resolvePlugins(platform, enabledIds, registry)`.

- [ ] Add tests for a desktop/web canvas route, no mobile canvas route, and duplicate/missing-dependency errors.
- [ ] Implement manifest additions and static canvas registration without dynamic third-party loading.
- [ ] Run `pnpm --filter @ai-video/plugin-sdk test` and `pnpm --filter @ai-video/plugin-sdk build`.
- [ ] Commit only task files.

### Task 2: Separate graph extension from episode content

**Files:** Modify `packages/project-core/src/project.ts`, `studio.ts`, `studio.test.ts`, `index.ts`; create `packages/project-core/src/canvas-extension.ts` and test; modify `apps/desktop/src-tauri/src/project.rs` only as needed to preserve opaque versioned extensions.

**Interfaces:** `ProjectManifestV2` keeps stable asset/episode IDs; `CanvasDocumentV1` stores nodes/edges/view positions by episode ID. `migrateStudioGraph(manifest)` returns a manifest plus extension while preserving characters, clips and tasks. `ensureStudio` remains readable for old files during migration.

- [ ] Add fixtures for no-studio, populated-studio, duplicate node IDs, and unsupported extension version.
- [ ] Implement id-preserving migration and round-trip serialization.
- [ ] Run `pnpm --filter @ai-video/project-core test` and focused Rust project tests.
- [ ] Commit only task files.

### Task 3: Extract global theme tokens and shared controls

**Files:** Modify `packages/design-tokens/src/tokens.css`, `packages/ui-web/src/styles.css`; create shared `ThemeProvider.tsx`, `TaskStatus.tsx`, `VideoResultCard.tsx`, `EpisodeList.tsx` under `packages/ui-web/src`; modify `apps/desktop/src/App.css`, `features/studio/Studio.css` and relevant page imports.

**Interfaces:** One root `data-skin` value (`cream-film` or `cyan-night`) maps semantic tokens from the approved Pen design. Shared components receive data/actions as props and have no Tauri imports. Theme selection persists as an app preference without touching project data.

- [ ] Add tests that rendering shared controls under both skins changes token values, and toggling skin preserves input text.
- [ ] Implement semantic tokens, reusable controls and desktop adoption; leave canvas layout in plugin-specific CSS.
- [ ] Run `pnpm --filter @ai-video/ui-web test`, desktop tests, and `pnpm --filter @ai-video/desktop build`.
- [ ] Compare the running 1440×900 desktop screens with the Pen C4 and cyan previews.
- [ ] Commit only task files.

### Task 4: Mount canvas through the plugin host

**Files:** Move or wrap `apps/desktop/src/features/studio/CanvasPage.tsx` and its canvas CSS into `plugins/canvas/src`; modify `StudioWorkspace.tsx` and package dependencies; add a plugin mount test.

**Interfaces:** `CanvasPluginView` accepts project/episode data and typed actions via props; the host mounts it only when `canvasPlugin` is enabled. Canvas graph commands use `CanvasDocumentV1` but episode results remain in core data.

- [ ] Add a test that disabling canvas hides the route but preserves episodes and generated results.
- [ ] Extract the view without changing the existing generated-video-to-episode behavior.
- [ ] Run plugin, project-core, and desktop tests/build; manually open the canvas in the running desktop app.
- [ ] Commit only task files.
