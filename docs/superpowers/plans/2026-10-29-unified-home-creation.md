# Unified Home Creation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 网页与桌面首页从同一个输入区支持 Agent 三版灵感和用户自有内容，持久保存创作原文后进入单镜头准备页或画布。

**Architecture:** `CreationBrief` 成为项目级独立资源。网页与桌面复用首页输入及作品设置组件；网页通过云 API 保存，桌面先保存本地项目并通过现有同步协议传递 brief。模型请求和视频审批继续走各自已有接口。

**Tech Stack:** React 19、TypeScript 6、Vite/Vitest、Node API、PostgreSQL、Tauri 2。

**Spec:** `docs/product/2026-10-29-unified-home-creation-prd.md`

## 交接与执行顺序

| 角色 | 交付任务 | 交付后交给谁 |
| --- | --- | --- |
| 后端 | Task 1–2：创作原文契约、项目原子创建、账号归属、命令重放与修订冲突；提供接口和聚焦测试结果。 | 前端接入；测试按 API 契约验收。 |
| 前端（Web 与 Desktop） | Task 3–5：统一输入与作品设置、项目归属、单镜头/画布跳转、原文展示与同步冲突、无项目空状态；提供构建和聚焦测试结果。 | 测试执行真实流程与截图验收。 |
| 测试 | Task 6：按 PRD A01–A12 覆盖正常、空、加载、失败、断线、账号切换及窄屏；保存运行截图和未通过项。 | 产品经理审核截图及范围，代码审查读取复测结果。 |
| 代码审查 | 测试完成后审查账号隔离、幂等、付费审批边界、原文不丢失及双端交互；提出可复现问题，修复后复审。 | 产品经理汇总最终结果。 |

每次审查修复后，先由独立测试复测对应场景，再记录最后一次构建、全量测试与审查结论。截图只证明实际捕获到的界面状态；未执行的真实视频调用、网页整集导出或原生崩溃恢复单列为验收边界。

## Global Constraints

- 首页只有一个主输入区、两个主动作；Agent 关键词 1–200 字，手写内容 1–10000 字，单镜头提示词 1–2000 字，按 Unicode 字符计数。
- Agent 只给同一镜头三版提示词，不自动拆完整剧本，不自动创建项目或视频任务。
- 项目创作原文不能伪装成可运行画布文本节点；多镜头由用户手动拆镜。
- 只有 G2 用户明确确认后才能提交视频服务；无项目/切页/建项目/进入画布不扣视频额度。
- 当前脏工作区有大量既有改动；只操作本计划文件，不重置或提交无关文件。

## Review Focus

1. 文字含 emoji/换行：前后端长度判断一致，按钮正确禁用；由 Task 1/3 测试。
2. 创建成功但响应丢失：同 ID 找回同项目及首条原文；由 Task 2/4 测试。
3. 原文同条记录在桌面/网页同时编辑：显示冲突，原文不被静默覆盖；由 Task 2/5 测试。
4. 旧项目没有 `briefs`：读取、编辑、同步不丢分集/时间线；由 Task 1/2/5 测试。
5. 整篇剧本误入单镜头：>2000 字不能选直接生成，≤2000 字手写需明确勾选；由 Task 3/4 测试。

---

## File map and interfaces

| 文件 | 职责 |
| --- | --- |
| `packages/project-core/src/brief.ts`（新） | `CreationBrief` 类型、校验及字符计数。 |
| `packages/project-core/src/sync.ts`、`cloud-api.ts`、`project.ts`、`index.ts`、`dsl/*` | 云文档/本地扩展、同步资源公开类型与 DSL 投影保留。 |
| `apps/api/src/server.ts`、`sync.ts`、`cloud-document.ts` | 新建项目时原子保存首条 brief，既有项目 brief 命令、旧项目迁移。 |
| `packages/ui-web/src/PromptIdeas.tsx`、`WorkSetup.tsx`（新）、`styles.css` | 一个输入框两个动作、三版结果、统一作品设置。 |
| `packages/components/src/ProjectHome.tsx`、`styles.css` | 首页主次布局。 |
| `apps/web/src/App.tsx`、`apps/web/src/styles.css` | 网页流程状态与云端跳转。 |
| `plugins/canvas/src/CanvasPage.tsx` | 画布中的非执行“创作原文”面板，供网页和桌面共用。 |
| `apps/desktop/src/App.tsx`、`features/projects/ProjectPicker.tsx`、`features/studio/StudioWorkspace.tsx`、`lib/sync.ts` | 桌面本地流程与云同步。 |

