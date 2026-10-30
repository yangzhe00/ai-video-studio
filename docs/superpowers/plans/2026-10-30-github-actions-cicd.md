# GitHub Actions CI/CD Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给本仓库增加可复现的 CI 和受保护的分阶段生产发布流程，发布同一 Git commit 的官网、Web 与 PostgreSQL API，并保护当前 SQLite 用户数据。

**Architecture:** CI 从干净的 Git commit 构建，使用隔离 PostgreSQL 跑全仓测试。部署 workflow 只允许默认分支上的 40 位 commit，经 GitHub `production` environment 审核后，通过固定 SSH host key 调用服务器上 root 所有的发布脚本。服务端按 prepare、cutover、activate、publish 四段持久标记；正式导入复用已有 `deploy/postgres` 脚本，静态站最后发布。任何一段失败都保持或恢复维护状态，不把 PG 新写入回灌旧 SQLite。

**Tech Stack:** GitHub Actions、Node 24、pnpm 10.30.1、PostgreSQL 17、Docker Compose、Nginx、Bash、Python 3。

**Spec:** [PostgreSQL 切换计划](2026-10-30-postgres-production-cutover.md)、[官网计划](2026-10-30-official-website.md)、[部署规范](../../../.codex/.agent/deployment.md)。

## 当前实施状态（2026-10-30）

候选 PostgreSQL/官网部署工作流、服务器四阶段脚本、操作手册和公网路由校验器已写入共享工作树，但尚未提交到默认分支或在 GitHub Actions 实际运行。本地 YAML、Bash、Node 语法检查通过；公网校验器 4 个单测通过；Web、官网和 API 的构建通过，移动端 TypeScript 检查通过。隔离 PostgreSQL 下候选 API 单包测试为 81/81 通过；候选代码的并行根目录 `pnpm test` 曾出现其中一个登录限流用例 5 秒超时，部署门禁仍视为未通过，需根命令再次通过。当前 `gh` 未登录，现有 SSH 身份登录服务器被拒，`production` environment/Secrets 和服务器 root 所有发布脚本的配置状态尚未核实，因此没有触发生产部署。请勿将本地检查当作线上发布证据。

