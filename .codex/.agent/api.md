# AI Video Studio 后端开发规范

> 适用范围：`apps/api` 的 Node.js 服务、共享业务规则，以及 `apps/desktop/src-tauri` 中的本地后端能力。依据 2026-10-30 的仓库代码编写；架构或接口变更时同步更新本文件。本文是开发约束，文末单列当前尚未完成的能力。线上 API 镜像 `20261030-official-04` 已使用 PostgreSQL schema 1；仓库候选 API 要求 schema 3，尚未发布。部署事实见 [正式发布记录](../../docs/acceptance/2026-10-30-official-release.md) 与 [升级手册](../../deploy/postgres/schema1-to3.md)。

## 1. 技术栈与目录职责

| 目录或文件 | 职责 |
| --- | --- |
| `apps/api/src/server.ts`、`main.ts` | HTTP 入口、鉴权、路由、响应与后台 worker 启动。复杂业务规则留在独立模块。 |
| `apps/api/src/config.ts`、`.env.example` | 服务端配置、必填项与默认额度。密钥仅从 API 进程环境读取。 |
| `apps/api/src/db.ts`、`cloud-document.ts` | PostgreSQL 连接与只读版本校验、显式 schema 迁移、旧云文档升级。 |
| `apps/api/src/request-security.ts`、`rate-limit.ts`、`upload.ts` | 有状态请求来源、单实例限流与流式暂存边界。 |
| `apps/api/src/auth.ts`、`runs.ts`、`sync.ts` | 会话与账号、付费生成账本、项目资源命令与冲突控制。 |
| `apps/api/src/prompt-ideas.ts`、`idea-*.ts` | 三版灵感的持久请求、模型适配、结果校验和后台查询。 |
| `apps/api/src/generation-worker.ts`、`kling.ts` | 可灵任务提交、查询、下载、恢复和入库。 |
| `apps/api/src/video-edits.ts`、`render-worker.ts`、`render-lease.ts` | 编辑配方、渲染版本、租约与恢复。 |
| `apps/api/src/media-inspect.ts`、`object-capacity.ts` | 媒体内容探测、对象去重和存储额度。 |
| `packages/agent-core`、`packages/project-core`、`packages/project-schema` | 无平台 I/O 的计划、项目模型、校验和迁移规则。 |
| `packages/api-contracts` | 共享 HTTP JSON 请求、响应 envelope、稳定错误码；API、Web、桌面和移动端共同依赖。 |
| `apps/desktop/src-tauri` | Tauri/Rust 本地文件、媒体处理、导出与云端适配；不是 Electron 主进程。 |

API 使用 Node.js 24、TypeScript 严格模式、NodeNext ES module、PostgreSQL、`pg` 连接池和 pnpm workspace。新增共享能力优先通过包的 `exports` 暴露；不要把 Node、Tauri 或供应商凭证引入共享 UI 包。现有个别 API 模块仍使用跨包相对路径，修改时逐步收敛到正式导出，避免继续扩散。

### 共享 API 协议边界

- `@ai-video/api-contracts` 的 `requests.ts` 定义各 JSON POST 的 Zod 请求 Schema；`responses.ts` 定义通用响应 envelope 与账号、灵感、项目摘要、云项目／任务、编辑、渲染和对象元数据的传输形状；`errors.ts` 定义 `ApiErrorCode`。新增或变更 JSON 接口时，先更新共享 Schema，再更新服务端和各客户端适配器。
- `apps/api/src/server.ts` 在路由读入 JSON 后调用 `parseApiRequest(method, path, body)`，在发送 JSON 前调用 `parseApiResponse`；Web、Tauri 桌面与 Expo 移动适配器解析共享响应和错误。页面不得自行把不可信 JSON 断言成完整业务对象；业务对象的深层解析、旧云文档补全与迁移仍由 `project-core` 执行。
- `project-schema` 是持久三层 DSL 的唯一版本与结构定义。`GET /projects/:id/dsl` 的 `readOnly` 响应按 DSL 版本校验；旧云项目 `document.version=1` 仍是另一条兼容协议，不能把两者混为同一个写入格式。
- 二进制 `POST /objects`、`GET /objects/:id` 和 `GET /runs/:id/events` 的 SSE 保持各自媒体／事件协议，不经 JSON body parser。上传完成后返回的对象元数据属于 JSON 响应契约。
- 所有 `POST`、`PUT`、`PATCH`、`DELETE`（含登录、登出、二进制上传及付费确认）须发送共享协议中的 `X-AVS-Request: 1`。Web、Tauri 原生请求和移动端一致；未带头、错误 Origin 或 `Sec-Fetch-Site: cross-site` 在业务副作用前返回 403。生产只接受精确 HTTPS `API_ALLOWED_ORIGIN` 并启用 Secure Cookie；新旧客户端发布顺序必须单独验收。
- 当前成功响应 URL、状态码和字段保持原样；错误响应保留 `error` 文字并增加稳定 `code`，409 继续携带 `conflict` 快照。客户端对旧服务器缺少 `code` 的响应按 HTTP 状态推断，发布顺序为服务端先兼容新增字段，再逐步升级各客户端。破坏性字段变更须另定协议版本和迁移窗口。
- 协议现状与覆盖范围见 `docs/architecture/api-contract-audit.md`，回归范围见 `docs/acceptance/2026-10-29-api-contracts-regression-scope.md`。

