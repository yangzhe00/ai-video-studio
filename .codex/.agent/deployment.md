# AI Video Studio 线上部署规范

> 以下大部分内容是 2026-10-29 Docker + SQLite 发布快照，仅作历史记录。2026-10-30 的 `20261030-official-04` 已将线上 API 迁至 PostgreSQL；最新只读核对见下文，旧 SQLite 切换与回滚命令不可用于当前线上环境。

## 最新数据库状态与后续升级

正式发布记录：[2026-10-30 官网与 PostgreSQL 正式发布](../../docs/acceptance/2026-10-30-official-release.md)。线上 API 镜像为 `ai-video-studio-api:20261030-official-04`，数据库为 PostgreSQL `ai_video_studio`，已观察到 `api_schema_version=1` 和 15 张表。仓库候选 API 要求 schema 3，不能直接用当前线上库启动。先按 [schema 1→3 升级手册](../../deploy/postgres/schema1-to3.md) 核对结构、完成隔离恢复演练，再安排正式发布。媒体对象仍应单独备份和核对。

### 配音服务配置

在当前 PostgreSQL 发布使用的 `/etc/ai-video-studio/api.pg.env` 中，视频密钥保留为 `KLING_API_KEY`。新候选的文字配音使用另一个变量 `KLING_TTS_API_KEY`；`KLING_TTS_BASE_URL` 默认采用可灵 TTS 文档中的 `https://api-singapore.klingai.com`。不要覆盖现有视频密钥。未配置 TTS 密钥时 API 返回空音色列表，付费任务创建不可用。只有账户认证与 TTS 权限均核实后才配置音色；默认仅包含官方示例英文音色。2026-10-30 隔离实测确认当前视频密钥仅在北京账户接口认证成功，新加坡接口返回 401/1002，因此不应复用于 TTS。密钥文件保持 root 0600，不提交、打印或复制进镜像。

## 2026-10-29 历史拓扑

| 项目 | 当时值 |
| --- | --- |
| 公网入口 | `https://39.108.55.176/`，无域名 |
| 网页与 HTTPS | 既有 `sr-nginx` Docker 容器；静态文件由主机 `/usr/local/soft/docker/nginx/html/ai-video-studio` bind mount 提供 |
| API | Docker Compose 项目 `ai-video-studio`，单个容器 `ai-video-studio-api` |
| API 镜像 | `ai-video-studio-api:20261029-cursor-01-docker2`，构建后镜像 ID `sha256:75c196761afaf89d5d1045599578f7eb6decd8aaa5ccfe00a7e25a4849607bb8` |
| 镜像源码 | `/srv/ai-video-studio/releases/20261029-cursor-01` 的独立副本；仍是 SQLite 版本 |
| 数据 | SQLite schema 9 和媒体文件均在主机 `/var/lib/ai-video-studio`，以 `ai-video` UID 999/GID 987 挂载到容器同路径 |
| 密钥 | `/etc/ai-video-studio/api.env`，只在容器启动时注入，未打包进镜像 |
| Nginx 到 API | `/api/` 代理到宿主 Docker 网关 `172.23.0.1:8787` |
| 旧服务 | `ai-video-studio.service` 保留但已停止并禁用，用于回滚 |

网页当时已在 Docker Nginx 中运行；那次新增的是 API 容器化。网页静态构建当时仍通过主机挂载发布，尚无独立的 Web 镜像。该次发布未包含 PostgreSQL 改造，也没有修改当时的线上 SQLite。

## 2026-10-29 历史发布规则

