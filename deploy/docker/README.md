# API Docker 部署

> 本文是 2026-10-29 的 Docker + SQLite 历史发布记录。线上已在 `20261030-official-04` 切换至 PostgreSQL；以下旧 `cutover.sh`、SQLite 回滚命令和运行配置不适用于当前线上服务。后续 schema 1→3 升级见 [PostgreSQL 升级手册](../postgres/schema1-to3.md)。

新候选的文字配音使用独立的 `KLING_TTS_API_KEY`；视频生成仍使用 `KLING_API_KEY`。两者只写入服务器受限的 API 环境文件。`KLING_TTS_BASE_URL` 默认是可灵 TTS 文档中的 `https://api-singapore.klingai.com`。未配置 TTS 密钥时服务端不提供可选音色，也不接收付费 TTS 提交。不要为启用 TTS 覆盖已有视频密钥。

2026-10-29 时，线上网页由 `sr-nginx` 容器提供静态文件和 HTTPS；当次操作把 API 从 systemd 切换为单个 Docker Compose 容器。当时仍使用 SQLite schema 9，PostgreSQL 迁移不包含在该次切换中。

## 构建

在 Ubuntu x86_64 服务器上，从**当前线上 release** 复制一个独立构建目录，保留 `package.json`、`pnpm-lock.yaml`、`pnpm-workspace.yaml`、`apps`、`packages` 和 `plugins`。将 `Dockerfile.api` 与仓库根目录的 `.dockerignore` 复制到构建目录，然后运行：

```sh
docker build --build-arg NODE_IMAGE=docker.m.daocloud.io/library/node:24-bookworm-slim \
  -f Dockerfile.api -t ai-video-studio-api:20261029-cursor-01-docker2 .
```

构建会从锁文件安装 API 的 workspace 依赖并执行 Linux `ffmpeg`、`ffprobe` 预检；不从 macOS 复制 `node_modules`。`node:24-bookworm-slim` 是默认基础镜像，`NODE_IMAGE` 构建参数允许在国内服务器使用同一官方镜像的代理地址。

## 运行

服务器 `/srv/ai-video-studio/docker/compose.yaml` 使用此目录的 `compose.yaml`，同目录 `.env` 仅放非密钥配置：

```dotenv
API_IMAGE=ai-video-studio-api:20261029-cursor-01-docker2
API_BIND_IP=172.23.0.1
API_HOST_PORT=8787
API_UID=999
API_GID=987
API_DATA_DIR_HOST=/var/lib/ai-video-studio
```

Compose 项目名固定为 `ai-video-studio`，避免与服务器上其他 Compose 服务共用项目名。它从 `/etc/ai-video-studio/api.env` 注入真正的服务配置与密钥。此文件不要放进镜像、Git 或对外可读目录。`API_DATA_DIR` 在容器内应为 `/var/lib/ai-video-studio`。映射的主机 IP 是 `sr-nginx` 当前 Docker 网络的网关；如果该网络重建并改变网关，先更新映射和 Nginx upstream。保持一个 API 实例，因为 SQLite 和进程内 worker 不支持水平扩容。

上线时先运行隔离容器验证 `/health`、`ffmpeg` 和 `ffprobe`，再执行 `cutover.sh`。它备份 SQLite、数据目录、环境文件和 systemd 单元，停止旧服务，启动 Compose 并检查站点。失败时自动尝试恢复旧 systemd 服务。

## 回滚

若新容器已接收真实请求，普通代码回滚只切回旧 API 进程，不覆盖当前数据库或对象文件：

```sh
cd /srv/ai-video-studio/docker
docker compose down
systemctl enable --now ai-video-studio
curl -fsS http://127.0.0.1:8787/health
```

数据库备份只用于确认损坏后的单独恢复流程；恢复旧快照会丢失切换后产生的数据。网页部署仍由现有 Nginx 静态目录管理。