## 2. HTTP 接口与账号边界

1. 除 `/health`、注册和登录外，请求先通过服务端会话取得 `accountId`。查询、修改项目、对象、任务、灵感和事件时，SQL 必须同时限定资源 ID 与所有者；客户端传来的所有者字段不具权威性。
2. 新接口在 HTTP 层校验方法、路径参数、JSON 形状、字段长度和请求体大小；业务模块再校验资源存在性、所有权和跨资源引用。不得仅凭 TypeScript 类型或浏览器控件认为输入有效。
3. 保持现有错误语义：无效输入返回 4xx，未登录为 401，资源不可见为 404，版本或幂等 ID 冲突为 409，额度与服务不可用返回对应状态。对外使用可操作的中文错误，不返回密钥、原始堆栈或供应商响应全文。
4. 项目写入走 `POST /projects/:id/commands`。命令携带稳定 ID、`resourceType`、`resourceId`、`baseRevision` 与 `payload`；服务端在事务中校验当前修订、保存命令账本并更新资源修订。同一命令 ID 同内容可重放，不同内容必须冲突。遇到 409 时保留双方版本，不静默覆盖。
5. `GET /projects/:id/dsl` 当前只提供三层项目 DSL 的只读投影。新增写入能力前，先完成迁移、命令语义及旧客户端兼容；不得把投影响应当作可直接 `PUT` 回去的云项目文档。
6. 运行进度通过任务快照和持久事件读取。视频运行的 SSE 以递增 `seq` 为事件 ID，支持 `Last-Event-ID` 补发；连接关闭时释放定时器。媒体字节通过已鉴权的对象接口获取，事件只传状态与引用。

## 3. 数据库与兼容迁移

- 云端结构化数据位于 `DATABASE_URL` 指向的 PostgreSQL；`API_DATA_DIR` 存放媒体文件。`db.ts` 的 PostgreSQL schema 版本为 3。新增结构或数据格式升级应增加顺序版本，在事务内完成，并给旧数据库快照添加迁移测试；`CREATE TABLE IF NOT EXISTS` 不能替代文档数据迁移。
- API 启动只读取 `api_schema_version` 并拒绝不匹配版本，不执行 DDL。`migrateSchema` 仅由迁移账号执行；线上 schema 1→3 升级须先核对实际 DDL、在隔离恢复库演练，再按 `deploy/postgres/schema1-to3.md` 执行。API 账号 `ai_video_runtime` 只获业务表 DML，`api_schema_version` 只读；新增表后须重新授权并验证 `CREATE/ALTER/DROP` 被拒绝。
- 涉及额度、对象登记、任务状态、项目文档和事件的联合修改，使用 `db.transaction(async () => ...)` 后一次提交或回滚，且所有数据库调用必须 `await`。跨行额度和事件序号先持有事务级锁；项目或编辑记录更新前使用行锁。不要在持有事务时等待网络、模型、FFmpeg 或大文件 I/O。
- 云项目仍保存 `document_json` 和按资源划分的修订。旧文档读取与迁移必须保留分集、人物、画布、时间线片段 ID、裁剪范围、音量及已有媒体引用。新增字段须明确旧数据默认值和客户端回退行为。
- 媒体对象按账号及 SHA-256 去重；对象文件不可原地修改。视频镜头分别保留 `originalAssetId` 与 `selectedAssetId`，渲染结果作为新版本保存，不自动改写已排入时间线的旧片段。
- `migrate-sqlite-to-postgres.mjs` 和 `deploy/postgres/cutover.sh` 只处理历史 SQLite→PostgreSQL 切换，不能用于当前线上 PostgreSQL。schema 1→3 迁移在单个 PostgreSQL 事务中执行；正式升级前备份并验证可恢复性，核对 15 张原表的行数、关键记录和对象文件。迁移失败事务回滚；迁移成功后的代码回退必须考虑旧 API 对 schema 3 的兼容性与新增写入，不能直接覆盖现有数据库。

