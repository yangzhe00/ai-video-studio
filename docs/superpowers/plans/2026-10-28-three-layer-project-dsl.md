# Three-Layer Project DSL Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建立覆盖基础、片段、资产三层的统一项目 DSL，并让旧本地/云端项目安全迁移、三端共享同一语义。

**Architecture:** 在独立 `@ai-video/project-schema` 中用 Zod 定义版本化 JSON 契约与跨层校验，`@ai-video/project-core` 提供旧本地/云端格式的纯迁移函数；API 的 `/v2/projects` 保存 DSL 且保持资源级修订号和对象台账，旧协议仅服务未迁移项目。桌面保留本地媒体绑定；画布图和视频微调配方各自拥有版本，只通过稳定 ID 引用核心实体。

**Tech Stack:** TypeScript 6、Zod 3.25.76、Vitest 4、pnpm workspace、Node API/SQLite、React 19、Tauri/Rust、Expo。

**Spec:** `docs/superpowers/specs/2026-10-28-three-layer-project-dsl-design.md`。

## 当前落地状态（2026-10-28）

- 已新增 `@ai-video/project-schema`：三层 Zod schema、跨层校验、默认项目创建器与聚焦测试。
- 已新增 `project-core` 的本地 V2、云端 V1 纯转换器和 DSL 响应解析器。API 暴露 `GET /projects/:id/dsl` 只读投影，能补回服务端历史微调版本；旧写入协议仍是当前权威路径。
- Task 4 的 `/v2/projects` 可写协议、对象绑定与生成/微调 worker 切换，以及 Task 5/6 的桌面、网页、移动端写入切换尚未执行。当前共享工作区有其他未提交改动，不将本次文件与其混合提交。

## Global Constraints

- `schema` 固定为 `"ai-video/project"`；首版 `dslVersion` 固定为 `1`，不能把本地 `version: 2` 或云端 `version: 1` 当作同一格式。
- 当前默认画幅 `1080 x 1920`、输出 `30 fps`、`mp4`；此阶段不新增比例或画面裁切 UI。
- 所有时间为非负安全整数毫秒，区间采用 `[start, end)`；音量为 `[0, 2]`。
- 一画布一分集；场景 ID、运行 ID、资产 ID、片段 ID 各自独立；片段固定引用资产 ID。
- 云端只接受已登记且当前账号有权使用的媒体；本地路径、对象位置、凭证、额度、实时运行状态和付费操作不进入 DSL。
- `/v2/projects` 的项目文档为 `VideoProjectV1`；旧 `/projects` 不得向已迁移项目写入 V1 命令。
- 保留未知命名空间扩展；高于 V1 的文档只读保护；迁移不触发生成、渲染或供应商 POST。
- 当前共享工作区已有前后端未提交修改；执行到其拥有的文件时，先等该任务完成并核对最终契约，只提交本任务改动的文件。

## Review Focus

- 旧本地素材缺 MIME/时长/尺寸或文件暂缺时，迁移保留素材与引用，报告待探测，禁止把猜值用于渲染（Task 2 测试）。
- 同一素材在时间线出现两次时，两个片段 ID、裁剪范围和位置均须保留（Task 3 测试）。
- 云端旧 `timeline` 与 `timelineClips` 不一致时，拒绝写入，不用顺序数组悄悄覆盖裁剪信息（Task 3、4 测试）。
- 新视频版本产生后，现有片段仍指向原资产，只有显式命令才可替换（Task 1、5 测试）。
- 未知扩展和更高主版本从任一端经过读取/同步后不得被删除或降级写回（Task 1、4、6 测试）。

---

## 文件与职责

