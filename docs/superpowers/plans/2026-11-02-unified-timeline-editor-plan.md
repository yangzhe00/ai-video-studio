# Unified Episode Timeline Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** 用可视化整集时间线替换网页和桌面旧配音界面，让用户拖动、裁剪、对齐、即时试听配音并完成精准预览与导出。

**Architecture:** 画布的整集时间线进入独立全屏编辑工作台。前端用统一分集修订和音频片段模型编辑本地草稿，松手后提交一次；即时试听消费本地草稿，服务器继续按已保存快照做精准预览与导出。旧项目、旧镜头配方和旧成片继续读取。

**Tech Stack:** React 19、TypeScript、Zod、pnpm workspace、Tauri 2、Node.js API、PostgreSQL、FFmpeg。

**Spec:** docs/product/2026-11-02-unified-timeline-editor-prd.md

**Prototype:** design/prototypes/episode-timeline-editor/index.html

## Global Constraints

- 只对 Web 和 macOS 桌面交付多轨编辑；移动端本轮只验证共享文档可读。
- 不把前端模拟试听算作最终 MP4 验收；不把旧配音弹窗简单换皮。
- 不清空、重建或覆盖其他会话当前未提交的工作树；先核对各自 checkout 和候选版本。
- 供应商凭据只在服务端；TTS 二次确认与任务恢复机制继续有效。
- 新编辑使旧精准预览失效；导出绑定已保存分集修订，并保留原片与旧成片。

## Task 1：共享时间线契约与迁移（后端主责，前端评审）

**现有位置：** packages/project-core/src/sync.ts、packages/project-schema/src/clips.ts、packages/api-contracts/src/requests.ts、apps/api/src/server.ts、plugins/video-edit/src/core.ts。

- [ ] 明确单一写入来源：现有 CloudEpisode.timelineClips、episode.audio 与三层 DSL tracks 的关系。输出稳定音频片段 ID、锚点/偏移、绝对时间、素材入/出点、音量及资源修订的共享类型和读写协议。
- [ ] 先写失败用例：旧多段语音和音乐完整投影；旧数据无锚点时保持绝对位置；旧单镜头已混音视频不重复加语音；镜头重排后新锚点语音跟随；跨账号素材和非法范围拒绝；旧 10 秒片仍可读。
- [ ] 实现向后兼容读取与版本化写入。若需迁移，先提供只读核验、备份和回退说明；不能在旧客户端写入时静默丢失新字段。
- [ ] 向前端交付契约样例：空分集、3 镜头、2 配音 + 1 音乐、旧项目、409 冲突及失效素材。前端在契约固定后开始持久化接线。

## Task 2：分集编辑保存与精确渲染（后端）

**现有位置：** apps/api/src/previews.ts、episode-renders.ts、episode-media.ts、audio-render.ts、server.ts；packages/api-contracts/src。

- [ ] 验证现有分集命令能一次保存多段语音/音乐、镜头原声设置及锚点；需要时新增粒度明确的命令，不以每个 pointermove 发写请求。
- [ ] 保存采用分集 baseRevision 与稳定 commandId；重复提交幂等、版本冲突 409、无权限 403/404、素材失效和时长越界均返回可操作错误。
- [ ] 上传录音和背景音乐分别登记 voice/music 资产；保持真实媒体探测、容量和账号权限约束。
- [ ] 精准预览与正式导出读取同一已保存修订，核对多段重叠、跨镜头配音、原声静音/音量、无声源片、旧 10 秒镜头。重复预览/导出沿用原 operation；结果有 AAC 音轨且原片不变。
- [ ] 保持 TTS 费用说明、二次确认及未知提交结果查询原任务。无法认证供应商时返回明确状态，上传录音仍可使用。

## Task 3：共用时间线组件与即时试听（前端）