### Task 1: Define a versioned project brief contract

**Files:** create `packages/project-core/src/brief.ts`, `brief.test.ts`; modify `sync.ts`, `project.ts`, `cloud-api.ts`, `index.ts`, relevant `dsl/*`; test `apps/api/src/cloud-document.test.ts` or existing migration test.

**Interfaces:** produce `CreationBrief`, `creationBriefs(documentOrManifest): CreationBrief[]`, `validateCreationBrief(value: unknown): CreationBrief`; extend `SyncResourceType` with `"brief"` and cloud document with `briefs?: CreationBrief[]`. `originalText` and source IDs are immutable after creation; editing changes `finalText`/`updatedAt` with revision.

- [ ] Write failing tests: manual and agent brief validation, Unicode 10000-character boundary, missing `briefs` migration to `[]`, old episode/timeline preservation.
- [ ] Run focused tests and confirm new cases fail for missing contract.
- [ ] Implement types, validation, migration and exports; keep existing document version readable.
- [ ] In `packages/project-core`, run `./node_modules/.bin/vitest run src/brief.test.ts src/sync.test.ts` and the package TypeScript check; record passing output.
- [ ] Commit only Task 1 files when Git metadata is writable and scoped commits are permitted.

### Task 2: Persist briefs in cloud API with replay and conflict behavior

**Files:** modify `apps/api/src/server.ts`, `sync.ts`, `cloud-document.ts`; tests `apps/api/src/server.test.ts`, `db.test.ts` or dedicated `briefs.test.ts`.

**Interfaces:** `POST /projects` accepts optional `initialBrief: CreationBrief` and commits it with the first episode; `POST /projects/:id/commands` accepts `resourceType: "brief"`, `resourceId=brief.id`, `payload=brief`, `baseRevision`. `GET /projects/:id` returns brief list and revisions.

- [ ] Write failing API tests: atomic create, same ID same payload replay/recovery, same ID different payload conflict, owned Agent selection verification, cross-account 404, existing project append, edit revision conflict and preserved old brief.
- [ ] Run focused API tests and confirm expected failures.
- [ ] Implement server validation and SQL transaction for project plus initial brief; extend sync command validation, current payload and apply logic for `brief`.
- [ ] In `apps/api`, run `./node_modules/.bin/vitest run src/server.test.ts src/db.test.ts` and `./node_modules/.bin/tsc --noEmit`; record output.
- [ ] Commit only Task 2 files when allowed.

### Task 3: Build the shared home composer and work setup UI

**Files:** modify `packages/ui-web/src/PromptIdeas.tsx`, `styles.css`, `index.ts`, `packages/components/src/ProjectHome.tsx`, `styles.css`; create `packages/ui-web/src/WorkSetup.tsx`; tests `PromptIdeas.test.tsx`, `WorkSetup.test.tsx`, `packages/components/src/components.test.tsx`.

**Interfaces:** `PromptIdeas.onManual(text: string)` receives up to 10000 characters; `onRequest` receives at most 200. `WorkSetup` receives `CreationBrief` draft, project choices, mode `"direct" | "canvas"`, status and callbacks `onSubmit/onBack`; it does not call APIs itself.

- [ ] Write failing component tests for one input/two actions, Unicode limits, no initial selected variant, disabled/loaded/error/unknown labels, 6 fixed S1 controls, long-script direct guard, keyboard focus and mobile width classes.
- [ ] Run tests and confirm expected failures.
- [ ] Refactor UI and CSS: hero composer owns visual priority; `ProjectHome` no longer renders a second new-project main action when the composer is present; preserve standalone project-library entry.
- [ ] Run UI/component tests and TypeScript checks for affected packages.
- [ ] Commit only Task 3 files when allowed.

