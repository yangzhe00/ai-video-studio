# API 协议现状盘点（2026-10-29）

## 现状

`@ai-video/project-schema` 校验项目 DSL，`@ai-video/project-core` 定义旧云文档、部分响应快照并解析项目与运行；它们并非完整的 HTTP 契约。`apps/api/src/server.ts` 自行读 JSON、构造响应与 `{ error }`，`apps/api/src/sync.ts` 另有云文档接口；Web、桌面、移动端各有泛型请求适配器，调用点手写响应类型。视频编辑视图类型还分别存在 Web/Native 插件视图中。

| 协议组 | 路由（方法） | JSON 请求 | JSON 响应 | 主要调用端 |
| --- | --- | --- | --- | --- |
| 健康 | `GET /health` | 无 | `ok` | 部署探测 |
| 身份 | `POST /auth/register`, `POST /auth/login`, `GET /auth/me`, `POST /auth/logout` | 邮箱/密码 | `account`, `expiresAt` 或 `ok` | Web/桌面/移动 |
| 文字灵感 | `GET/POST /prompt-ideas`, `GET /prompt-ideas/:id`, `POST /prompt-ideas/:id/selection` | 请求 ID 与输入、选中版本与编辑文本 | `ideaSet` 或 `ideaSets` | Web/桌面 |
| 项目 | `GET/POST /projects`, `GET /projects/:id`, `POST /projects/:id/commands`, `GET /projects/:id/dsl` | 标题/初始分集/创作原文、资源命令 | `projects`、`project`；DSL 只读 | Web/桌面/移动 |
| 视频运行 | `GET/POST /projects/:id/runs`, `GET /runs/:id`, `POST /runs/:id/approve` | 意图或确认 ID/计划哈希 | `run` 或 `runs` | Web/桌面/移动 |
| 视频微调 | `GET/POST /video-edits`, `GET /video-edits/:id`, `GET /video-edits/:id/versions`, `POST /video-edits/:id/commands`, `POST /video-edits/:id/render`, `GET /renders/:id`, `GET /renders/:id/events` | 编辑目标、命令、渲染请求 | `edit`、`render`、版本/事件 | Web/桌面/移动 |
| 素材 | `POST /objects`, `GET /objects/:id` | **二进制上传** | 元数据 JSON 或**二进制下载** | Web/桌面/移动 |
| 运行事件 | `GET /runs/:id/events` | `Last-Event-ID`/`after` | **SSE 流** | Web；其他端快照兜底 |

公共 JSON 契约应覆盖上述组的请求边界、响应 envelope 和错误 envelope。二进制及 SSE 保持各自的协议；JSON parser 不接管它们。项目 DSL 格式仍由 `project-schema` 唯一定义，旧云项目格式仍由 `project-core` 承担迁移责任。`@ai-video/api-contracts` 只组合传输契约，不复制领域模型或供应商密钥。

## 兼容要求

- 成功响应字段、HTTP 状态、Cookie、URL、请求 ID、资源修订及供应商操作身份保持不变。
- 旧版错误只有 `{ error: string }`；新版可增加 `code`，客户端必须兼容缺少 `code` 的服务器。409 同步冲突的 `conflict` 快照不丢。
- 服务端在 HTTP 边界校验 JSON；领域模块仍负责账号归属、跨资源引用、额度和状态机。不能用 Zod schema 替代这些检查。
- 客户端对共享响应进行运行时解析，调用方泛型不是安全校验。逐步把页面里的重复 DTO 收敛到新包。

## 本次落地

- 新建 `packages/api-contracts`，导出请求 Schema、响应 Schema 与 DTO、`ApiErrorCode`、`parseApiRequest`、`parseApiResponse` 和旧错误兼容解析。
- API 在 JSON 入口和出口使用共享协议；Web、桌面、移动适配器先校验通用传输响应，再由 `project-core` 校验旧云项目与运行快照。只读 DSL 单独按 `project-schema` 版本校验。
- 错误响应保留 `error`，增加 `code`，同步冲突继续保留 `conflict`。桌面 Tauri 桥目前对非 2xx 响应仍只向前端传错误文案，后续若页面需要按 `code` 分支，应同时升级该桥的错误结构。
- 二进制上传／下载和运行 SSE 未改协议；服务端资源归属、幂等、额度与状态机仍由各业务模块负责。
