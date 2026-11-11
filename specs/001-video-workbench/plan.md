# Implementation Plan: 视频成片工作台一期（Web）

**Branch**: `001-video-workbench` | **Date**: 2026-11-11 | **Spec**: `specs/001-video-workbench/spec.md`

**Input**: spec.md + docs/product/03-PRD.md + 04-交互定义.md + 会话澄清记录

## Summary

面向个人创作者的一站式竖屏短视频工作台：选题/讲稿（LLM）→ 素材/生图 → 图生视频（可灵）→ TTS 配音+字幕（火山引擎）→ ffmpeg 合成 → 导出。一期 Web-only，pnpm monorepo，所有外部能力 Provider 抽象 + Mock 可切，本地磁盘存储，每用户独立额度。

## Technical Context

**Language/Version**: TypeScript 5.x (React 19) / Python 3.12
**Primary Dependencies**: 前端 Vite 6 + React 19 + Tailwind CSS 4 + Zustand + React Router 7；后端 FastAPI + SQLAlchemy 2 + Pydantic v2 + ffmpeg-python + httpx
**Storage**: PostgreSQL 16（结构化数据）+ 本地磁盘 `server/data/uploads/`（文件，StorageProvider 抽象）
**Testing**: 前端 Vitest；后端 pytest
**Target Platform**: Web（1366×768 / 1440×900 / 1920×1080 三档）；服务端 macOS/Linux
**Performance Goals**: 页面首屏 <2s；任务状态轮询 5s 间隔（演示够用，不做 WebSocket）
**Constraints**: Mock 模式下无真实外部 API 依赖可完整演示黄金任务流；演示用 Mock 验证码登录
**Scale/Scope**: 内部演示，单机部署，7 个一级页面 + 登录页

## Constitution Check

| 条款 | 状态 |
|---|---|
| 文档驱动 | ✅ spec/plan/tasks 三级产出 |
| Provider 抽象 | ✅ 视频生成/生图/LLM/TTS/存储/短信全部接口化，Mock 默认 |
| 可移植分层 | ✅ packages/* 平台无关，无 window API 直接耦合 |
| 编码纪律 | ✅ 禁 any/JSDoc/Zustand/hooks 抽离/api-client 统一 |
| 测试门禁 | ✅ typecheck/lint/test/build 全绿后交付 |
| 一期禁止清单 | ✅ 未纳入任何禁止项 |

## Data Model（核心表）

```
users            id, phone, created_at
sessions         token, user_id, expires_at
quota_ledger     id, user_id, task_id, delta, balance_after, reason, created_at
topics           id, user_id, title, angle, keyword, status(draft/selected), created_at
scripts          id, user_id, topic_id, content(jsonb: segments[]), created_at
script_segments  随 scripts.jsonb 内嵌（一段=分镜，含 text + prompt + clip_id）
assets           id, user_id, type(image), source(upload/generated), path, mime, size
tasks            id, user_id, type(image_gen/video_gen/tts/compose), state(草稿/已提交/排队中/生成中/成功/失败/已使用/已合成/已导出/已作废), provider, provider_task_id, fail_category(参数/额度/供应商/审核/超时), fail_detail, params(jsonb), result(jsonb), consumed_quota, created_at, started_at, finished_at
clips            id, user_id, task_id, segment_ref, video_path, duration_s
templates        id, name, style(jsonb: 片头/片尾/字幕样式/BGM 路径), enabled
compositions     id, user_id, topic_id, template_id, task_id, version_no, output_path, status
final_videos    = compositions.output_path（成片即合成产物，文件名含选题标题+日期）
```

状态机（全站统一，PRD 1.1）：`草稿→已提交→排队中→生成中→成功/失败`；`失败→(重试)→已提交`；`成功→已使用→已合成→已导出`；`草稿→已作废`。

## API 契约（REST，/api 前缀，JWT Bearer）

```
POST /api/auth/send-code      {phone}            → demo 模式返回 code
POST /api/auth/login          {phone, code}      → {token}
GET  /api/me                                     → 用户信息+额度余额
POST /api/topics/generate     {keyword}          → 5 条选题（LLM Provider）
GET  /api/topics             ?status=            → 列表
POST /api/topics/{id}/script                     → 生成讲稿（分段）
PATCH /api/scripts/{id}       {segments[]}       → 保存编辑
POST /api/scripts/{id}/prompts                   → 生成分镜提示词
POST /api/drafts/{id}/restore | DELETE /api/topics/{id}
POST /api/assets/upload       multipart(批量)     → 素材入库
POST /api/assets/generate     {prompt}           → AI 生图任务
GET  /api/assets             ?page=
POST /api/tasks/video-gen     {segment_id, asset_id, prompt, provider?}  → 额度预检+入队
GET  /api/tasks               ?type=&state=       → 任务中心（轮询）
POST /api/tasks/{id}/retry | /cancel
POST /api/compositions        {topic_id, template_id}                     → 合成任务
GET  /api/compositions        ?topic_id=           → 版本历史
GET  /api/templates                                → 模板列表
GET  /api/quota                                    → 余额+明细
GET  /api/quota/ledger        ?page=
GET  /api/files/{path}                             → 本地文件静态服务（鉴权）
```

Provider 接口（`server/app/providers/`，统一 `submit() → query() → result()`，Mock 默认）：
`VideoGenProvider(可灵)` / `ImageGenProvider` / `LLMProvider` / `TTSProvider(火山引擎)` / `StorageProvider(本地磁盘, 预留 S3)` / `SmsProvider(Mock)`

异步执行：进程内 `asyncio` 任务队列 + 后台 worker（演示单机足够，预留 Celery 迁移位）；合成用 `ffmpeg-python` CPU 合成。

## Project Structure

```text
taskify/
├── apps/web/                     # Vite + React 19 + TS + Tailwind
│   └── src/
│       ├── pages/                # Login/Home/Topic/Assets/Generate/Compose/Output/Tasks/Usage
│       ├── components/           # 页面级组件（通用件下沉 packages/ui）
│       ├── hooks/                # 业务逻辑 hooks（禁在组件写业务）
│       ├── stores/               # Zustand
│       └── routes.tsx
├── packages/
│   ├── ui/                       # 通用组件库 Button/Input/Modal/Table/TaskCard/EmptyState…
│   ├── api-client/               # 统一 API 层（fetch 封装+类型+鉴权拦截）
│   ├── shared/                   # 共享类型/常量/状态机枚举
│   └── hooks/                    # 跨页面通用 hooks
├── server/                       # FastAPI
│   ├── app/
│   │   ├── api/                  # 路由 auth/topics/assets/tasks/compose/quota/files
│   │   ├── models/               # SQLAlchemy
│   │   ├── services/             # 业务逻辑 + 任务执行 worker
│   │   ├── providers/            # 可灵/火山/LLM/存储/短信 + mock/
│   │   └── core/                 # 配置(环境变量)/鉴权/额度/异常
│   ├── data/uploads/             # 本地存储
│   └── tests/
├── docs/product/                 # 产品基线（01~04）
├── specs/001-video-workbench/    # 本 SDD 产出
└── AGENTS.md                     # 编码纪律
```

**Structure Decision**: pnpm monorepo（workspace: apps/* + packages/*），前后端分离部署，前端 dev 时 Vite proxy `/api` → FastAPI :8000。

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| monorepo（非单应用） | 用户要求通用组件可复用+后期加桌面/移动壳层 | 单应用无法承载后续端型扩展 |
| 进程内任务队列 | 演示单机部署 | Celery/Redis 对演示是过度基础设施 |