| 文件 | 职责 |
| --- | --- |
| `packages/project-schema/src/assets.ts`、`clips.ts`、`foundation.ts` | 三层 Zod 结构、推断类型、字幕/音频兼容变体 |
| `packages/project-schema/src/validate.ts` | 跨层引用校验，返回可定位的问题 |
| `packages/project-core/src/dsl/migrate-local.ts` | 从 `ProjectManifestV2` 迁移并提取本地媒体绑定 |
| `packages/project-core/src/dsl/migrate-cloud.ts` | 从 `CloudProjectDocument` V1 迁移；不替代 API 现有同名升级函数 |
| `packages/project-core/src/dsl/index.ts` | 对外稳定导出 |
| `apps/api/src/cloud-document.ts`、新 `apps/api/src/sync-v2.ts` | 旧文档升级、DSL 资源命令校验、持久化读写边界 |
| `apps/desktop/src/lib/sync.ts`、现有 Rust 项目备份入口 | 本地 V2 磁盘格式保持唯一写入源；同步边界生成 DSL 投影和素材绑定 |
| `apps/web/src/App.tsx`、`apps/mobile/src/App.tsx` | 消费同一 DSL 投影；网页/移动端不复制校验规则 |

每个纯函数配同目录 `*.test.ts`。UI 测试沿用各应用现有测试文件。若执行前相关模块已被前后端任务重构，保持上述职责与接口，将改动落到重构后的对应文件，并在提交说明记录映射。

### Task 1: 三层类型与校验器

**Files:**
- Create: `packages/project-schema/package.json`
- Create: `packages/project-schema/tsconfig.json`
- Create: `packages/project-schema/src/assets.ts`
- Create: `packages/project-schema/src/clips.ts`
- Create: `packages/project-schema/src/foundation.ts`
- Create: `packages/project-schema/src/validate.ts`
- Create: `packages/project-schema/src/validate.test.ts`
- Create: `packages/project-schema/src/index.ts`
- Modify: `pnpm-lock.yaml`

**Interfaces:**
- Produces: `VideoProjectV1`, `EpisodeV1`, `SceneV1`, `TimelineTrackV1`, `TimelineClipV1`, `AssetV1`。
- Produces: `validateProjectDsl(document: VideoProjectV1): DslIssue[]`；`parseProjectDsl(raw: unknown): { ok: true; project: VideoProjectV1 } | { ok: false; issues: DslIssue[] }`。`DslIssue = { path: string; code: string; message: string; severity: "error" | "warning" }`。
- `validateProjectDsl` 校验语义；`parseProjectDsl` 先检查未知输入的形状与版本，再调用前者，不能仅用 `as` 断言。

- [ ] **Step 1: 写失败测试。** 在 `validate.test.ts` 写 `accepts_reference_photo_scene_video_clip`、`rejects_dangling_or_wrong_kind_asset`、`rejects_overlap_and_invalid_time`、`new_output_does_not_retarget_existing_clip`、`preserves_namespaced_extension`、`rejects_future_major_version`；分别断言 spec 示例通过、问题包含精确 `path`/`code`、原 clip 的 `assetId` 不变、高版本 `parseProjectDsl` 返回 `ok:false`。
- [ ] **Step 2: 运行失败测试。** `pnpm --filter @ai-video/project-schema test -- src/validate.test.ts`；预期因导出不存在而失败。
- [ ] **Step 3: 实现类型和校验。** 类型字段与 spec“规范性数据契约”一致；`parseProjectDsl(raw: unknown)` 对数组、数字、字符串、`schema`、`dslVersion` 做运行时检查；`validateProjectDsl` 检查唯一 ID、引用类型、轨道类型、时长、视觉轨重叠、选择版本和来源环。
- [ ] **Step 4: 运行测试与类型检查。** `pnpm --filter @ai-video/project-schema test -- src/validate.test.ts`、`pnpm --filter @ai-video/project-schema build`；预期全过。
- [ ] **Step 5: 仅提交 Task 1 文件。** 提交信息 `feat(project-core): define three-layer project DSL`。

### Task 2: 本地 V2 转换与媒体绑定