**建议新增：** plugins/video-edit/src/web/EpisodeTimelineEditor.tsx、timeline-model.ts、timeline-preview.ts 及对应样式/测试；确切拆分由前端按仓库规范决定。

- [ ] 基于 Task 1 契约渲染画面、镜头原声、配音、音乐轨，完整展示全部已有片段。画面轨按现有镜头顺序和裁剪长度计算切点。
- [ ] 实现素材拖入、片段移动、两端裁剪、镜头切点/播放头吸附、0.1 秒精确输入、片段删除、键盘移动、时间尺缩放、播放头定位；添加/删除不删除源资产。
- [ ] 实现分组撤销/重做、本地草稿、保存中/失败/冲突状态。拖动时不调用保存；松手后一次提交并可刷新恢复。
- [ ] 建立即时试听：已缓存素材从当前播放头连续播放画面、原声、语音和音乐；缓冲或失败有诚实提示。先用浏览器与 Tauri 实际播放验证音画偏差，再决定底层媒体调度方式；不在此计划中预设新依赖。
- [ ] 组件测试覆盖多片段可见、跨切点拖动、越界提示、0.1 秒输入、撤销/重做、失效素材、无声视频、保存失败与 409 冲突。对 15 秒示例测量试听启动和起点偏差。

## Task 4：网页、桌面入口与旧 UI 下线（前端）

**现有位置：** plugins/canvas/src/CanvasPage.tsx、apps/web/src/App.tsx、apps/desktop/src/features/studio/StudioWorkspace.tsx、plugins/video-edit/src/web/VideoEditor.tsx、VoiceoverWorkflow.tsx、AgentEditWorkflow.tsx。

- [ ] 画布“整集时间线”进入新全屏页，返回时回到同一项目同一分集。结果页支持选中片段加入分集后进入新页；未登录/未同步/空分集有明确引导。
- [ ] 移除 Web 本集配音弹窗、桌面整集配音独立页与镜头微调中的配音表单入口；保留镜头裁剪/字幕/封面及旧配方读取。迁移整集 Agent 建议入口到新页，引用当前分集修订。
- [ ] 素材库提供上传录音/音乐、选择既有资产、文字生成配音；TTS 不自动放入时间线、不绕过费用确认。没有供应商能力时显示可用替代路径。
- [ ] 精准预览与导出展示待处理、成功、失败、查询原任务；新编辑后旧预览不可误用。实测 Web 和桌面 1440×900 与 900px 窄窗口、浅色/深色主题、键盘焦点。

## Task 5：集成、代码审查与测试交接（前后端 + 测试）

- [ ] 前后端先锁定同一候选 commit/源码快照、契约版本与测试环境，报告实际改动清单及未解决问题。
- [ ] 运行受影响包测试、Web/桌面构建、API/DSL/契约测试、根 pnpm test/build、git diff --check；Rust 代码如有改动再运行 cargo test/check。
- [ ] 将 docs/acceptance/2026-11-02-unified-timeline-editor-test-scope.md 发给测试会话；修复测试发现的缺陷后由测试独立复测。
- [ ] 测试完成后进行代码审查：数据不丢失、版本冲突、音画时间一致、TTS 费用门禁、旧 UI 入口是否彻底迁移、窄屏和可访问性。
- [ ] 测试按用例输出通过/失败/阻塞/未测、测试版本、环境、截图绝对路径、可播放 MP4/ffprobe 音轨证据。未经过线上部署，不写“公网通过”。

## Review Focus

1. 旧分集若已有第二段语音或音乐，打开新页和保存后仍完整存在。
2. 已混音镜头作为视觉片段加入整集时，不把该语音自动再叠加一遍。
3. 镜头重排与跨镜头旁白在锚点和绝对时间两种模式下都不漂移。
4. 前端即时试听、服务器精准预览、正式导出在起点、裁剪和音量上保持一致。
5. 离线保存、另端更新、重复导出与 TTS 未知提交结果不造成丢稿、覆盖或重复付费。