1. 确定要发布的 release 和数据库兼容版本，先在服务器 Linux x86_64 构建镜像；Dockerfile、Compose 与构建说明见 `deploy/docker/`。
2. 禁止复制本机 `node_modules` 或任何密钥进镜像。`Dockerfile.api` 从锁文件安装 API 依赖，并在构建时执行 Linux `ffmpeg`、`ffprobe -version`。
3. 在隔离的空数据目录和无供应商密钥环境启动候选镜像，验证健康接口与媒体工具；不对线上任务队列做双实例启动。
4. 停止旧 API 写入后备份活动 SQLite、完整数据目录、环境文件和 systemd 单元。先保存可回滚状态，再启动新容器。`deploy/docker/cutover.sh` 为本次 SQLite release 的可回滚切换脚本；下一版本须先更新其 release、镜像和 schema 校验。
5. 切换后核验 `docker compose ps`、`https://39.108.55.176/`、`/api/health`、注册、有效照片上传和业务回归；付费可灵生成必须单独授权和验证。

## 2026-10-29 历史检查与回滚命令（当前勿执行）

```sh
ssh root@39.108.55.176
cd /srv/ai-video-studio/docker
docker compose ps
docker inspect ai-video-studio-api --format '{{.State.Health.Status}} {{.HostConfig.RestartPolicy.Name}}'
curl -kfsS https://39.108.55.176/api/health
```

若 API 新镜像需要回退到先前的 systemd 版本：

```sh
cd /srv/ai-video-studio/docker
docker compose down
systemctl enable --now ai-video-studio
curl -fsS http://127.0.0.1:8787/health
```

常规代码回滚不恢复旧数据库快照，避免覆盖切换后新增的账号、项目和素材。仅在确证数据损坏并制定数据恢复方案后，才使用 `/var/backups/ai-video-studio/data-before-docker-20261029T142054Z.tar.gz`、`studio-before-docker-20261029T142054Z.sqlite` 和同批环境备份。

## 2026-10-29 当次验证

- Docker Compose 配置校验通过；镜像在 Linux 上构建，并在隔离容器中验证 `/health`、`ffmpeg`、`ffprobe`。
- 生产容器 `running / healthy`，重启策略 `unless-stopped`；Docker 服务已启用，旧 systemd API 为 `inactive / disabled`。
- 公网首页与 `/api/health` 均返回 200；经公网注册返回 201、有效 JPEG 上传返回 201（249 字节）；线上 SQLite `PRAGMA quick_check` 为 `ok`。
- 本次切换证据见 `docs/acceptance/2026-10-30-docker-cutover.md`；浏览器回归已覆盖登录、项目、创作、画布、结果、资产和有效照片上传，截图与逐项结果见 `docs/acceptance/2026-10-30-docker-deployment-regression.md`。
- 文字灵感仍返回 `failed / provider_error`，容器到 Cursor 的基础认证请求为 200；具体供应商失败原因未确认。未执行真实可灵付费视频生成。

## 2026-10-29 候选 CI/CD 流程记录

当时共享工作树新增候选 [CI 工作流](../../.github/workflows/ci.yml)、[生产发布工作流](../../.github/workflows/deploy.yml)及 [操作手册](../../deploy/ci/README.md)。基础 CI 已单独提交到 `codex/github-actions-cicd` 的[草稿 PR #1](https://github.com/yangzhe00/ai-video-studio/pull/1)，其 [push](https://github.com/yangzhe00/ai-video-studio/actions/runs/40987615765) 和 [PR](https://github.com/yangzhe00/ai-video-studio/actions/runs/40987695311) 运行均通过。以下候选生产发布流程仅是当时的计划，现在线上 PostgreSQL 发布事实见本文件开头。

发布按同一完整 commit SHA 分四段：`prepare` 构建候选并演练 SQLite 9→10→PostgreSQL；`cutover` 在公网维护门禁确认后正式迁移；`activate` 仅开放私有候选 API 供业务验收；`publish` 凭 root 保存的验收标记切换站点。每一段的前置条件、失败恢复与不可直接回退到旧 SQLite 的约束，以操作手册为准。正式发布前还须核对[安全检查](../../docs/architecture/2026-10-30-security-audit.md)中的跨端 CSRF 适配、数据库最小权限及线上响应头证据。