**Files:**
- Create: `packages/project-core/src/dsl/migrate-local.ts`
- Create: `packages/project-core/src/dsl/migrate-local.test.ts`
- Modify: `packages/project-core/package.json`
- Modify: `packages/project-core/src/index.ts`

**Interfaces:**
- Consumes: `@ai-video/project-schema` 的 `VideoProjectV1`、`DslIssue`、`parseProjectDsl`。
- Produces: `LocalAssetBinding = { assetId: string; relativePath: string; missing: boolean; cloudObjectId?: string; uploadState?: "pending" | "uploaded" | "failed" }`。
- Produces: `migrateLocalV2ToDsl(manifest: ProjectManifestV2): { project: VideoProjectV1; bindings: LocalAssetBinding[]; issues: DslIssue[]; activeEpisodeId: string }`；不可恢复的 ID 冲突/损坏引用以有路径的错误拒绝，未知媒体信息给 warning。

- [ ] **Step 1: 写失败测试。** 用含两集、人物、照片、视频、音频、字幕、裁剪、音量、发布文案、封面和 `extensions.canvas` 的 V2 fixture 断言 ID 与数据保留；再用 `mimeType`/时长未知及 `missing:true` 素材断言保留引用和 warning；验证同一素材被两个 clip 引用时仍有两个 clip ID；验证未知 `job.state` 没有被解释成新提交。
- [ ] **Step 2: 运行失败测试。** `pnpm --filter @ai-video/project-core test -- src/dsl/migrate-local.test.ts`；预期因函数不存在失败。
- [ ] **Step 3: 实现迁移。** 先用 `syncActiveEpisode` 将根 `clips/captions` 写回活动集，再复用 `ensureStudio`/`readCanvasDocument`；无 studio 时只构造一集。按已有次序累计 `startMs`，每条字幕生成 ID 为 `subtitle-asset:${episodeId}:${captionId}` 的资产且以原 caption ID 为片段 ID，未分类音频保留为 `audio`。成功的旧任务若有已登记视频 `outputAssetId`，加入对应 `Scene.outputAssetIds`；未完成或未知任务不造输出。旧封面时间定位到视觉片段并换算源时间；无法定位则保存于 `extensions.legacy.localCoverTimeMs` 并报告 issue。旧 `GenerationJob.id` 不得写入 `Scene.runIds`；旧任务状态仍留在 V2 磁盘账本。
- [ ] **Step 4: 运行测试与类型检查。** `pnpm --filter @ai-video/project-core test -- src/dsl/migrate-local.test.ts`、`pnpm --filter @ai-video/project-core build`；预期全过。
- [ ] **Step 5: 仅提交 Task 2 文件。** 提交信息 `feat(project-core): migrate local project manifest to DSL`。

### Task 3: 云端 V1 转换与片段元数据

**Files:**
- Create: `packages/project-core/src/dsl/migrate-cloud.ts`
- Create: `packages/project-core/src/dsl/migrate-cloud.test.ts`
- Modify: `packages/project-core/src/index.ts`

**Interfaces:**
- Consumes: Task 1 类型/校验，以及现有 `cloudTimelineClips`；不与 `apps/api/src/cloud-document.ts` 的 `migrateCloudDocument` 同名。
- Produces: `migrateCloudV1ToDsl(document: CloudProjectDocument, context: { projectId: string; title: string; versionsByShotId: Record<string, { outputAssetId: string; coverAssetId?: string; recipeId: string; createdAt: number }[]> }): VideoProjectV1`。调用方从 `video_edits` 和成功的 `render_operations` 按时间、操作 ID 稳定排序提供历史；纯函数不读数据库。

