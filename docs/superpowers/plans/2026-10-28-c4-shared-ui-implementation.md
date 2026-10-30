# C4 Shared UI Implementation Plan

> **For agentic workers:** Implement each task with a focused check before moving on.

**Goal:** Bring web and desktop screens into the C4 interaction preview's visual system and share the reusable UI in `packages/components`.

**Architecture:** Keep business logic, API calls, and canvas execution in each app/plugin. Put the common title bar, navigation shell, project home, result view, and state surfaces in one React package backed by global design tokens. Web and desktop render these same components; mobile later consumes the token/state contract with native controls.

**Tech Stack:** React 19, TypeScript, Vite, pnpm workspaces, existing `@ai-video/design-tokens` and `@ai-video/ui-web`.

**Spec:** `design/interaction-clickthrough.html`, `docs/product/2026-10-28-ui-prototype-handoff.md`.

## Global Constraints

- C4 cream film remains the default; cyan night switches through existing `data-skin` tokens.
- Preserve existing cloud task IDs, paid generation approval, canvas workflow, and native export behavior.
- Use actual project media and task state. Preview artwork is a layout reference, not fake runtime data.
- Desktop title bar keeps a 48px native drag region and platform window controls.

## Review Focus

- Narrow desktop window: title bar, status, sidebar, and buttons remain reachable without overlap.
- Empty project/result: clear action without a fake video.
- Loading/unknown/failed task: stable task ID and explicit recovery action.
- Long project/prompt names: truncate or wrap, never push action controls offscreen.
- Dark skin: readable text, focus rings, and contrast on shared components.

---

### Task 1: Shared C4 chrome

**Files:** `packages/components/src/StudioChrome.tsx`, `packages/components/src/styles.css`, both app entry points and package manifests.

- [ ] Create typed title bar, sidebar, and shell components using existing design tokens.
- [ ] Wire navigation in web and desktop without moving business logic.
- [ ] Verify web/desktop TypeScript build and existing navigation tests.

### Task 2: Shared home, result, and state views

**Files:** `packages/components/src/ProjectHome.tsx`, `ResultsPage.tsx`, `StatePanel.tsx`, both app view routers.

- [ ] Implement empty, loading, failed, and success surfaces with real data props.
- [ ] Add a results route to web/desktop and preserve edit/timeline actions.
- [ ] Add component tests for empty/result/task states.

### Task 3: Visual acceptance and QA handoff

**Files:** `docs/acceptance/2026-10-28-c4-ui-test-scope.md`, screenshots under `design/previews/`.

- [ ] Start real web and desktop frontends with API-backed or deterministic fixture state.
- [ ] Capture 1440×900 and smaller viewport screenshots for home, generation, canvas, result, and states.
- [ ] Review for clipping, overlap, displacement, and dark-skin contrast; fix issues found.
- [ ] Run targeted tests, builds, and `git diff --check`; document manual testing scope and limits.