## 4. Agent、外部调用与费用幂等

- 视频生成区分三种持久身份：`agent_runs` 表示用户意图，`operations` 表示一次可能计费的外部操作，`run_events` 表示可重放进度。客户端用稳定 `clientRequestId` 创建运行，以稳定 `approvalId` 和 `planHash` 明确确认；同 ID 同输入返回原记录，同 ID 不同输入返回冲突。
- 在调用可灵前，先持久保存提交意图并预留演示额度。`pending_submit → submitting` 的原子领取是供应商 POST 的唯一入口；响应丢失或进程重启时，用已保存的 `external_task_id`／`remote_task_id` 查询原任务，不自动发送第二次付费 POST。
- 额度按账号与平台总量在事务中检查。供应商已完成但对象额度不足时，下载结果进入持久的 `storage_pending` 暂存状态；释放空间后继续入库。最终入库时再结算预留额度。超出生成视频大小限制的结果按既有计费规则明确失败并提示。
- 灵感生成与视频生成是两条任务链。`prompt_idea_sets` 先保存输入和 `clientRequestId`，再调用按 `IDEA_PROVIDER` 选择的 `chat`、`agents` 或 `cursor` 适配器；持久保存三版结果、选择与最终编辑文本。未知响应保持可查询或明确的 `unknown` 状态，不把超时直接当成功，也不靠重用同一请求 ID 再发一次外部创建请求。
- 模型输出和供应商 URL 均视为外部输入：限制响应大小、超时、格式和允许的地址。新供应商接入必须说明其幂等键、失联查询方式、计费点和无法确认时的处理，不得只实现“重试 POST”。

## 5. 媒体、渲染与资源上限

- 上传边读边写入 `temporary/*.upload`，默认单次上限 20 MB、总时长 30 秒、最多 3 个并发探测/登记；中断、超限、探测和配额失败清理暂存文件。实际内容仍用 `ffprobe` 验证 MIME、画面尺寸和视频时长；账号最多 100 个对象、200 MB，平台对象总量最多 2 GB。变更默认值时同时更新 `config.ts`、`.env.example`、测试和部署说明。
- 上传、生成结果和渲染结果统一通过 `object-capacity.ts` 在 PostgreSQL 事务内去重、检查账号与平台额度、登记对象。失败须清理新文件并回滚对象行；重复内容不重复占用额度。大文件先异步落入同一数据目录的暂存区，再登记，不在 HTTP 请求中同步编码或整文件复制。
- 可灵下载采用流式写入和 100 MB 上限。暂存文件可能暂时超出已登记对象的额度；部署磁盘容量要额外覆盖待入库结果，并清理过期的未完成临时文件。
- 渲染由后台 worker 执行 FFmpeg，不占用 HTTP 请求处理路径。任务以租约令牌原子领取，只有当前持有者可以提交结果；租约过期可恢复，同一配方版本失败重试复用原渲染任务。输出视频和封面同时入库，任何一步失败都不得留下半套对象记录或文件。
- 分集渲染在 `concat -c copy` 前必须将每个临时镜头的 AAC 音轨统一为 48 kHz 双声道；有声单声道镜头与双声道静音镜头直接拼接会让后续混音在镜头边界后静音。Linux 候选镜像内置较旧的 FFmpeg，滤镜应兼容其 `adelay` 与 `amix` 参数；发布前在 Linux 镜像中执行真实媒体混音。回归测试应解码片尾并检查人声、音乐的实际采样内容，而非只检查音轨时长或编码格式。
- 桌面端耗时导出使用异步 Tauri 命令并转入阻塞线程池。本地文件路径须限定在项目允许的目录内，下载失败时清理临时文件；桌面到远端 API 使用 HTTPS，回环地址仅用于本地开发。