- [ ] **Step 1: 写失败测试。** 覆盖仅有旧 `timeline` 的云文档、已有 `timelineClips` 的文档、一素材出现两次、`volume: 1.5`、`originalAssetId`/`selectedAssetId` 编辑版本、两次历史成功渲染、人物参考图和未知 `extensions.canvas`；断言片段 ID/顺序/裁剪/音量与原数据一致，`startMs` 连续累计，历史输出均进 `outputAssetIds`，封面输出仍可检索；不一致的两种时间线表示必须报错。
- [ ] **Step 2: 运行失败测试。** `pnpm --filter @ai-video/project-core test -- src/dsl/migrate-cloud.test.ts`；预期因函数不存在失败。
- [ ] **Step 3: 实现纯转换。** 使用现有确定性旧 clip 补全规则；`Scene` 保留 shot ID 和由文档加历史上下文取得的所有输出资产 ID；云资产尚无 MIME/尺寸时填 `null`，不猜值；只读输入，不写数据库、不调用供应商。
- [ ] **Step 4: 运行测试与类型检查。** `pnpm --filter @ai-video/project-core test -- src/dsl/migrate-cloud.test.ts`、`pnpm --filter @ai-video/project-core build`；预期全过。
- [ ] **Step 5: 仅提交 Task 3 文件。** 提交信息 `feat(project-core): migrate cloud project document to DSL`。

### Task 4: API V2 协议与事务迁移

**Files:**
- Modify: `apps/api/package.json`
- Modify: `apps/api/src/cloud-document.ts`
- Modify: `apps/api/src/db.ts`
- Create: `apps/api/src/sync-v2.ts`
- Modify: `apps/api/src/server.ts`
- Modify: `apps/api/src/runs.ts`
- Modify: `apps/api/src/generation-worker.ts`
- Modify: `apps/api/src/video-edits.ts`
- Modify: `apps/api/src/render-worker.ts`
- Create: `packages/project-core/src/cloud-api-v2.ts`
- Modify: `packages/project-core/src/index.ts`
- Test: `apps/api/src/server.test.ts`
- Test: `apps/api/src/db.test.ts`
- Modify: `pnpm-lock.yaml`

**Interfaces:**
- Consumes: Task 1 `parseProjectDsl`/`validateProjectDsl`、Task 3 `migrateCloudV1ToDsl`。
- Produces: `ProjectDslSnapshot = { id: string; title: string; revision: number; document: VideoProjectV1; resourceRevisions: SyncResourceRevision[] }` 与 `parseProjectDslSnapshot(raw: unknown): ProjectDslSnapshot`（`cloud-api-v2.ts`）。
- Produces: `/v2/projects` 的 GET/POST、新格式 `/v2/projects/:id` 的 GET、`/v2/projects/:id/commands` 的 POST 和受鉴权的 `/v2/projects/:id/assets/:assetId/content`；命令仍含 `id/resourceType/resourceId/baseRevision/payload`，`episode/asset/character/canvas` payload 分别为 `EpisodeV1/AssetV1/CharacterV1/CanvasEpisodeGraphV1`。媒体 asset 命令另带 `objectId` 作服务端绑定，纯字幕资产不带；不得开放整份文档无条件覆盖。

