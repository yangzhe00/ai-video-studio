# PostgreSQL schema 1 → 3 升级手册

适用对象：已在 PostgreSQL `ai_video_studio` 运行的 `20261030-official-04` API。只读核对显示 `api_schema_version=1`、原有 15 张表。仓库候选 API 要求 schema 3；隔离恢复库演练已有一次通过，**线上仍为 schema 1，未执行正式升级**。不要运行本目录的 `preflight.sh`、`rehearsal.sh`、`cutover.sh`、`verify.sh`、`migrate-sqlite-to-postgres.mjs`，也不要使用现有 `deploy/ci/server-release.sh` 的 `prepare/cutover/activate/publish` 流程：它们仍按历史 SQLite→PostgreSQL 导入编排。

## 已完成的隔离演练与仍需验证的范围

服务器侧演练报告：生产数据库约 8 MB、媒体目录约 612 KB；受限备份位于 `/srv/ai-video-studio/backup/voiceover-preflight-20261030T0610Z`（目录 0700、文件 0600）。生产 PostgreSQL dump 恢复到独立数据库 `avs_voiceover_rehearsal_648bff4b` 后，候选镜像运行 `migrate-schema.mjs` 升至 schema 3；15 张旧表行数逐表一致，5 张新表为空，对象文件缺失数为 0。隔离 API `/health` 返回 200，`verify-runtime-role.mjs` 通过。候选源码归档哈希报告为 `648bff4b…711b2d`，镜像 ID 报告为 `sha256:39b999f3…7274694`；**这里的缩写不可用作校验值，正式发布需从受限发布证据取得完整哈希和镜像 ID**。

这次演练证明该时点生产备份的结构可以被候选迁移脚本处理。它没有证明后续生产写入与最终备份一致，也没有完成旧账号、项目、素材、未完成任务和新功能的私有业务验收。现有 `verify-runtime-role.mjs` 只检查 `accounts` 的 DML、版本表保护和 DDL 拒绝，**没有逐表验证新增 5 张表的 DML 授权**；正式窗口必须补做。

## 迁移内容和兼容边界

`apps/api/src/db.ts` 的 `migrateSchema` 在单个 PostgreSQL 事务中取得事务级 advisory lock，执行 `schema.sql`、`schema-v2.sql`、`schema-v3.sql`，最后把版本改为 3。基础 SQL 包含旧 15 张表的 `CREATE TABLE IF NOT EXISTS`、可重复添加的列和索引；v2 新增 `tts_tasks`、`episode_render_operations`、`agent_edit_sets`，v3 新增 `preview_operations`、`preview_owned_objects`。若执行中报错，DDL 和版本更新一起回滚。API 启动只接受版本 3，启动本身不迁移。

仓库测试覆盖按当前 `schema.sql` 建立、写有旧记录的 schema 1 → 3；隔离恢复库演练进一步覆盖了生产快照。**15 张表和版本号本身不能证明后续正式数据库仍与已演练快照相同**。`IF NOT EXISTS` 遇到同名但结构不同的表不会修复它。最终备份的结构比较未通过时停止发布，先编写并演练明确的差异迁移，不要直接运行 `migrate:schema`。

## 1. 冻结候选与只读清点

1. 记录同一份候选源码的提交／归档校验、Linux API 镜像 digest、迁移脚本内容、当前 API 镜像 digest、PostgreSQL 镜像 digest 和数据库版本。上线镜像必须来自已验证的同一源码候选。
2. 以只读事务记录 `api_schema_version`、15 张表名称、每张表行数；导出生产库的 schema-only DDL，逐表核对 `schema.sql` 中的列、数据类型、非空、默认值、主外键、唯一约束和索引。额外列或约束也要评估对新 API 写入的影响。特别核对 `accounts`、`sessions`、`projects`、`objects`、`agent_runs`、`operations`、`prompt_idea_sets`、`render_operations`。
3. 保存代表性旧记录的 ID 与状态摘要：登录会话、项目及分集、素材路径、未完成任务的外部任务 ID、渲染和灵感请求。只记录核对值，不在日志输出密码哈希、会话 ID、密钥或用户正文。
4. 核对 `API_DATA_DIR` 对象文件存在且容量足够；数据库备份不能代替媒体文件备份。确认迁移账号可执行 DDL，运行账号仅可读写业务表。

## 2. 在独立恢复库演练

