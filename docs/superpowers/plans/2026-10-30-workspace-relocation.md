# Workspace Relocation Implementation Record

**Date:** 2026-10-30
**Goal:** Move the AI Video Studio checkout to `/Volumes/project/代码/ai-video-studio` while preserving Git state and linked worktrees.
**Spec:** `docs/superpowers/specs/2026-10-30-workspace-relocation-design.md`

## Completed steps

- [x] Check source, target, free space, HEAD, branch, dirty state and two linked worktrees.
- [x] Copy with `rsync -a`, excluding only rebuildable `apps/desktop/src-tauri/target/`; compare source and staging.
- [x] Ask the active QA writer to pause; perform final incremental sync.
- [x] Rename staging to the target and original to `/Users/yangzhe/Documents/ChatGPT/剪辑.pre-migration-20261030`.
- [x] Replace the initially attempted old-path symlink with a real directory containing a migration README. Codex rejected a symlinked writable root. Repair both linked worktrees' `.git` absolute paths to the new main `.git/worktrees`.
- [x] Verify HEAD `5649d1bf04038f31d8c6c2fa996444f8596b3ab9`, branch `codex/monorepo-plugin-foundation`, three worktrees and existing dirty state.
- [x] Review the two FFmpeg installer postinstall scripts; each only marks its bundled binary executable. Add explicit `allowBuilds` entries to `pnpm-workspace.yaml`, then run `CI=true pnpm install --frozen-lockfile`, `pnpm --filter @ai-video/api build` and `pnpm --filter @ai-video/web build`; all passed.
- [x] Verify the copied FFmpeg and ffprobe binaries. The pnpm reinstall left ffprobe without execute permission; its SHA-256 matched the original binary, so its original executable mode was restored. Both `-version` commands returned status 0.
- [x] Preserve the original full checkout as a backup; do not delete it or production state.

## Post-migration action

Open `/Volumes/project/代码/ai-video-studio` as the project workspace in Codex/IDE. The old path is an explanatory placeholder, not an alias. Chats with the old writable root can read the new checkout but may need a workspace update or new task to write there without sandbox escalation. The two audited FFmpeg installer build scripts are explicitly allowed in `pnpm-workspace.yaml` so a clean install works.
