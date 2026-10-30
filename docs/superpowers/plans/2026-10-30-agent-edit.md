# Agent Editing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 Agent 给出结构化剪辑建议，由用户预览、修改、确认后安全应用到现有视频编辑和分集时间线。

**Architecture:** 后端生成并持久化有版本的建议集，使用共享 Schema 校验建议，再调用现有编辑/时间线命令。前端展示预览差异和逐条选择；确认与渲染是两个显式动作。

**Tech Stack:** TypeScript、Zod、React、现有 Node API、项目 DSL、视频编辑插件、Vitest。

**Spec:** `docs/superpowers/specs/2026-10-30-agent-edit-design.md`

## Global Constraints

- 不直接执行模型返回的代码、shell、FFmpeg 参数或任意 URL；不自动调用付费模型生成视频/TTS。
- 仅允许已有编辑命令与 DSL 支持的资源操作；服务端校验归属、时间边界、权限及 revision。
- 用户可继续手工剪辑，原片和历史版本不可被 Agent 静默覆盖。

## Review Focus

1. 幻觉 assetId、越界时间与未知动作均被拒绝。
2. 预览与确认之间发生人工修改时返回冲突，不覆盖新版本。
3. 两次确认同一建议集只应用一次。
4. 模型超时/输出无法解析时手工编辑仍可用。
5. 确认建议不自动触发付费视频/TTS 或 FFmpeg 渲染。

---

### Task 1: 建议 Schema 与持久化（后端）

**Files:** `packages/api-contracts/src/requests.ts`、`responses.ts`、`errors.ts`；`packages/project-schema/src/` 必要类型；`apps/api/src/schema.sql`、新建 `agent-edit.ts` 与测试。

**Interfaces:** `EditSuggestionSet` 包含建议 ID、目标资源与 revision、动作数组、可读理由和状态。动作是受限 discriminated union：裁剪、排序、字幕，以及引用已确认 `voice` 资产的配音。生成与确认请求都有稳定客户端请求 ID。

- [ ] 先写非法动作、时间、归属、旧 revision、重复请求测试。
- [ ] 实现 Schema、保存/查询/确认端点与事务幂等，不将模型输出视为可信命令。
- [ ] 跑契约、API、编辑和 DSL 测试。

### Task 2: Agent 生成与应用（后端）

**Files:** 新建 `apps/api/src/agent-edit-provider.ts`、worker 与测试；复用 `apps/api/src/video-edits.ts`、`project-dsl.ts`。

**Interfaces:** 模型只收到最小必要的镜头元数据和字幕/语音摘要；返回 JSON 建议集，经 Schema、业务校验后保存。确认时按 revision 调用已有纯编辑命令和项目命令，不直接处理媒体文件。

- [ ] 测试模型超时、非法 JSON、未知素材、重复确认、人工与 Agent 并发编辑。
- [ ] 实现有界执行、状态与错误恢复；供应商失败仅影响建议入口。
- [ ] 用可控 fixture 做端到端 API 回归。

### Task 3: 预览与人工确认（前端）

**Files:** `plugins/video-edit/src/web/VideoEditor.tsx`、`apps/web/src/`、`apps/desktop/src/`、相关 UI 测试。

**Interfaces:** 展示建议前后差异、理由和受影响资源；允许逐条接受/拒绝或返回手工编辑。确认按钮显示当前 revision；冲突提示刷新建议后再选择。

- [ ] 测试空、加载、失败、非法建议、版本冲突、重复点击和手动编辑回退。
- [ ] 实现建议卡、预览、选择和确认；确认后只保存草稿，不自动渲染。
- [ ] Web 与桌面实际操作并保存关键截图。

### Task 4: 回归（测试）

**Files:** `docs/acceptance/` 新报告和截图。

- [ ] 在同一提交 SHA 下复核自动化测试与浏览器/桌面实际操作。
- [ ] 检查未确认无改动、重复确认不重复、失败后可手工、历史版本可用。
- [ ] 给出通过/失败/未执行清单和可打开的截图；缺陷修复后复测。