### 配音、混音预览与 Agent 剪辑接口（2026-10-30）

- 新视频 `POST /projects/:id/runs` 只接受 `durationSec: 5`。旧 10 秒镜头、编辑配方和成片继续读取、编辑和导出。
- 音频使用 `POST /objects` 上传 MP3/WAV/M4A，服务端用 `ffprobe` 检查真实格式与时长，再以 `POST /projects/:id/commands` 绑定 `voice` 或 `music` 资产；跨账号对象不得引用。
- 文字配音先读取 `GET /tts/voices` 的受控音色列表，再调用 `POST /projects/:id/tts/estimate` 获取与输入绑定的确认 ID。费用字段为 `null`，`billingPolicy=actual-usage`，界面必须明确告知按实际用量扣费且事前无法准确报价；用户二次确认后使用稳定 `clientRequestId` 和 `confirmed: true` 调用 `POST /projects/:id/tts/tasks`。`GET /projects/:id/tts/tasks/by-request/:clientRequestId` 与 `GET /tts/tasks/:id` 可恢复状态。供应商返回实际扣费后保存到任务；提交响应不确定时不得重发 POST。
- 视频生成使用 `KLING_API_KEY`（当前北京接口），TTS 单独使用 `KLING_TTS_API_KEY` 和 `KLING_TTS_BASE_URL`（默认官方文档的新加坡接口）。两个密钥不能假定跨区域通用；未配置 TTS 密钥时 `GET /tts/voices` 返回空列表，任务创建不可用。2026-10-30 隔离实测：现有视频密钥在北京账户接口返回 200，在新加坡返回 401/1002；一次 TTS 提交失败且未扣费。换用新版 TTS 密钥后，先免费查询认证，再提交一次可恢复的真实任务验证权限和结果。
- 官方文档已核实的默认音色仅有英文示例 `oversea_male1`。中文音色必须由运维依据可灵 Voice Guide 和实际账号权限核实后，通过 `KLING_TTS_VOICES_JSON` 配置；服务端检查 `voiceId` 与 `voiceLanguage` 的对应关系。未配置、未实测的音色不可展示为可用。
- 镜头 `POST /video-edits/:id/commands` 的 `set-audio-mix` 和分集 `POST /projects/:id/commands` 的 `episode.audio` 保存原声、人声、音乐的时间及音量。保存不触发生成或导出。
- 镜头 `POST /video-edits/:id/previews` 使用 `{previewOperationId,expectedRevision}`；分集 `POST /projects/:projectId/episodes/:episodeId/previews` 使用 `{previewOperationId,expectedEpisodeRevision}`；`GET /previews/:id` 返回状态与 `outputAssetId`。预览与正式导出调用同一 FFmpeg 混音函数，预览对象 1 小时过期并回收，不更新正式版本。过期后重新创建同一版本预览。正式镜头渲染走 `/video-edits/:id/render`，正式整集渲染走 `/projects/:id/episodes/:episodeId/render`。
- Agent 剪辑建议走 `POST /projects/:id/agent-edits`、`GET /projects/:id/agent-edits/by-request/:clientRequestId`、`GET /agent-edits/:id`。响应的 `context` 固定保留生成建议时的镜头顺序、各编辑的裁剪、字幕与配音，确认或跨端刷新后仍用它展示原值。先展示建议和理由，用户选中动作后以 `POST /agent-edits/:id/confirm` 手动确认；事务内检查镜头/分集修订及资产归属。该确认不自动启动视频生成、TTS 或渲染。

## 6. 安全与配置


