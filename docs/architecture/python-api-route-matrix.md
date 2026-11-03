# Python API 迁移路由基线

日期：2026-11-03。Node 基线：`6877521` 加当前未提交的 v3/TTS 变更；迁移时必须重新确认下列文件摘要。`server.ts` SHA-256：`76e51f24002ab9e0b6ff2fcf45915d1b7afd9b54c3d9f11a8761b006c1c631a4`。本清单从 `apps/api/src/server.ts` 逐条核对；这些均是服务端路径，Nginx 对外添加 `/api` 前缀。

| 领域 | 方法与路径 | 响应重点 |
| --- | --- | --- |
| 健康 | `GET /health` | `{ok:true}` |
| 账户 | `POST /auth/register`、`POST /auth/login`、`POST /auth/logout`、`GET /auth/me` | `avs_session` Cookie、旧 scrypt 哈希、旧会话摘要 |
| 配音 | `GET /tts/voices`、`POST /projects/:id/tts/estimate`、`POST /projects/:id/tts/tasks`、`GET /projects/:id/tts/tasks/by-request/:requestId`、`GET /tts/tasks/:id` | 音色可用性、幂等任务状态 |
| 整集 | `POST /projects/:projectId/episodes/:episodeId/render`、`GET /episode-renders/:id`、`POST /projects/:projectId/episodes/:episodeId/previews`、`GET /previews/:id` | 同一快照的预览/导出 |
| Agent 编辑 | `POST /projects/:id/agent-edits`、`GET /projects/:id/agent-edits/by-request/:requestId`、`GET /agent-edits/:id`、`POST /agent-edits/:id/confirm` | 二次确认、幂等 |
| 灵感 | `GET/POST /prompt-ideas`、`POST /prompt-ideas/:id/more`、`POST /prompt-ideas/:id/selection`、`GET /prompt-ideas/:id` | 三条加一次追加、最多六条 |
| 镜头剪辑 | `GET/POST /video-edits`、`GET /video-edits/:id`、`GET /video-edits/:id/versions`、`POST /video-edits/:id/commands`、`POST /video-edits/:id/previews`、`POST /video-edits/:id/render`、`GET /renders/:id`、`GET /renders/:id/events` | 修订、渲染状态与事件 JSON |
| 视频生成 | `GET/POST /projects/:id/runs`、`GET /runs/:id`、`POST /runs/:id/approve`、`GET /runs/:id/events` | 审批后领取；仅 `/runs/:id/events` 为 SSE |
| 项目 | `GET/POST /projects`、`GET /projects/:id`、`POST /projects/:id/commands`、`GET /projects/:id/dsl`、`GET /projects/:id/episodes/:episodeId/timeline` | 旧文档与 v3 投影、资源修订与冲突；`PUT /projects/:id` 拒绝 405 |
| 对象 | `POST /objects`、`GET /objects/:id` | 二进制流；单 Range `206`、非法 Range `416` |

所有写请求沿用 `X-AVS-Request: 1`、严格 Origin 与 `Sec-Fetch-Site` 检查。错误使用 `@ai-video/api-contracts` 的 JSON 包装，不能返回 FastAPI 默认的 `detail`。`GET /objects/:id` 不允许全量读入内存。迁移测试要在隔离库验证旧 Cookie、跨租户、幂等、SSE 断线续传、对象范围、旧项目及付费任务未知状态。
