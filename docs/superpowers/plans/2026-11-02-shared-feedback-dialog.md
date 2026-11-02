# Shared Feedback Dialog Implementation Plan

> **For agentic workers:** Execute this plan task by task; check the user behavior after each task.

**Goal:** Replace browser-native confirmations and text prompts in Web/Desktop with a reusable themed dialog and one typed message catalog.

**Architecture:** Keep copy and severity in `packages/components/src/feedback.ts`. Render one reusable portal dialog through a local hook at each application/plugin call site, so existing canvas and app ownership stays intact. React Native keeps its platform-native dialogs; inline status and validation messages remain contextual.

**Tech Stack:** React 19, TypeScript, CSS design tokens, Vitest and Testing Library.

**Spec:** User request, 2026-11-02; existing C4 theme tokens and `.codex/.agent/front.md`.

## Global Constraints

- No browser-native `window.confirm`, `window.prompt`, or `window.alert` in Web/Desktop after migration.
- Warnings require an explicit primary action and a safe cancel path; Escape and backdrop cancel.
- The new-episode input requires a nonblank name; Cancel must not create an episode.
- Modal uses semantic tokens for cream and cyan skins, traps focus, and fits narrow H5 viewports.

## Review Focus

- Cancel deletion keeps the node and its connections.
- Confirm deletion removes only the selected node through the existing callback.
- Cloud overwrite happens only after explicit confirmation.
- Regeneration confirmation precedes the paid planning request.
- Failed clipboard write shows a failure dialog rather than an unhandled rejection.

---

### Task 1: Shared message catalog and dialog

**Files:** Create `packages/components/src/feedback.ts`, `FeedbackDialog.tsx`, `FeedbackDialog.test.tsx`; update `index.ts`, `styles.css`, `package.json`.

**Interfaces:** `feedbackMessages` groups warning/failure/info/success copy; `useFeedbackDialog()` returns `confirm`, `input`, `show`, and `dialog`.

- [x] Test warning cancel/confirm, input validation, Escape/focus, and failure display.
- [x] Implement the catalog, reusable dialog, hook, and token-based responsive styles.
- [x] Run components tests and type check.

### Task 2: Replace all browser-native prompts

**Files:** Update `plugins/canvas/src/CanvasPage.tsx`, `plugins/canvas/package.json`, `apps/web/src/App.tsx`, `apps/desktop/src/features/studio/StudioWorkspace.tsx`; update canvas interaction tests.

- [x] Replace five `window.confirm`/`window.prompt` calls with typed shared prompts.
- [x] Handle share clipboard failure in the failure dialog.
- [x] Test cancel/confirm delete and run Web/Desktop targeted suites and builds.

### Task 3: Visual and static regression

**Files:** Add screenshots and regression notes under `docs/acceptance/evidence/2026-11-02-feedback-dialog/`.

- [x] Inspect warning, input and failure dialogs at desktop and phone widths in both skins.
- [x] Check no overflow or obscured action buttons; search source for native browser prompts.
- [x] Run workspace boundary and diff checks; record exact coverage and any untested platform behavior.
