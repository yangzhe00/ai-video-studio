# Local Video Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a working macOS desktop editor that imports existing media, edits a short vertical timeline, and exports MP4, cover image and publishing copy entirely offline.

**Architecture:** A Tauri 2 native layer owns project directories, media probing and FFmpeg execution. A React/TypeScript frontend owns timeline decisions and serializes them in a versioned project manifest. Imported media is copied into the project; export reads that immutable source and writes new output files.

**Tech Stack:** Tauri 2, Rust, React, TypeScript, Vite, pnpm, Vitest, FFmpeg/ffprobe sidecars.

**Spec:** `docs/superpowers/specs/2026-10-27-ai-short-video-desktop-design.md`

## Global Constraints

- 第一版仅 macOS；源码从这个新仓库独立实现。
- 源素材与生成片段按项目目录管理；不得覆盖用户原始文件。
- 离线时仍可打开项目、预览、剪辑和导出已有素材。
- 导出竖屏 9:16 MP4、封面图片及可复制的发布文案。
- FFmpeg/ffprobe 随应用打包为受控 sidecar；不得拼接用户输入的 shell 字符串；发布前核对许可证。
- 此计划不得加入 AI 付费调用。AI 工作由后续计划接入此计划定义的项目与时间线接口。

## Review Focus

1. 用户误选目录或扩展名伪装的损坏视频：导入返回可读错误，原项目与源文件不变（Task 3）。
2. 项目目录被移动或某素材被外部删除：打开项目成功，缺失片段在 UI 标记且导出被阻止（Tasks 2、5）。
3. 时间线为空或裁剪区间超出素材时长：拒绝导出并显示具体片段（Tasks 4、5）。
4. 字幕含引号、换行或中文路径：作为数据传给 FFmpeg，不能变成命令或损坏导出（Task 5）。
5. FFmpeg sidecar 缺失或进程失败：给出可恢复错误，不留下伪成功文件（Task 5）。

---

## File Map

| Path | Responsibility |
| --- | --- |
| `src-tauri/src/project.rs` | 创建、读取、原子保存项目清单与路径校验 |
| `src-tauri/src/media.rs` | 复制导入文件、ffprobe 元数据、缺失文件检查 |
| `src-tauri/src/export.rs` | 从时间线生成 FFmpeg 参数并写入 MP4/封面 |
| `src-tauri/src/lib.rs` | 注册受限 Tauri 命令 |
| `src/types/project.ts` | 项目、素材、片段、字幕的版本化前端类型 |
| `src/lib/native.ts` | Tauri invoke 封装，集中处理原生错误 |
| `src/features/projects/` | 项目创建、打开和保存界面 |
| `src/features/media/` | 媒体导入、预览、缺失状态 |
| `src/features/timeline/` | 纯编辑操作和时间线界面 |
| `src/features/export/` | 导出配置、状态、封面与文案 |

### Task 1: Desktop Shell and Test Harness

