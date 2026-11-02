# Docker API 生产切换记录

## 范围

2026-10-29 22:20（北京时间）将 `39.108.55.176` 上的 API 从 `ai-video-studio.service` 切换为 Docker Compose 单容器。网页静态文件与 HTTPS 仍由已有的 `sr-nginx` Docker 容器提供；线上数据库仍为 SQLite schema 9，没有发布本地 PostgreSQL 改动。

## 切换证据

| 项目 | 结果 |
| --- | --- |
| 源码 | 镜像从线上 release `/srv/ai-video-studio/releases/20261029-cursor-01` 的独立构建副本生成，没有修改原 release。 |
| 镜像 | `ai-video-studio-api:20261029-cursor-01-docker2`；镜像 ID `sha256:75c196761afaf89d5d1045599578f7eb6decd8aaa5ccfe00a7e25a4849607bb8`。 |
| 预检 | `docker compose config --quiet` 通过；隔离空数据容器的 `/health` 为 200，Linux `ffmpeg`、`ffprobe` 均可执行。首次镜像发现 ffprobe 无执行权限，已在第二版镜像构建时修复并复测。 |
| 备份 | 停止旧 API 后，完整数据目录备份为 `/var/backups/ai-video-studio/data-before-docker-20261029T142054Z.tar.gz`；同批保留独立 SQLite、环境文件和 systemd 单元。备份 SQLite `integrity_check=ok`、schema 9。 |
| 容器 | Compose 项目 `ai-video-studio`，容器 `ai-video-studio-api` 为 `running / healthy`；镜像 ID 匹配；重启策略 `unless-stopped`。Docker 服务已启用，旧 systemd API 保留但为 `inactive / disabled`。 |
| 数据 | 主机 `/var/lib/ai-video-studio` 以 UID 999/GID 987 挂载到容器；切换后 SQLite `quick_check=ok`。环境与供应商密钥由 `/etc/ai-video-studio/api.env` 注入，没有打包入镜像。 |
| 公网 | 首页与 `/api/health` 均为 200；注册 201；有效 JPEG 上传 `/api/objects` 为 201、249 字节。 |

Nginx 现有 `/api/` upstream `172.23.0.1:8787` 未变。生产容器只向该 Docker 桥接网关地址发布 8787，不开放到公网。切换脚本含失败时停止新容器、重新启用旧 systemd 的回滚路径；本次切换成功，未实际触发回滚，也没有做整机重启演练。

## 用户流程回归与已知问题

独立测试会话的逐项结果、脱敏接口状态和截图见 [Docker 切换后线上浏览器回归](2026-10-30-docker-deployment-regression.md)。账号、项目、照片上传和导航通过；文字灵感的记录为 `failed / provider_error`，尚未生成三条方案。容器持凭据对 Cursor Agents 的只读请求为 200，说明基本网络与认证可用；供应商失败阶段未确认。原始生产日志的读取被自动审批拒绝，原因是日志可能包含密钥、请求和会话信息，因此本次未导出日志。没有执行付费可灵视频生成。

## 回滚

常规代码回滚见 `deploy/docker/README.md`：停止 Compose，再 `systemctl enable --now ai-video-studio`。不要用发布前数据库快照覆盖切换后新增的账号、项目或素材。备份只在确认数据损坏并制定恢复方案后使用。
