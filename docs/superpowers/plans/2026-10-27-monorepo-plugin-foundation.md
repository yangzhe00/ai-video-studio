# Monorepo and Plugin Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert the working macOS editor into a pnpm monorepo with shared project rules, a reusable design foundation, and an explicit static feature registry while preserving current desktop behavior.

**Architecture:** Keep the existing Tauri frontend and Rust backend together under `apps/desktop`. Extract pure TypeScript project rules into a workspace package; express desktop capabilities as registered feature descriptors with no dynamic code loading. Centralize visual tokens and common Web controls without moving platform-specific I/O into shared code.

**Tech Stack:** pnpm workspace, React 19, TypeScript, Vite, Vitest, Tauri 2, Rust.

**Spec:** `docs/superpowers/specs/2026-10-27-multiplatform-plugin-architecture-design.md`; UI context in `docs/superpowers/specs/2026-10-27-editor-workspace-redesign-design.md`.

## Global Constraints

- Preserve existing `ProjectManifestV2` disk format, local project folder boundaries, and current desktop import/edit/export behavior.
- Do not claim web, mobile, remote MCP, or paid video generation is operational in this first phase.
- No runtime third-party plugin loading; plugin registration is build-time and platform-checked.
- Current image clip maximum remains 5 seconds; captions remain at absolute output timestamps.
- Do not package the development-only FFmpeg binaries for distribution.

## Review Focus

- Moving `src-tauri` changes its relative paths to Vite output and dev commands: desktop dev and build must still find the frontend.
- Workspace packages must resolve in both TypeScript/Vite and Vitest, without duplicate React copies.
- Existing V2 project files must remain readable and writable after type/model extraction.
- Disabling a feature must remove its navigation/entry point without changing the project data.
- CI-like checks must catch accidental Tauri imports inside platform-neutral packages.

---

### Task 1: Preserve the desktop app during workspace migration

**Files:**
- Create: `pnpm-workspace.yaml`, `apps/desktop/package.json`, `apps/desktop/tsconfig.json`, `apps/desktop/vite.config.ts`, `apps/desktop/vitest.config.ts`
- Move: root `src`, `src-tauri`, `index.html`, frontend configuration, and `scripts/prepare-dev-media-tools.mjs` into `apps/desktop`
- Modify: root `package.json`, `src-tauri/tauri.conf.json` at its new path, README development commands

**Interfaces:** Root scripts `dev`, `test`, `build`, and `tauri` delegate to `@ai-video/desktop`; desktop app name remains `ai-video-studio` at the Tauri level.

- [ ] **Step 1:** Run baseline `pnpm test` and `pnpm build`; record pass/fail before migration.
- [ ] **Step 2:** Create workspace root and move the app; update Tauri `beforeDevCommand`, `beforeBuildCommand`, `frontendDist` to paths relative to `apps/desktop/src-tauri`.
- [ ] **Step 3:** Run `pnpm install --frozen-lockfile` after regenerating the workspace lockfile, then root `pnpm test` and `pnpm build`.
- [ ] **Step 4:** Launch `pnpm tauri dev` on macOS and verify Vite HTTP 200 plus Tauri process startup.
- [ ] **Step 5:** Commit the migration as one reviewable change.

### Task 2: Extract pure project rules

**Files:**
- Create: `packages/project-core/package.json`, `packages/project-core/tsconfig.json`, `packages/project-core/src/index.ts`
- Move: `apps/desktop/src/types/{project,ai}.ts`, `apps/desktop/src/features/timeline/model.ts`, `apps/desktop/src/features/create/shotDraft.ts` and their pure tests into `packages/project-core/src`
- Modify: desktop imports and test configuration

**Interfaces:** `@ai-video/project-core` exports `ProjectManifestV2`, `OpenProject`, timeline commands, `ShotDraft`, `GenerationJob`, and shot draft helpers. It must have no Tauri, DOM, React, filesystem, or network imports.

- [ ] **Step 1:** Add a package-level test for moving and trimming clips without changing assets, plus shot draft creation.
- [ ] **Step 2:** Move pure code and update desktop imports to package exports.
- [ ] **Step 3:** Run package tests, desktop tests, root type-check/build, and desktop Rust tests.
- [ ] **Step 4:** Commit extraction.

### Task 3: Add static plugin registration and platform ports

**Files:**
- Create: `packages/plugin-sdk/src/index.ts`, `packages/plugin-sdk/src/index.test.ts`, `packages/plugin-sdk/package.json`
- Create: `packages/platform-ports/src/index.ts`, `packages/platform-ports/package.json`
- Create: `plugins/{media,timeline,captions,storyboard,export}/src/index.ts` and package manifests
- Modify: `apps/desktop/src/App.tsx`, `apps/desktop/src/features/workspace/ProjectWorkspace.tsx`, desktop `package.json`

**Interfaces:** `FeaturePlugin` has `id`, `supportedPlatforms`, `requires`, and `contributes` metadata; `resolvePlugins(platform, enabled, registry)` validates dependencies and returns available features. `DesktopPorts` describes project/media/export/secret calls; desktop's existing native adapter implements it. Registry is data-only in this phase; editor panels are selected from registered contributions.

- [ ] **Step 1:** Test disabled feature, unsupported platform, duplicate ID, and missing dependency behavior in `plugin-sdk`.
- [ ] **Step 2:** Implement registry and port contracts; wrap existing native functions without changing Rust commands.
- [ ] **Step 3:** Wire desktop navigation/panels to registry and verify existing controls still work.
- [ ] **Step 4:** Run root test/build and desktop runtime smoke check.
- [ ] **Step 5:** Commit plugin foundation.

### Task 4: Extract design tokens and common Web controls

**Files:**
- Create: `packages/design-tokens/package.json`, `packages/design-tokens/src/tokens.css`, `packages/design-tokens/src/index.ts`
- Create: `packages/ui-web/package.json`, `packages/ui-web/src/{Button,Panel,StatusBadge,index}.tsx`
- Modify: `apps/desktop/src/App.css`, `apps/desktop/src/App.tsx` and key editor panels

**Interfaces:** `@ai-video/design-tokens` supplies CSS custom properties; `@ai-video/ui-web` supplies accessible, presentational controls with no Tauri dependency or project mutations.

- [ ] **Step 1:** Add focused rendering tests for Button disabled state, Panel heading, and StatusBadge text.
- [ ] **Step 2:** Introduce tokens and components; replace repeated control styles in current desktop shell/editor without yet changing the editor information architecture.
- [ ] **Step 3:** Run tests/build and inspect desktop runtime at normal and narrow window widths.
- [ ] **Step 4:** Commit design foundation.

### Task 5: Document extension path and final acceptance

**Files:** Modify `README.md` and add `docs/architecture/plugin-contract.md`.

**Interfaces:** Document exact workspace commands, package dependency rule, plugin enablement, and what remains future work (dual-view redesign, Agent/MCP, web, mobile, paid generation).

- [ ] **Step 1:** Document package boundaries and one example of adding a platform-checked feature.
- [ ] **Step 2:** Run `pnpm test`, `pnpm build`, Rust tests, and `pnpm tauri dev`; verify old project open/import/edit/export through the desktop app where test fixtures permit.
- [ ] **Step 3:** Record remaining limitations and commit documentation.