**Files:** Create `package.json`, `pnpm-lock.yaml`, `index.html`, `src/main.tsx`, `src/App.tsx`, `src/App.test.tsx`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`, `src-tauri/src/lib.rs`, `vite.config.ts`, `vitest.config.ts`.

**Interfaces:** Produces a launchable macOS Tauri window and `pnpm test`, `pnpm build`, `cargo check` commands. The window exposes “新建项目” and “打开项目” entry points without fake success states.

- [ ] **Step 1: Write failing UI smoke test.** `src/App.test.tsx` asserts both entry points appear and that selecting neither cannot show an export result.
- [ ] **Step 2: Run `pnpm test --run` and confirm the new test fails.**
- [ ] **Step 3: Scaffold the Tauri/React app and implement `App` with the two entry points.** Keep dependencies limited to those used in this task.
- [ ] **Step 4: Run `pnpm test --run`, `pnpm build`, and `cargo check --manifest-path src-tauri/Cargo.toml`; all pass.**
- [ ] **Step 5: Commit:** `git add package.json pnpm-lock.yaml index.html src src-tauri vite.config.ts vitest.config.ts && git commit -m "feat: scaffold macOS video editor"`.

### Task 2: Versioned Project Storage

**Files:** Create `src/types/project.ts`, `src/lib/native.ts`, `src-tauri/src/project.rs`, `src/features/projects/ProjectHome.tsx`; modify `src-tauri/src/lib.rs`, `src/App.tsx`; test `src-tauri/src/project.rs` Rust unit tests and `src/features/projects/ProjectHome.test.tsx`.

**Interfaces:** `ProjectManifestV1 = { version: 1; id: string; title: string; assets: MediaAsset[]; clips: TimelineClip[]; captions: Caption[]; publishingCopy: string; coverTimeMs: number | null }`. Native commands `create_project(root: PathBuf, title: String) -> Result<ProjectManifestV1, ProjectError>`, `open_project(root: PathBuf) -> Result<ProjectManifestV1, ProjectError>`, `save_project(root: PathBuf, manifest: ProjectManifestV1) -> Result<(), ProjectError>`. Frontend wrapper exposes the same operations as promises. Path references inside the manifest are project-relative.

- [ ] **Step 1: Write failing tests.** Creating a project writes `project.json` with `version = 1`; save/reopen round-trips title and empty arrays; a `../outside.mp4` relative path is rejected; moving the whole project directory preserves valid relative references.
- [ ] **Step 2: Run `cargo test --manifest-path src-tauri/Cargo.toml project` and `pnpm test --run ProjectHome`; confirm failures.**
- [ ] **Step 3: Implement atomic project save, version check, safe project-relative path validation, native wrappers and project home UI.** Create `media/source`, `media/generated` and `exports` under the selected root.
- [ ] **Step 4: Run the targeted tests plus `pnpm build` and `cargo check`; all pass.**
- [ ] **Step 5: Commit:** `git add src src-tauri && git commit -m "feat: persist independent video projects"`.

### Task 3: Media Import and Probe

**Files:** Create `src-tauri/src/media.rs`, `src/features/media/MediaLibrary.tsx`, `src/features/media/MediaLibrary.test.tsx`; modify `src/types/project.ts`, `src/lib/native.ts`, `src-tauri/src/lib.rs`, `src-tauri/tauri.conf.json`, `src/features/projects/ProjectHome.tsx`.

**Interfaces:** `MediaAsset = { id: string; kind: 'image' | 'video' | 'audio'; relativePath: string; durationMs: number | null; width: number | null; height: number | null; missing: boolean }`. Native `import_asset(root: PathBuf, source: PathBuf) -> Result<MediaAsset, MediaError>` copies into `media/source` and probes it; `audit_assets(root: PathBuf, assets: Vec<MediaAsset>) -> Vec<MediaAsset>` updates `missing`. No source file is moved or modified.

- [ ] **Step 1: Write failing tests.** Importing a valid small image/video/audio returns correct kind and a project-relative copy; a directory and a corrupt `.mp4` return errors; a missing copied asset is marked missing on audit; source bytes stay unchanged.
- [ ] **Step 2: Run `cargo test --manifest-path src-tauri/Cargo.toml media` and `pnpm test --run MediaLibrary`; confirm failures.**
- [ ] **Step 3: Implement validated import, collision-safe destination names, bundled development ffprobe sidecar and media library preview.** Use the file's probed content, not extension alone, to accept media; do not depend on a globally installed ffprobe.
- [ ] **Step 4: Run targeted tests and open the real app with one image and one short clip; confirm preview and no source modification.**
- [ ] **Step 5: Commit:** `git add src src-tauri && git commit -m "feat: import and inspect local media"`.

### Task 4: Editable Timeline

**Files:** Create `src/features/timeline/model.ts`, `src/features/timeline/model.test.ts`, `src/features/timeline/TimelineEditor.tsx`, `src/features/timeline/TimelineEditor.test.tsx`; modify `src/types/project.ts`, `src/App.tsx`.

**Interfaces:** `TimelineClip = { id: string; assetId: string; inMs: number; outMs: number; volume: number }`; `Caption = { id: string; startMs: number; endMs: number; text: string }`. Pure functions `appendClip(manifest, assetId)`, `trimClip(manifest, clipId, inMs, outMs)`, `moveClip(manifest, clipId, toIndex)`, `setClipVolume(manifest, clipId, volume)`, `upsertCaption(manifest, caption)` return a new `ProjectManifestV1` or typed validation error.

- [ ] **Step 1: Write failing tests.** Two imported clips can be reordered without changing asset files; an out-of-range trim is rejected; volume outside 0–1 is rejected; a caption with Chinese text survives save/reopen.
- [ ] **Step 2: Run `pnpm test --run timeline`; confirm failures.**
- [ ] **Step 3: Implement pure operations and a video preview with ordering, trim, volume and caption controls; persist via Task 2.**
- [ ] **Step 4: Run targeted tests and manually reopen a project after editing; decisions remain visible.**
- [ ] **Step 5: Commit:** `git add src && git commit -m "feat: edit short video timeline"`.

### Task 5: Local Export and Cover

**Files:** Create `src-tauri/src/export.rs`, `src/features/export/ExportPanel.tsx`, `src/features/export/ExportPanel.test.tsx`, `docs/third-party/ffmpeg.md`; modify `src-tauri/src/lib.rs`, `src-tauri/tauri.conf.json`, `src/lib/native.ts`.

**Interfaces:** `export_project(root: PathBuf, output_name: String) -> Result<ExportArtifacts, ExportError>`, where `ExportArtifacts = { videoRelativePath: string; coverRelativePath: string }`. MP4 is 9:16 H.264/AAC with caption timing from `Caption`; cover is a PNG selected by `coverTimeMs`. The implementation invokes packaged FFmpeg/ffprobe binaries with argument arrays, never through a shell.

- [ ] **Step 1: Write failing tests.** A fixture with two short clips, one caption and one volume change exports playable vertical MP4 and cover PNG; empty timeline, missing asset, invalid trim, caption containing quotes/newline, and unavailable FFmpeg return explicit results without a false completed output.
- [ ] **Step 2: Run `cargo test --manifest-path src-tauri/Cargo.toml export`; confirm failures.**
- [ ] **Step 3: Implement preflight, concat/scale/audio/caption export and atomic output rename; package matching macOS sidecars.** Document binary source, exact build configuration, license and attribution in `docs/third-party/ffmpeg.md`.
- [ ] **Step 4: Run targeted tests, inspect output with packaged ffprobe, and export from the running desktop app without network access.**
- [ ] **Step 5: Commit:** `git add src src-tauri docs/third-party && git commit -m "feat: export vertical video and cover offline"`.

### Task 6: Publishing Copy and Offline Acceptance

**Files:** Create `src/features/export/PublishingCopy.tsx`, `src/features/export/PublishingCopy.test.tsx`, `docs/acceptance/local-editor.md`; modify `src/App.tsx`, `src/features/export/ExportPanel.tsx`.

**Interfaces:** Editable `publishingCopy` stays in `ProjectManifestV1`; export screen offers copy-to-clipboard and local export without any network request. AI-generated copy will fill the same field in the next plan.

- [ ] **Step 1: Write failing tests.** Publishing text survives reopen; copy action copies the edited text; disconnected network does not disable media preview or local export.
- [ ] **Step 2: Run `pnpm test --run PublishingCopy`; confirm failures.**
- [ ] **Step 3: Implement publishing text controls and complete an offline acceptance walkthrough using locally generated fixture media.** Record the commands and observed output in `docs/acceptance/local-editor.md`.
- [ ] **Step 4: Run `pnpm test --run`, `pnpm build`, `cargo test --manifest-path src-tauri/Cargo.toml`, and launch the packaged macOS app; verify real import, edit, export and reopen.**
- [ ] **Step 5: Commit:** `git add src docs/acceptance && git commit -m "feat: finish offline editor workflow"`.

## Handoff to AI Plan

The next plan, `2026-10-27-ai-image-to-video.md`, may add generated assets through `MediaAsset`, place them on the same timeline, and use the same export path. It must not bypass local project persistence or alter the user's original media.