1. 用 PostgreSQL 一致性备份取得完整数据库副本（例如 `pg_dump -Fc`），备份媒体目录、部署配置和旧镜像引用。备份留在受限目录，禁止加入 Git。**将备份恢复到独立 PostgreSQL 实例／集群**，验证恢复结果与只读清点的版本、表数、行数、关键 ID 一致；仅看到备份文件存在不算可恢复。仅创建同一生产集群内的另一个数据库，不足以安全演练角色变更。
2. 隔离恢复库的 API、worker、供应商凭据和公网流量。用候选源码和迁移账号，仅对该恢复库执行 `pnpm --filter @ai-video/api migrate:schema`。`DATABASE_URL` 必须指向恢复库，且与正式库地址不同；先复核目标再运行。演练不调用付费生成服务。
3. 验证版本为 3，总计 20 张表；原 15 张表行数、关键 ID、任务状态和对象路径不变，新 5 张表为空。重复执行一次迁移，结果应不变。用同一候选 API 镜像连接该恢复库，验证登录、旧项目／分集／资产读取、未完成任务查询和新接口的数据库读写。
4. 在独立 PostgreSQL 实例／集群中，对新增表重新授予运行账号必要 DML 权限，并**逐一**验证 5 张新表的 `SELECT`、`INSERT`、`UPDATE`、`DELETE` 权限；再运行 `verify-runtime-role.mjs` 验证旧表、版本表和 DDL 边界。现有 `apps/api/scripts/provision-runtime-role.mjs` 会重设运行账号密码，并对固定名称 `ai_video_studio` 数据库授权；不得在与生产共用角色的集群上用它做演练。保存演练结果和回退试验记录。

## 3. 正式窗口与发布门槛

此阶段需另行批准。按以下顺序执行，每步保留时间、完整哈希和不含密钥的核对结果；任何一步失败都保持维护闸门，不进入下一步。

1. 从受限发布证据核对**完整**源码归档 SHA-256、候选 API 镜像 ID 和构建来源。镜像须与已通过隔离演练的源码候选一致；若候选代码或镜像变了，先重建并重做恢复库演练。记录旧 API 镜像和当前配置的完整标识。
2. 对公网 `/api/` 打开并验证维护响应，确认写入被拒绝；停止旧 API 及其后台 worker，确认没有其他可写实例。此时旧服务和 PostgreSQL 仍应可供只读检查，但不得启动候选 API 连接 schema 1。
3. 对**停止写入后的生产 PostgreSQL** 取得最终一致性 dump，另备份媒体目录、环境／Compose／Nginx 配置及旧镜像引用。恢复最终 dump 到全新隔离 PostgreSQL 实例／集群，核对 schema 1、15 张表、逐表行数、关键 ID、对象路径与正式库一致。旧的 `voiceover-preflight-20261030T0610Z` 备份只证明早前快照，不能代替本步骤。
4. 使用已核对的**同一候选镜像**，在最终恢复库重复 schema 1→3 迁移、20 表和原表计数核对、对象文件检查与运行账号权限验证。比较这次与早前演练的 DDL 差异；出现未审结构变化、对象缺失或失败时停止。
5. 保持维护闸门，使用迁移账号对**正式 PostgreSQL** 执行候选镜像的 `node --experimental-transform-types apps/api/scripts/migrate-schema.mjs`。在执行前由两人核对 `DATABASE_URL` 指向 `ai_video_studio` 正式库、镜像 ID、维护状态；不得使用 SQLite 导入脚本或旧 CI 发布阶段。迁移事务失败时按下文处理。
6. 核对版本 3、20 张表、原 15 张表的行数与关键记录、旧任务状态以及媒体路径。对新增 5 张表授权并逐表验证四种 DML 权限；确认版本表只读、DDL 拒绝。运行角色授权脚本会重设密码，须先核对密码文件与运行配置。此阶段仍不开放公网写入。
7. 仅启动一个同镜像候选 API，在私有入口做 `/health`、既有账号登录、旧项目／分集／资产读取、未完成任务按 ID 查询，以及配音、预览等新接口的安全业务检查；不为验收发起付费生成。确认 API 与数据库健康、无意外 worker 重复处理、日志无权限错误后，才开放公网并监测首批真实请求。

正式升级期间 PostgreSQL DDL 可能等待表锁；当前连接池设置 `lock_timeout=5s`、`statement_timeout=30s`。超时属于失败，不得通过反复重试绕过维护、备份与核对步骤。

## 失败与回退

- **迁移事务失败**：事务自动回滚；维持维护闸门，核对版本仍为 1、原表和记录未变。查明原因后在隔离恢复库重新演练。旧 API 仅在确认其对应的 schema 1 状态未变后重启。
- **迁移已提交、尚无新写入**：旧 API 不应直接连接 schema 3；它可能不兼容。保持维护闸门，可把最终备份恢复到另一独立数据库并验证，再经受控连接切换到恢复库与旧镜像。不要在原库上直接覆盖文件或盲目降版本号。
- **schema 3 已接受新写入**：直接恢复旧备份会丢失这些写入。保持维护闸门并保留现库，优先修复向前；若必须回退，先制定新增记录的对账与迁移方案并验证。媒体文件与数据库须按同一业务边界核对。
- **授权或私有业务验收失败**：维持维护闸门，保留已迁移的正式数据库和日志。先排查新增表权限、候选镜像、供应商配置及 worker 状态；未开放写入时可按上条“迁移已提交”方案恢复。不能仅凭 `/health` 返回 200 就开放公网。
