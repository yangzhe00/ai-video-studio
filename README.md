# Taskify 视频成片工作台

面向个人创作者的一站式竖屏短视频工作台：选题灵感 → 讲稿 → 图片素材 → 动态视频片段 → 模板合成配音字幕 → 9:16 成片下载。

> 本项目按 SDD（spec-kit）模式开发，产品基线见 `docs/product/`，规格/方案/任务见 `specs/001-video-workbench/`，项目宪法见 `.specify/memory/constitution.md`。

## 技术栈

- **前端**：React 19 + TypeScript + Tailwind CSS 4 + Vite 6 + Zustand（pnpm monorepo）
- **后端**：Python 3.12 + FastAPI + SQLAlchemy 2 + PostgreSQL + ffmpeg
- **外部能力**：全部 Provider 抽象 + Mock 默认（可灵视频生成 / 火山引擎 TTS / LLM / 短信 / 对象存储），演示模式无真实 API 依赖
- **真实供应商**（配置 Key 即生效，留空自动回退 Mock，见 `server/.env.example`）：
  - **LLM = Cursor Cloud Agents**：选题/讲稿/分镜提示词（`CURSOR_API_KEY`，与第一版 ai-video-studio 同源通道）
  - **视频生成 = 可灵 kling-2.5-turbo**：图生视频 + 视频下载落盘（`KLING_API_KEY`，北京节点）

## 目录

```
apps/web/          Web 端（一期唯一端，packages/* 保持可移植）
packages/ui/       通用组件库（Button/Input/TaskStateBadge/EmptyState...）
packages/api-client/  统一 API 层
packages/shared/   类型 / 任务状态机 / 可配置常量
server/            FastAPI 后端（api/models/services/providers/core）
docs/product/      产品基线（01-业务界定 ~ 04-交互定义）
docs/screenshots/  UI 验证截图
```

## 启动

```bash
# 前端
pnpm install
pnpm --dir apps/web dev          # http://localhost:5173

# 后端（需本地 PostgreSQL，连接串见 server/.env.example）
cd server
uv sync
uv run uvicorn app.main:app --port 8000
```

登录：任意 11 位手机号 → 获取验证码（演示模式直接回显）→ 登录。新用户自动发放 1000 演示额度。

## 演示流程（黄金任务流）

1. **选题与讲稿**：输入关键词生成 5 条选题 → 选定 → 生成 5 段讲稿 → 生成分镜提示词
2. **素材库**：上传图片或站内 AI 生图（Mock 生成占位图）
3. **生成任务**：逐段关联素材 → 提交生视频（额度预检）→ 片段生成（Mock 占位视频）
4. **合成工作台**：选模板 → AI 配音 → 要素校验 → 提交合成（ffmpeg 真实合成 9:16 mp4）
5. **成片库**：在线预览 → 下载（文件名含选题+日期）→ 版本历史（保留 10 版）

辅助：任务中心（全站异步任务看板/失败分类/重试）、用量与额度（余额/20% 预警/明细）。

## 原子化样式系统（三层 + 多主题一键切换）

样式按依赖方向单向分三层（`apps/web/src/styles/`，层序在 `index.css` 用 `@layer` 固化，不可调换）：

| 层 | 文件 | 职责 | 约束 |
|---|---|---|---|
| ① atoms | `01-tokens.css` | 原始色阶/字号/间距/圆角/动效常量 | 只存数值，禁止语义命名 |
| ② ui | `02-components.css` | `.btn/.card/.badge/.nav-item` 等组件类与页面骨架类 | 只允许引用 atoms 常量与语义令牌，禁止硬编码色值 |
| ③ global | `03-themes.css` | 主题令牌映射（`[data-theme]`）+ 基础重置 + 应用壳 | 换肤只改这一层 |

**配色方案一键切换**：顶栏色点切换器写入 `<html data-theme>` + localStorage（首屏由 `index.html` 内联脚本同步，无闪白）。内置 4 套：`aurora` 深空极光（默认，对应设计稿）/ `daylight` 日光浅色 / `ocean` 深海青 / `graphite` 石墨金。新增主题 = global 层加一个 `[data-theme='x']` 区块 + `stores/theme.ts` 加一项，组件与页面代码零改动。

## 验证

```bash
pnpm typecheck && pnpm build     # 前端门禁
cd server && uv run pytest       # 后端 19 个单测
uv run python scripts/e2e_smoke.py  # API 端到端冒烟（需服务已启动）
```

UI 端到端截图验证见 `docs/screenshots/`（旧版）与 `docs/screenshots/theme/`（原子化样式 + 4 套配色切换，含刷新持久化验证）。

## 已知限制（一期）

- Mock Provider：片段为占位视频、配音为静音音轨、验证码回显（真实供应商配 Key 后经 registry 切换）
- 文件服务按不可猜测 key 隔离（生产应改签名 URL）
- 任务队列为进程内 asyncio（预留 Celery 迁移位）
- 禁止实现：多人协作 / 平台分发 / 数字人 / 移动端（见 constitution 暂不纳入清单）
