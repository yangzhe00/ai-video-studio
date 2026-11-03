# Python 云端 API 替换设计

日期：2026-11-03。状态：用户已批准设计；Python 接管云端后端，Redis 第一阶段承担跨实例限流与短期缓存。本文只定义目标，不代表代码或线上切流完成。

## 意图与边界

用户明确要求将云端后端替换为 Python、引入 Redis，并在晚上学习基础知识及部署方法。本设计把“后端”明确为 `apps/api` 的云端 HTTP API 和后台任务。桌面端 `apps/desktop/src-tauri` 的 Rust 本地文件、媒体与导出能力继续存在；Web、Tauri 桌面、Expo 移动端仍共用一个云端 API。Python 替换的是服务端实现语言，不改变客户端产品功能或让数据库重新建库。

当前基线（以 2026-11-03 的 `/Volumes/project/代码/ai-video-studio` 工作区核对）：`apps/api` 是 Node.js/TypeScript；PostgreSQL schema 4；同源 Web 使用 `/api`，桌面通过 Tauri 云端适配器、移动端通过 `apps/mobile/src/api.ts` 访问；共享协议在 `packages/api-contracts` 和 `packages/project-schema`。登录是 `avs_session` 的 HttpOnly Cookie、服务端 `sessions` 表和 scrypt 密码哈希，没有 JWT。API 进程还领取生成、灵感、TTS、Agent 编辑、预览和渲染任务；媒体保存在 `API_DATA_DIR`。当前工作树有并行未提交改动，执行前必须冻结并重新盘点目标版本。

## 目标、非目标与失败条件

- 目标：使用 Python 服务接管现有云端 API、后台任务、供应商调用和 FFmpeg 调度；三端保持现有路由、JSON、Cookie、SSE、上传与媒体 Range、错误码、资源修订和任务 ID 的兼容。
- 目标：沿用已有 PostgreSQL 数据、schema 迁移记录、对象路径、旧会话和密码哈希；新服务启动只校验 schema，迁移由独立命令执行。
- 目标：以对照测试和恢复库演练证明同一输入得到等价输出；付费调用只有一个服务能提交。
- 非目标：本轮不把 Tauri/Rust 迁成 Python；不同时引入 JWT、微服务拆分、新对象存储或项目文档格式重写。若以后决定一起改，需另立协议和数据迁移设计。
- 失败条件：用户被迫重新登录、旧项目/素材打不开、同一付费意图二次提交、资源修订丢失、音视频预览与导出不一致、切流后不能安全暂停或回退。

## 方案选择

| 方案 | 收益 | 代价 | 结论 |
| --- | --- | --- | --- |
| 保留 Node API，仅加 Python 模型 worker | 变更小，适合只有 Python 原生模型需求 | 不满足“后端替换”目标 | 保留作风险较低的备选 |
| Python API 一次性重写并直接切流 | 形式上最快 | 旧数据、会话、任务和三端协议无法逐项证明兼容 | 不采用 |
| Python API 平行实现、按领域验证、单次受控切流 | 能逐块核对，旧 Node 服务可保留作回退候选 | 需要并行维护一段时间和完整契约测试 | **本设计采用；用户要求替换云端后端** |

## 目标结构与责任

```text
Web / Tauri 桌面 / Expo 移动端
          │ 现有 /api HTTP + Cookie + SSE + Range
          ▼
Python FastAPI（账号、项目、对象、任务创建与查询）
          │
          ├─ PostgreSQL schema 4+（单一权威库、事务、租约与事件）
          ├─ Redis（跨进程限流；仅缓存可重建的短期数据）
          ├─ API_DATA_DIR（已有对象 ID 和文件路径）
          └─ 独立 Python worker 进程（付费供应商与 FFmpeg）
```

选择 Python 3.13 系列、FastAPI/Pydantic、Psycopg 3 异步连接池、pytest 和锁定依赖的 `uv` 项目作为实施候选。选 3.13 是为了先固定一个成熟运行环境；在实际建镜像前用目标服务器架构、FFmpeg 和依赖轮子做兼容验证，再锁定精确补丁版本与镜像摘要。沿用 SQL 和数据库事务语义，不把语言替换扩大为 ORM 与表结构重写。耗时工作使用数据库持久任务与独立 worker；FastAPI 的进程内后台任务不能替代恢复机制。

### 协议和状态的唯一权威

迁移阶段现有 TypeScript/Zod 契约仍是客户端校验入口。先从 Node 行为录制不含密钥和用户数据的黄金样例与边界样例；Python Pydantic 模型、HTTP 响应和 Node 输出必须通过双向对照。待等价性稳定，再决定是否将 OpenAPI/JSON Schema 升为语言中立的源头，避免仓促替换 TS 客户端运行时校验。

必须原样兼容：`avs_session` Cookie 名称、7 天有效期、HMAC-SHA256 摘要、scrypt 旧哈希、`SameSite=Lax`/`Secure`、Origin 与 `X-AVS-Request` 检查；`application/json` 限制、状态码与中文错误包；整数毫秒时间戳、缺字段与 `null` 的差异；`Last-Event-ID` 续传、事件 ID 顺序与媒体单区间 Range。新 Python 错误不得未经映射就直接暴露 FastAPI 默认 `detail` 格式。

### 数据、任务和媒体

