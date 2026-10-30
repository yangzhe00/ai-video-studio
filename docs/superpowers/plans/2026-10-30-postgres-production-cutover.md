# PostgreSQL Production Cutover Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将当前线上 SQLite 业务数据完整迁入 PostgreSQL，发布与最新版 Web 兼容的 API，同时保持账号、项目、素材与待处理任务可用。

**Architecture:** 先冻结并验证本地候选源码，在服务器上构建新 API 镜像和持久 PostgreSQL 服务；用活动 SQLite 的备份副本演练 schema 9→10→PostgreSQL。正式切换时停止旧 API 写入、备份完整数据、导入空目标库、核对行数与素材文件，再让一个新 API 实例接管；静态站在 API 验收后发布。

**Tech Stack:** Node.js 24、PostgreSQL、Docker Compose、现有 SQLite 导入器、Nginx、pnpm/Vitest。

**Spec:** `docs/superpowers/specs/2026-10-30-official-website-design.md`、`docs/product/2026-10-30-official-website-prd.md`、`docs/superpowers/specs/2026-10-29-postgresql-migration-design.md`

## Global Constraints

- 当前线上是 SQLite schema 9、Docker API 单实例；导入器只接受 SQLite schema 10，须**只升级备份副本**。
- API 密钥、会话密钥和数据库密码只留服务器受限文件，不输出到日志、前端、镜像或文档。
- 停旧 API 后才能做最终快照；不得让旧 SQLite 和新 PostgreSQL API 同时接收写入。
- 新 API 开放公众前，必须验证 `missingObjectFiles=0`、表行数、账号/项目/素材与待处理任务恢复。
- 一旦新库接受真实写入，不能简单回滚旧 SQLite 快照，否则会丢新数据；转入维护状态并修复或制定反向迁移。
- 现有 `deploy/docker/cutover.sh` 固定旧 release/schema9，不得直接用于本次 PostgreSQL 切换。

## Review Focus

1. SQLite WAL 中尚未 checkpoint 的写入：停服务后在线备份必须包含全部已提交行；Task 3 校验源/副本计数。
2. schema 9→10 迁移失败：活动 SQLite 字节不变、备份保留、PG 目标为空；Task 2/3 测试。
3. 素材对象路径：导入器 `missingObjectFiles` 必须为 0，容器 `/var/lib/ai-video-studio` 能读取；Task 3/4 测试。
4. 待处理付费任务：新 worker 只查询原 operation/external ID，不二次提交供应商 POST；Task 4 定向回归。
5. 切换失败/新库已写入：旧服务仅在未开放新写入时可回退；Task 4 的维护与回滚演练。

---

## File map

| 文件 | 职责 |
| --- | --- |
| `deploy/docker/compose.yaml` | 新 PostgreSQL 服务、持久卷、健康检查及 API 单实例连接。 |
| `deploy/docker/Dockerfile.api` | 从冻结源码在 Linux 构建最新版 API，不复制本机依赖和密钥。 |
| `apps/api/scripts/upgrade-sqlite-copy.mjs`（新） | 明确只升级已备份副本的 schema 9→10，并输出版本/计数，不触碰活动库。 |
| `apps/api/scripts/migrate-sqlite-to-postgres.mjs`（已有） | schema10→空 PostgreSQL 的事务导入、表计数与 `missingObjectFiles`。 |
| `deploy/postgres/preflight.sh`、`cutover.sh`、`verify.sh`（新） | 服务器预检、停写/备份/迁移/切换、只读核对与回滚状态。 |
| `.codex/.agent/deployment.md`、`README.md` | 实际发布拓扑与回滚边界。 |

### Task 1: 冻结候选源码并跑本地门禁

**Files:** 只读核对工作区；保存版本清单到 `docs/acceptance/evidence/2026-10-30-official-website/source-manifest.txt`。