基础 CI 已从干净的默认分支提交为 `9fe73b76acce7b8279a96467b7186ac45b28d7c0`，推送至 `codex/github-actions-cicd`，并创建[草稿 PR #1](https://github.com/yangzhe00/ai-video-studio/pull/1)。[push 运行](https://github.com/yangzhe00/ai-video-studio/actions/runs/40987615765)和 [PR 运行](https://github.com/yangzhe00/ai-video-studio/actions/runs/40987695311)均已完成且结论为 `success`：workspace 的 frozen install、全仓 test/build 和 macOS Cargo test 均通过。该分支只含基础 `.github/workflows/ci.yml`；上段所述候选 PostgreSQL/官网部署工作流及其依赖文件仍在共享工作树，尚未提交，也没有在 GitHub 运行。候选根测试的并行超时与当前已提交代码的成功运行属于不同代码版本，不能互相替代。

## Global Constraints

- 当前线上为 SQLite schema 9 单 API；当前工作树 PostgreSQL 及官网文件大多未提交。Actions 只能发布已提交、经测试的源码；不得把当前脏目录直接打包上传。
- 正式切换前维护门禁必须实际对外返回 503 和 `X-AVS-Maintenance: 1`；正式备份含 WAL 已提交数据，导入后 `missingObjectFiles=0` 与各表计数一致。
- GitHub Secrets 仅存 SSH 私钥和固定 host key；数据库、供应商与会话密钥只在服务器 0600 文件中。工作流默认 `contents: read`，`production` environment 需 required reviewer。
- 同一时间只能有一个发布，候选镜像和 PG 镜像必须按 digest/commit 固定；不自动执行真实可灵付费生成。
- 当前安全协议变更仍在并行施工，三端未适配且 API 测试未恢复前，不触发生产切换。

## Review Focus

1. PR/非默认分支不能获得部署密钥；Task 1、2 校验。
2. 失败的 PG 测试不能进入上传阶段；Task 1、2 校验。
3. 演练库和正式库目录不能相同；Task 3 校验。
4. `cutover` 不能仅凭人工布尔输入绕过公共维护门禁；Task 3 校验。
5. 发布失败后静态站与 Nginx 可恢复，PG 数据不能倒退到旧 SQLite；无合格 DMG 时下载入口必须禁用但官网仍可发布；Task 4 校验。

---

### Task 1: 只读 CI 门禁

**Files:** Create `.github/workflows/ci.yml`。

**Interfaces:** `push`、`pull_request`、`workflow_dispatch` 触发；Ubuntu Node 24 + PostgreSQL 17 服务提供 `TEST_DATABASE_URL`，执行 `pnpm install --frozen-lockfile`、`pnpm test`、`pnpm build`。macOS job 执行桌面 Rust 测试。所有 job 最小权限且无生产 Secrets。

- [ ] 编写 workflow；测试服务使用独立非生产密码、健康检查、固定 localhost 端口。
- [ ] 用 YAML 解析器、shell 检查和本地可执行的聚焦命令核对语法；推送后以 GitHub run URL 确认真实 CI 结论。

### Task 2: 冻结 commit 的部署工作流

**Files:** Create `.github/workflows/deploy.yml`。

**Interfaces:** 手动输入 `release_sha`（完整 SHA）与 `phase`（`prepare|cutover|activate|publish`）；只接受默认分支祖先。先在无 Secrets 的 verify job 复跑 Web/API 测试和构建，`git archive` 只打包 commit 已跟踪文件并附当次构建的官网/Web `dist`；后续 `production` environment job 用 SSH known_hosts + 私钥传候选包，调用服务器预安装脚本。

- [ ] 写失败门禁：错误 SHA、非默认分支 commit、缺 build、测试失败、缺 Secrets 均不得调用远程脚本。
- [ ] 配置 `concurrency` 禁止并发部署，`cancel-in-progress: false`；不在日志打印秘钥/环境文件。
- [ ] 推送工作流后核对 default branch 可触发、environment reviewer 与 Secrets 名称；缺任何项停止在准备阶段。

### Task 3: 服务端准备、演练与正式迁移

**Files:** Create `deploy/ci/server-release.sh`、`deploy/ci/README.md`；复用已有 `deploy/postgres/rehearsal.sh`。

**Interfaces:** `server-release.sh <phase> <release_sha> <bundle_sha256> <script_sha256>` 作为 root 所有文件预安装到 `/usr/local/sbin/avs-release`；只读 `/etc/ai-video-studio/release.env` 的绝对路径配置。`prepare` 验证 bundle 哈希并在唯一 release 目录构建镜像，基于在线 SQLite 的一致性快照演练 schema 9→10→隔离 PG，验计数/对象，清理演练容器并运行已有 preflight；`cutover` 验证公网维护门禁后调用已有 cutover/verify；`activate` 只启动一个候选 API 并检查私有健康。

- [ ] 服务器脚本强校验 SHA、root、路径与阶段标记；演练与正式 PG 目录不能共用。
- [ ] 在本地运行 `bash -n`、参数拒绝测试；服务器准备好后用真实 SQLite 快照跑完整演练并保存导入/验证报告。
- [ ] 正式迁移只在维护门禁与独立演练通过后运行；保留完整备份，不允许新 PG 接收公网写入前省略私有业务回归。

### Task 4: 官网静态切换与验证

**Files:** Modify `deploy/ci/server-release.sh`，document production setup in `deploy/ci/README.md`。

**Interfaces:** `publish` 需 root 管理的业务验收标记与候选 API 健康；若存在 DMG 清单则验证文件 hash/安装验收，若无清单则验证下载入口禁用。备份现有静态 index 与 Nginx 配置；先复制资源，再在同一文件系统原子替换官网与 `/studio/` index；`nginx -t`、reload、公网路由校验全过才写发布标记。失败时恢复 Nginx 和静态 index，保留 PG 与数据，公共 API 回维护状态。

- [ ] 验证缺 manifest、错误 DMG hash、Nginx `-t` 失败、路由核对失败均不会声明发布成功。
- [ ] 实际发布后保存 Actions run URL、镜像 digest、备份路径、HTTP/页面及下载校验结果；前端/后端安全变更均通过后才开始。