PostgreSQL 仍是唯一写入源，保留当前 schema 和对象文件。Python 使用每请求/任务明确的事务边界、参数化 SQL、相同的行锁或 advisory lock、租约和唯一约束。旧数据读取、项目命令幂等、额度预留、对象去重与回滚通过恢复库验证。

付费操作、生成、灵感追加、TTS、Agent 编辑、预览和渲染都从持久记录恢复。Node 与 Python 不得同时领取相同任务；供应商 POST 的未知结果必须先查询旧操作，不能自动重发。FFmpeg/ffprobe 用参数数组启动，控制并发、超时、取消和临时文件清理；整集编辑的源音区间、锁定和冲突语义沿用当前候选契约。

## Redis 的边界与故障语义（已确认）

现有 `apps/api/src/rate-limit.ts` 的计数器保存在 Node 进程内的 `Map`。当 Python API 开多个进程或实例时，各进程分别计数会让原有限流失效。第一阶段用 Redis 原子计数与到期时间实现跨进程限流；用户、IP、路由维度和现有阈值以冻结时的 Node 行为为准。键名不含明文邮箱、Cookie 或密钥，使用稳定散列，必须有 TTL。注册、登录、灵感追加、视频生成与 TTS 等会消耗额度的入口，在 Redis 故障时停止新请求并返回明确的临时故障错误；只读缓存故障可直接查询原始来源。业务额度、任务幂等、会话和生成状态仍在 PostgreSQL，Redis 不是付费任务的唯一记录。

短期缓存只用于可以安全重新获取的目录数据，例如已验证的 TTS 音色目录；缓存键必须含供应商与版本、TTL、失效策略，不能缓存项目文档、会话、原始录音、用户私密媒体或未结算的任务状态。初期可只上线限流，实际出现可测量的重复读取开销后再开启缓存。Redis 可以按缓存用途设 `maxmemory` 和淘汰策略；任何接近内存上限的指标必须告警。不能用缓存命中率证明生成任务正确。

选择比较：仅加缓存可改善特定读请求，但不能修复多实例限流；限流加小范围缓存解决当前扩容边界，复杂度可控，**已确认采用**；将任务队列同时搬入 Redis 会改变当前 PostgreSQL 租约和付费幂等语义，本轮不采用。若用户明确要求 Redis 队列，需另写任务状态、故障恢复及重复计费设计。

## 部署拓扑与容量前置

为 Python API 与 worker 增加独立镜像和 Compose 服务，复用现有 PostgreSQL 数据卷、对象目录、Nginx `/api` 入口及密钥环境文件；Redis 只加入内部 Docker 网络，不发布宿主机端口。生产镜像固定版本或摘要、使用非 root 用户、最小权限与健康检查；API 和 worker 分进程。Redis 密码或 ACL 由服务端受限文件注入，不写入 Git、镜像或客户端构建。生产环境先测量内存、磁盘与 FFmpeg 峰值，再决定 Redis `maxmemory` 与容器内存限制；过去看过的 1 GiB 入门机配置不能直接假设可承载 PostgreSQL、Python、Redis 与 FFmpeg 并发。

隔离环境先用恢复库和对象副本启动 Python API、worker、Redis，端到端跑完路由、媒体、SSE 与任务恢复。正式切换时停止 Node API 与 worker 的写入和任务领取，备份数据库和对象目录，核验 Python 镜像与 schema 版本，只放行一个 Python worker；先私有验收，再把 Nginx upstream 切到 Python。Redis 的新限流不改变现有客户端协议。若发布失败，停写并对账后按原有回退规则处理，不能把旧数据库备份直接覆盖新写入。

## 切换与验收

在隔离的 PostgreSQL 恢复副本上平行运行 Python，只对照只读请求及在各自独立副本上的写入结果。完成账号、项目、上传、任务、媒体和三端回归后，维护窗口停写并停止 Node worker；备份数据库与对象目录，确认 Python 只连接预期版本，然后只启动一个 Python 任务领取者。先私有验收，再开放入口。

验收至少覆盖：旧账号/旧 Cookie 登录、跨账号隔离、三端项目同步、旧项目与整集 v3、对象 200/206/416、SSE 断线续传、修订冲突、重复确认、worker 崩溃恢复、FFmpeg 媒体采样和供应商未知状态。真实付费请求只在受控人工联调中进行，不作为普通自动测试。

若 Python 写入始终保持 Node 可读的 schema/状态，发生问题可在停写后切回旧镜像并对账；若出现 Node 不识别的新写入，必须维持维护状态，先修复或做逆向数据迁移，不用旧备份覆盖新数据。

## 已明确与待确认的决策

- 已明确：用户要求 Python 全量接管云端后端，并引入 Redis；今晚讲解基础和部署。
- 本设计建议：Redis 第一阶段用于跨进程限流，缓存只用于可重建的短期数据；不迁移持久任务队列。该职责已获用户确认。
- 本设计建议：保留当前 Cookie 会话及全部三端协议；JWT 如需引入，另做跨端登录和撤销设计。
- 发布前需要确认维护窗口、回退演练与人工付费联调范围。

参考实现文档：[FastAPI](https://fastapi.tiangolo.com/tutorial/)、[Pydantic JSON Schema](https://pydantic.dev/docs/validation/latest/concepts/json_schema/)、[Psycopg 异步连接](https://www.psycopg.org/psycopg3/docs/advanced/async.html)、[FastAPI 后台任务边界](https://fastapi.tiangolo.com/tutorial/background-tasks/)。