- [ ] **Step 1: 等待当前后端 B1/B2 任务交接并检查最终 `CloudTimelineClip` 字段。** 若代码已涵盖部分校验，保留其实现，补差异即可。
- [ ] **Step 2: 写失败测试。** V2 POST 新建标准 DSL，首次 V2 GET 将旧云 V1 文档事务迁移并保存原 JSON 备份，返回可解析 `ProjectDslSnapshot`；同项目旧 V1 GET/写命令返回升级错误；V2 可保存 voice/music/subtitle 轨及 `startMs`。新上传本地资产 ID 与对象 ID 不同仍可被镜头和片段引用、按项目资产 ID 预览；跨账号预览返回 403/404；旧云资产建立同值绑定；旧关联项目的 `assetMap` 别名仍可访问。伪造外项目资产、未来 DSL 版本、时间线双表示不一致、损坏画布引用均返回明确 4xx 且数据库原文不变；未知命名空间扩展、命令 ID 和资源修订号在迁移/写入后保留。生成和微调各新增一版资产后旧片段不变。
- [ ] **Step 3: 运行失败测试。** `pnpm --filter @ai-video/api test -- src/server.test.ts src/db.test.ts`；预期新增断言失败。
- [ ] **Step 4: 实现 V2 路由和事务迁移。** 添加 `@ai-video/project-core: workspace:*`；在 `db.ts` 增加只追加的旧文档备份记录和唯一 `(project_id,asset_id)` 的对象绑定表，旧云资产以同值 ID 回填。迁移先校验、再同事务保存原文、历史版本、资产绑定和 DSL；V2 命令按资源修订号写子资源，入库前校验整份引用并复用服务端对象所有权检查。旧 V1 路由对已迁移项目返回升级错误；解析高版本时拒绝写入，不能降级保存。
- [ ] **Step 5: 改造运行请求的资产解析。** 新 V2 请求必须提交已保存的 `sceneId`；`runs.ts` 在运行前把项目资产 ID 解析为当前账号的对象 ID。旧 V1 路径保留其现有对象 ID 语义；未升级的旧请求不能写入 V2 项目。
- [ ] **Step 6: 改造生成 worker。** 新 V2 结果保存对象后另建资产 ID 和绑定，更新原 `Scene.outputAssetIds/selectedAssetId/runIds`，不改旧 clip；旧 V1 项目仍走其现有格式。历史镜头 ID 可保留旧 run ID，新运行的 scene ID 独立于 run ID。
- [ ] **Step 7: 改造微调与渲染。** `video-edits.ts` 对 V2 通过绑定解析原视频，版本列表返回项目资产 ID；`render-worker.ts` 对 V2 建立新视频/封面资产及绑定，更新原场景版本，不改旧 clip；V1 路径保持兼容。
- [ ] **Step 8: 运行 API 测试与类型检查。** `pnpm --filter @ai-video/api test -- src/server.test.ts src/db.test.ts src/generation-worker.test.ts`、`pnpm --filter @ai-video/api build`；预期全过。
- [ ] **Step 9: 仅提交 Task 4 文件。** 提交信息 `feat(api): persist versioned project DSL`。

### Task 5: 桌面本地项目与同步适配

**Files:**
- Modify: `apps/desktop/src/lib/sync.ts`
- Modify: `apps/desktop/src/features/studio/StudioWorkspace.tsx`
- Test: `apps/desktop/src/lib/sync.test.ts`
- Test: `apps/desktop/src/features/workspace/ProjectWorkspace.test.tsx`

**Interfaces:**
- Consumes: Task 2 `migrateLocalV2ToDsl`、Task 4 的 DSL 读取投影；继续使用当前资源级冲突协议。
- Produces: 旧本地项目的 DSL 投影与媒体绑定；V2 磁盘格式仍由现有 Rust 入口保存，UI 中的片段/资产操作只改变有权改变的 ID 引用。

- [ ] **Step 1: 等前端 F1/F2 与后端 B1 结束共享文件编辑，核对现有备份和同步路径。** 不覆盖其上传状态/冲突处理。
- [ ] **Step 2: 写失败测试。** 旧项目迁移后重开保持片段 ID、入出点、音量、字幕、画布；媒体暂缺时旧文件和绑定仍可恢复；从 V2 云文档拉取含 voice/music 轨后，桌面修改视觉轨再推回不会丢这些不支持编辑的轨；旧关联项目的 `assetMap` 别名仍有效；新编辑视频只更新场景选择，不改旧 timeline clip；同资源并发编辑仍进入显式冲突处理。
- [ ] **Step 3: 运行失败测试。** `pnpm --filter @ai-video/desktop test -- src/lib/sync.test.ts src/features/workspace/ProjectWorkspace.test.tsx`；预期新增断言失败。
- [ ] **Step 4: 接入转换与安全写入。** 在桌面 TS 同步边界调用纯迁移器，保留 V2 磁盘唯一写入路径与现有 Rust 原子保存/备份能力；`extensions.projectDslSnapshot` 保存不可由旧 UI 表达的原始 DSL 与版本，更新视觉轨/字幕时只修改对应资源，不从旧 V2 字段整份重建。绑定数据沿用已有云绑定扩展；新上云资产使用原本地资产 ID，旧关联项目保留 `assetMap` 别名。首次上云前调用现有备份入口；转换失败时不调用保存或同步。若未来要让磁盘直接存 DSL，需另开 Rust 读写迁移计划和回滚验收。
- [ ] **Step 5: 运行桌面测试与类型检查。** `pnpm --filter @ai-video/desktop test -- src/lib/sync.test.ts src/features/workspace/ProjectWorkspace.test.tsx`、`pnpm --filter @ai-video/desktop build`；预期全过。再做真实旧项目备份、打开、关闭、重开验收。
- [ ] **Step 6: 仅提交 Task 5 文件。** 提交信息 `feat(desktop): adapt local projects to shared DSL`。