- [ ] 记录 `git status`、源码文件哈希和本地/线上版本差异；从当前工作树创建排除 `.git`、密钥、`node_modules`、Rust `target` 的独立候选目录，后续镜像只从该目录构建。
- [ ] 在隔离 PostgreSQL 测试库运行 `pnpm test`，包括 API/Web/Desktop、同步、迁移与边界检查；`pnpm build`、`git diff --check` 通过。失败时修代码或明确阻断，不把旧日志当当前结果。
- [ ] 在候选目录构建 Linux API 镜像，镜像标签含本次发布 ID；独立启动无供应商密钥的候选 API 和空 PG，验证 `/health`、`ffmpeg`、`ffprobe` 与 PostgreSQL 连接。

### Task 2: PostgreSQL 服务与 schema10 副本升级工具

**Files:** 修改 `deploy/docker/compose.yaml`、必要的 Dockerfile；创建 `apps/api/scripts/upgrade-sqlite-copy.mjs` 与测试。

**Interfaces:** CLI 只接受 `--source <绝对路径> --destination <不存在的绝对路径>`；先用 SQLite backup API 或等价安全复制得到副本，再在副本调用 `legacy-sqlite.ts` 的 `createDb` 升到 schema10；输出 JSON `{ sourceVersion: 9, targetVersion: 10, counts }`，失败时保留 source 原样。

- [ ] 测试 schema9 fixture 升级、source 字节不变、目标已存在拒绝、失败保留 source；验证导入器读取升级副本。
- [ ] 配置固定版本/摘要的 PostgreSQL 镜像、独立持久目录、健康检查、非公网端口；API 从服务器 0600 凭据文件获得 `DATABASE_URL`，日志不打印密码。
- [ ] 在服务器创建空 PG 测试库，不接公网 API；用活动库的只读快照完成 schema9→10→PG 演练，核对导入 JSON、每表计数与 `missingObjectFiles`。演练失败只影响测试库。

### Task 3: 停写、备份与正式导入

**Files:** 创建 `deploy/postgres/preflight.sh`、`cutover.sh`、`verify.sh`；发布日志与备份清单。

- [ ] 停止旧 API 容器，确认健康入口暂不可写；为 `/var/lib/ai-video-studio` 整目录、活动 SQLite、受限 env 和旧镜像/Compose/Nginx 配置生成带时间戳备份。SQLite 快照 `PRAGMA integrity_check=ok` 且 schema=9。
- [ ] 在**备份副本**上升级 schema10；核对源/副本各表计数、旧库未改变；导入空正式 PG 库，导入器输出 `status=imported`、`missingObjectFiles=0`，每张表行数相等。
- [ ] 失败时保持旧 API 停止，诊断并在未开放新 PG 写入时决定重试或恢复旧 API；不自动覆盖活动媒体目录或丢弃备份。

### Task 4: 新 API 接管与真实业务验证

**Files:** 最新 Compose 配置、`verify.sh`、验收报告。

- [ ] 只启动一个新 API 容器，等待健康；核对 API 与 PG 容器状态、`/api/health`、既有测试账号登录、项目/分集/素材读取、有效照片上传与未完成任务查询。
- [ ] 用隔离测试账号真实调用一次文字 Agent，得到三版不同的单镜头方向、无视频 operation/额度变化；若仍是 `provider_error`，先诊断并修复，再允许官网使用“三版”主卖点。
- [ ] 抽查导入前后账号/项目/对象/任务计数与旧项目读取；确认 SSE/任务恢复能查原 ID，没有第二次付费供应商 POST。真实可灵付费调用不在此步默认触发。
- [ ] 只有上述通过后才开放公网并交 [官网计划](2026-10-30-official-website.md)发布；正式记录旧镜像/库备份位置、新镜像 digest、新 PG 版本与切换时间。新库接收写入后不盲目回退 SQLite。

## Self-review

schema9→10→PG 的不可跳步骤在 Task 2/3；用户数据、素材、账号、任务恢复与真实 Agent 可用性在 Task 4；主站切换受 Task 4 门禁约束。此计划不把静态站构建、DMG 打包当成数据库验收。