### Task 4: Wire the web journey and video approval boundary

**Files:** modify `apps/web/src/App.tsx`, `styles.css`, `App.test.tsx`, `plugins/canvas/src/CanvasPage.tsx`; optionally add `apps/web/src/creation-draft.ts` for account-scoped session persistence.

**Interfaces:** new `WebView` state `"work-setup"`; a draft contains stable brief/project/request IDs and selected mode; `POST /projects` carries `initialBrief`, existing project uses brief command. Direct mode routes to current preparation form; canvas mode routes to the target episode canvas. Shared `CanvasPage` receives `creationBriefs` and `onUpdateCreationBrief` props to show a non-executable brief panel.

- [ ] Write failing tests: manual path makes no Agent call; Agent path saves chosen version; new and existing project handoffs preserve text; project response loss recovers original; no project/video operation before approval; logout/account switch hides old draft.
- [ ] Run tests and confirm expected failures.
- [ ] Implement state transitions and recovery in `App`; reuse current plan/approve functions, add return path to S1; show canvas brief panel without creating executable nodes.
- [ ] In `apps/web`, run `./node_modules/.bin/vitest run --environment jsdom src/App.test.tsx` and `./node_modules/.bin/tsc --noEmit`.
- [ ] Commit only Task 4 files when allowed.

### Task 5: Wire desktop local creation and brief sync

**Files:** modify `apps/desktop/src/App.tsx`, `features/projects/ProjectPicker.tsx`, `features/studio/StudioWorkspace.tsx`, `lib/sync.ts`, `lib/sync-model.ts` if mapping requires it; tests `App.test.tsx`, `lib/sync.test.ts`, `features/studio/StudioWorkspace.test.tsx`.

**Interfaces:** local manifest `extensions.creationBriefs` uses Task 1 contract; `ProjectPicker` receives optional draft and mode, saves brief before opening; `StudioWorkspace` receives active brief and destination. `syncProject` maps local briefs to cloud `brief` resources and handles per-brief revision conflict.

- [ ] Write failing tests: unauthenticated manual path works/Agent disabled; local create-reopen retains brief; selected Agent text survives project choice; push/pull retains existing episodes and briefs; concurrent edit raises `SyncConflictError("brief", id, ...)`.
- [ ] Run focused desktop tests and confirm expected failures.
- [ ] Implement local handoff, cloud mapping/fingerprints and conflict display; do not infer synced state from login alone.
- [ ] Run desktop Vitest and TypeScript/Vite build; record outputs.
- [ ] Commit only Task 5 files when allowed.

### Task 6: Verify the whole flow and hand off acceptance evidence

**Files:** create `docs/acceptance/2026-10-29-unified-home-creation.md` and screenshot evidence folder; update PRD only for approved clarifications discovered during acceptance.

**Interfaces:** no new runtime interface; verify PRD A01–A12.

- [ ] Run API, shared UI, web and desktop focused suites and builds; note any existing unrelated failures separately.
- [ ] In isolated mock API, exercise Agent → new project → direct plan and manual script → canvas → two hand-built shots; check DB counts before video approval.
- [ ] Capture 1280×720 and narrow browser screenshots plus native desktop screenshot; where tooling blocks capture, state exact limitation instead of claiming acceptance.
- [ ] Review changed files for idempotency, ownership, script-to-video leakage, sync preservation and button/route consistency; fix defects and rerun affected tests.
- [ ] Record actual results and unresolved provider/environment limits in acceptance document; commit only scoped files when allowed.

## Self-review against PRD

Coverage: H0/H1/S1/G1/G2/C1 map to Tasks 3–5; persistent brief and Agent ownership to Tasks 1–2; desktop sync to Task 5; PRD A01–A12 to Tasks 1–6. Long scripts remain project materials until a user writes an individual runnable shot. Real provider generation is outside this plan's automated acceptance unless valid credentials are supplied.