### Task 6: 网页/移动端消费与全链路验收

**Files:**
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/mobile/src/App.tsx`
- Test: `apps/web/src/App.test.tsx`（不存在则新建）
- Create: `apps/mobile/src/project-dsl.ts`（从 RN 页面提取纯转换/命令逻辑）
- Test: `apps/mobile/src/project-dsl.test.ts`
- Modify: `apps/mobile/package.json`
- Modify: `pnpm-lock.yaml`（如需加入 Vitest）
- Modify: `docs/architecture/project-dsl.md`（新建时记录读取、迁移和 ID 边界）

**Interfaces:**
- Consumes: Task 4 的项目 DSL 投影与现有 `SyncCommand`；桌面、网页、移动端共用 Task 1 的类型和校验结果。
- Produces: 三端一致的分集/场景/时间线展示与显式版本替换命令；移动端只读懂并保留画布扩展，不注入画布 UI。

- [ ] **Step 1: 写失败测试并补移动端测试脚本。** 网页页面与移动端纯转换函数读同一 DSL 都保留两次引用同一资产的两个片段；网页保存画布后移动端写分集不丢 `extensions.canvas`；未来版本显示升级/只读提示且不调用写 API；版本选择不改变既有片段，显式“用于时间线”才改变指定片段。移动端增加 `vitest run` 脚本和依赖，不从测试导入 RN UI。
- [ ] **Step 2: 运行失败测试。** `pnpm --filter @ai-video/web test -- src/App.test.tsx`、`pnpm --filter @ai-video/mobile test -- src/project-dsl.test.ts`；预期新增断言失败。
- [ ] **Step 3: 消费共享 DTO 和校验器。** 删去各端对项目/片段的重复手写类型与默认时长猜测；按 `startMs` 展示位置，以资产 ID 取媒体；版本替换提交资源命令并带 `baseRevision`。不在移动端加载画布插件。
- [ ] **Step 4: 运行聚焦测试和 workspace 检查。** 两端聚焦测试、`pnpm --filter @ai-video/web build`、`pnpm --filter @ai-video/mobile build`、`pnpm check:boundaries`；预期全过。再用同一旧项目完成桌面重开、网页刷新、移动端打开，核对片段/字幕/资产版本与扩展均一致；不执行付费生成验收。
- [ ] **Step 5: 更新架构说明并只提交 Task 6 文件。** 提交信息 `feat(clients): consume shared project DSL`。

## 执行顺序与停止条件

Task 1 → 2/3 → 4 → 5/6。Task 2/3 都只写纯函数，可按实际工作区情况串行执行。Task 4/5/6 进入前先完成当前前后端架构修复任务的文件交接；若其最终契约与本设计冲突，先修订本 spec 和计划，再动持久化代码。任何迁移测试出现 ID、裁剪、字幕、画布或未知扩展丢失时，停止上线切换并保持旧格式只读/可恢复。
