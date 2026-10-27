# Direct Editor Workspace Implementation Plan

> **For agentic workers:** Implement in small reviewable steps; preserve project data and existing native commands.

**Goal:** Open directly into a compact editor, restore the previous project, and replace the stacked project form with a usable storyboard and timeline workspace.

**Architecture:** Keep `ProjectManifestV2` and `desktopPorts`. App owns project selection and last project path; workspace owns editing state. The same clip array powers storyboard and timeline views.

**Spec:** `docs/superpowers/specs/2026-10-27-editor-workspace-redesign-design.md` with the 2026-10-27 update.

## Constraints

- No project is silently created. An unavailable previous path shows an in-workspace new/open entry.
- No changes to `project.json` V2 or Rust commands.
- AI shot drafts remain separate from playable clips; generation remains unavailable.
- Existing import, clip edits, captions, cover, copy, budget, settings and export stay reachable.

## Tasks

### 1. Direct entry and project switching

- [x] Add last-project restore with safe fallback and compact create/open controls inside the editor shell.
- [x] Test first launch, successful restore, and missing-folder fallback.

### 2. Editor layout

- [x] Replace stacked cards with media library, 9:16 preview, context inspector, and bottom storyboard/timeline.
- [x] Keep both sequence views on the same `manifest.clips`; retain explicit controls for keyboard users.
- [x] Keep AI planning, captions, cover, publishing copy and export in clear tabs or drawers.
- [x] Test import and a clip reorder/view switch path.

### 3. Verification

- [x] Run frontend tests/build and Rust tests; launch Tauri app.
- [x] Inspect normal and minimum window widths, including empty and loaded project states. Loaded layout inspection used a temporary local fixture removed afterward.
