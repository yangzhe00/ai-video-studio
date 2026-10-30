# Voiceover Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 Web 和桌面端提供镜头/分集的上传录音与可灵 TTS 两个配音入口，试听后导出有声音轨的新版本。

**Architecture:** 后端先扩展共享契约、版本化配方、语音资产与 TTS 任务，再让云端 FFmpeg 处理镜头和分集；前端只通过共享 API 和 DSL 保存选择与时间参数。原片和旧导出版本保持可访问。

**Tech Stack:** Node.js 24、TypeScript、Zod、React 19、Tauri 2、FFmpeg/ffprobe、pnpm、Vitest。

**Spec:** `docs/superpowers/specs/2026-10-30-voiceover-design.md`

## Global Constraints

- 本轮不开发真人或宠物对口型，也不把 TTS 完成等同于视频生成完成。
- 新生成视频固定 5 秒；旧 10 秒项目继续可读、可配音、可导出。
- 不从浏览器或桌面端暴露可灵密钥；付费 TTS 提交前显示确认，响应不确定时查询原供应商任务 ID。
- 可灵 TTS 官方接口只给事后实际扣费；按用户确认，线上可在明确告知按实际用量扣费并再次确认后提交，禁止显示虚构的事前报价。
- 后端拥有 `packages/api-contracts`、`packages/project-schema`、`plugins/video-edit/src/core.ts`、`apps/api`；前端拥有 `plugins/video-edit/src/web`、`src/native`、`apps/web`、`apps/desktop` 及其 UI。任何跨界面修改先核对已提交/已保存的共享类型。
- 不对共享脏工作树执行 `git reset --hard`、全量暂存或不分范围的提交；发布候选必须有独立可复现的源码快照。

## Review Focus

1. 上传录音与文字生成得到同一种语音资产，渲染链路没有两套音频解释。
2. 裁剪镜头后，配音起点与音频入点仍正确；过长或短音频不会造成黑屏、静音尾巴或意外循环。
3. 原声、配音、音乐三路混音；无原声音轨时 FFmpeg 仍成功，输出实际有声。
4. TTS 提交超时、服务重启、重复确认和回调/轮询重放不重复扣费。
5. 分集跨镜头配音、刷新恢复、旧项目读取及旧配方渲染不回归。
6. 合成预览和正式导出使用同一 FFmpeg 配方；旧预览对象有清理策略，不无限占用对象容量。

---

### Task 1: 共享语音协议与媒体校验（后端）

**Files:** `packages/api-contracts/src/requests.ts`、`responses.ts`、`errors.ts`；`packages/project-schema/src/assets.ts`、`clips.ts`；`plugins/video-edit/src/core.ts`；`apps/api/src/media-inspect.ts`、`upload.ts` 及对应测试。

**Interfaces:** 上传仍复用 `/objects`；新增语音资产绑定、镜头配音命令与分集 `voice` 轨道命令。配方新版本引用 `voice` 资产 ID、音频入/出点、画面内起点和音量；旧 V1 配方可迁读。

- [ ] 写失败用例：有效/损坏/超限录音、跨账号资产、非法时间或音量、旧配方兼容。
- [ ] 定义精确 Zod 请求/响应和错误码，并实现校验与持久化；文件类型以媒体探测为准。
- [ ] 跑共享契约、DSL、配方与 API 测试，记录命令和结果。

### Task 2: 可灵 TTS 可恢复任务（后端）

**Files:** `apps/api/src/kling.ts`、`config.ts`、`server.ts`、新建独立 TTS 任务/worker 文件与测试；必要的数据库迁移和 `.env.example`。

**Interfaces:** 服务端任务接受已确认的文字、音色、速度和客户端请求 ID；返回稳定任务 ID、状态及完成后的 `voiceAssetId`。查询、失败、重试和费用状态使用 `@ai-video/api-contracts`。不要把供应商 URL 直接作为永久资产。

- [ ] 先测试供应商成功、权限不足、超时、响应丢失、服务重启和重复提交。
- [ ] 实现创建/轮询/下载/保存；先查询原任务 ID，无法判断是否已提交时不得盲目重发 POST。
- [ ] 在隔离环境验证当前可灵凭据的 TTS 权限与服务器出站；凭据值不进入报告和日志。

### Task 3: 镜头与分集音频渲染（后端）

**Files:** `apps/api/src/render-worker.ts`、`video-edits.ts`、必要的分集渲染任务/worker、`apps/desktop/src-tauri/src/export.rs` 及测试。

**Interfaces:** 镜头继续按配方 revision 幂等渲染；分集按 DSL 时间线/轨道快照生成独立 operation 和 MP4。输出关联原始素材、配方/时间线 revision 和已确认语音资产 ID。

- [ ] 用真实短视频/音频 fixture 测试人声起点、裁剪、原声混音、音乐压低、无原声音轨及两镜头整集。
- [ ] 用参数数组执行 FFmpeg；限制耗时、并发、输出大小，失败清理临时文件，`ffprobe` 验证输出视频和音频流。
- [ ] 保留原片及旧版本；重复请求和 worker 恢复不产生第二个成功版本。

### Task 4: Web 与桌面配音交互（前端）

**Files:** `plugins/video-edit/src/web/VideoEditor.tsx`、`styles.css`、`plugins/video-edit/src/native/VideoEditor.tsx`、`apps/web/src/api.ts`、`apps/desktop/src/lib/cloud.ts`、分集时间线入口及对应测试。

**Interfaces:** 消费后端发布的共享类型；上传/文字生成都进入一个语音资产选择与试听区。镜头和分集都有开始位置、音量、原声处理、草稿保存和明确导出按钮。

- [ ] 交互测试覆盖上传、TTS 等待/失败/重试、试听、调节、刷新恢复、重复点击和旧项目。
- [ ] 实现可访问的忙碌、空、错误和成功状态；TTS 付费确认在请求前，未确认不调用供应商。
- [ ] 实际打开 Web 与桌面页面，检查新建 5 秒镜头、旧 10 秒镜头及两镜头分集；记录测试环境和截图。

### Task 5: 集成、发布及回归（发布负责人 + 测试）

**Files:** `docs/acceptance/` 下新增带日期的报告、截图与提交 SHA；必要的 `.codex/.agent` 开发文档。

- [ ] 同一候选 SHA 跑 `pnpm test`、`pnpm build`、Rust 相关测试和 API 契约检查；记录实际通过项与未测项。
- [ ] 在隔离环境做端到端上传/TTS/试听/镜头导出/整集导出，试听产物并用 `ffprobe` 检查音轨。
- [ ] 按既有发布计划备份、部署、验证线上版本；真实 TTS 费用必须由已确认的测试操作触发。
- [ ] 测试会话对线上相同 SHA 回归并保存可打开的页面与成片截图；缺陷回给开发会话修复后再复测。