- `API_SESSION_SECRET` 至少 32 字符；密码使用异步慢哈希，会话 Cookie 为 HttpOnly，数据库仅保存会话令牌摘要。生产环境启用安全 Cookie，配置精确 HTTPS Origin，并让网页同源 `/api` 代理到 API。登录/注册按账号和 IP、上传/灵感/渲染/生成确认按账号和 IP 限流，429 携带 `Retry-After`。仅信任 `API_TRUSTED_PROXY_IPS` 中的直连代理并读取其重写的 `X-Real-IP`；进程内限流不支持多实例一致性。
- `KLING_API_KEY`、`KLING_TTS_API_KEY`、文字模型密钥、Cursor 凭证只放在 API 进程环境。API 不自动加载 `.env.local`；不得写进仓库、项目 JSON、日志、前端构建、SSE 或 Tauri 配置。配置错误只报告变量名或安全的错误码，不打印密钥值。
- 使用参数化 SQL，避免拼接用户输入为 SQL、文件路径或 FFmpeg 命令。处理上传、模型响应、下载重定向和跨项目引用时均在服务端重新验证；不要依赖前端的 MIME、资源类型或权限判断。
- Tauri 能力通过明确注册的 Rust command 暴露，云端 API 与本地文件操作保持分层；本项目不采用 Electron 的 `main`／`preload` 进程模型。

## 7. 开发和验收

1. 改 API 业务规则时添加对应的 `apps/api/src/*.test.ts`，重点覆盖鉴权隔离、参数边界、幂等重放、并发额度、旧数据迁移、未知外部响应、任务恢复和文件回滚。API 集成测试使用 `TEST_DATABASE_URL` 指向的隔离 PostgreSQL 数据库、临时数据目录和模拟供应商，不用真实付费调用验证普通改动。
2. 至少运行 `pnpm --filter @ai-video/api build`、`pnpm --filter @ai-video/api test`、`pnpm check:boundaries` 和 `git diff --check`。改共享协议时另跑 `pnpm --filter @ai-video/api-contracts test`、全工作区 `pnpm build`、受影响客户端测试，并交给测试会话回归核心 API 链路；改 Rust command 时运行 `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml`，必要时实际启动 `pnpm tauri dev`。
3. API 集成测试需要绑定本地回环端口；若受沙箱限制出现 `EPERM`，在允许的测试环境重跑，不把环境拒绝当作业务测试通过。生产预检应在目标服务器执行，验证环境变量、当前平台的 `ffprobe`／FFmpeg、有效照片上传、健康接口与同源代理；本机测试不代表真实供应商或部署验收。
4. 变更配置、存储限制、接口字段或状态机时，同步更新 `.env.example`、共享类型、客户端适配、README 和本规范。发布前记录迁移版本、备份位置、发布后探测和回滚条件。

### 线上容器部署约束

- 现有 `sr-nginx` 容器继续提供网页静态文件和 HTTPS，`/api/` 代理到 `172.23.0.1:8787`；API 由 `/srv/ai-video-studio/docker/compose.yaml` 的单个 `ai-video-studio-api` 容器运行。Compose 项目名必须为 `ai-video-studio`，不可复用服务器其他服务的项目名。
- API 镜像在 Linux x86_64 上从明确的 release 与锁文件构建。构建时实测 `ffmpeg` 和 `ffprobe`；不得把 macOS `node_modules` 或 `/etc/ai-video-studio/api.env` 拷入镜像。
- API 容器以主机 `ai-video` 的 UID/GID 运行，只将 `/var/lib/ai-video-studio` 读写挂载；密钥通过 root 权限的环境文件注入。SQLite 与进程内 worker 只运行单实例。
- 切换前备份活动数据库、完整数据目录和环境文件。常规代码回滚执行 `docker compose down` 与 `systemctl enable --now ai-video-studio`；不得用旧数据库快照覆盖切换后新增的数据。详细命令见 `deploy/docker/README.md`。

## 8. 当前边界与后续收敛

- 现有视频 `agent_runs` 是一次运行对应一个付费 `operations` 的链路；通用逐节点 `agent_steps` 尚未落地。新增多节点自动执行前，先设计持久的步骤身份、依赖、重试和费用账本。
- PostgreSQL 已支持多连接事务；媒体对象仍在本地目录，worker 与登录限流仍在进程内。若改为多 API 实例，应先引入共享对象存储、跨实例限流和任务调度，并验证租约与事件通知的一致性。
- `scripts/check-api-runtime.mjs` 当前检查 PostgreSQL 连接、`IDEA_MODEL_*` 文字服务变量与 `ffprobe`；当部署选择 Cursor 或 Agents 提供商时，需要补齐对应预检，不能把该脚本单独通过当作所选提供商已经可用。
- 自动测试和模拟供应商只能证明受测代码路径；真实可灵计费生成、桌面运行、移动真机和发布包需要分别记录实际验收结果。
