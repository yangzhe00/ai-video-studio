# Python + Redis 部署与学习说明

日期：2026-11-03。**当前 Python 候选只实现健康、账号、项目创建/读取、对象读取和 Redis 限流基础；还未迁移生成、灵感、TTS、剪辑、上传与付费 worker，不能替换线上 Node 服务。** 本文是完成协议对照和 worker 回归后的部署步骤，不是已执行记录。

## 四个组件各自做什么

- FastAPI：处理网页、桌面、移动端的 HTTP 请求，检查 Cookie、输入与权限，返回原有 JSON/SSE/媒体协议。
- PostgreSQL：项目、账号、对象、任务、幂等键、租约及事件的权威数据；重启后必须能恢复，付费任务也只从这里领取。
- Redis：多个 API 实例共享的请求计数和有 TTL 的短期目录缓存。若 Redis 停止，认证与消耗额度的入口明确返回临时故障；只读缓存可以直接查原始来源。Redis 不承担会话或唯一任务记录。
- Python worker：独立进程执行耗时的供应商请求和 FFmpeg；不能因为 Web 请求断开就丢任务，也不能在未知供应商结果时重发可能计费的 POST。

## 本地候选检查

在项目根目录构建锁定依赖的镜像：

```bash
docker build -f deploy/docker/Dockerfile.api-python -t ai-video-studio-api-python:candidate .
```

目前可在隔离的 PostgreSQL schema 4 和 Redis 容器上运行 Python 测试；不要让候选 API 指向生产数据库。测试镜像 `deploy/docker/Dockerfile.api-python-test` 只用于本地/CI。当前候选镜像没有 FFmpeg，worker 和媒体上传尚未可用。

## 生产切换前的条件

1. `docs/architecture/python-api-route-matrix.md` 每条路由均有 Python 等价实现与自动/人工对照证据，包括错误包、Cookie、SSE、上传和媒体 Range。
2. 所有付费任务类型完成 PostgreSQL 租约、重复请求和未知状态恢复测试；Node 与 Python worker 绝不能同时领取同一类任务。
3. 在隔离环境恢复生产数据库和对象目录副本，用三个客户端验证旧账号、旧项目、媒体、v3 时间线及预览/导出；真实付费调用只在受控联调中使用。
4. 服务器测量 PostgreSQL、API、Redis 与 FFmpeg 并发的内存峰值和磁盘空间。Redis 设置 `maxmemory`、容器内存限制和告警，不向公网发布 6379 端口。
5. 服务端的 `DATABASE_URL`、`REDIS_URL`、`API_SESSION_SECRET` 与模型密钥放在受限环境文件或 Docker secrets；不写入 Git 或镜像。

## 正式部署顺序

1. 在目标架构构建并标记 Python 镜像，核对镜像摘要与 `uv.lock`。先部署内部 Redis，设置密码/ACL、健康检查与容量上限；Docker Compose 等待 PostgreSQL 和 Redis 健康后再启动 Python API。API 与 worker 为分离的容器，只有 API 绑定到 Nginx 可达的回环端口。
2. 冻结写入并停止 Node API/worker 的任务领取。备份 PostgreSQL 和媒体对象目录，在隔离位置完成一次恢复验证。数据库 schema 升级由独立迁移命令执行，API 启动只检查版本。
3. 启动 Python API 和**一个** Python worker，先在私有入口验证 `/health`、登录、项目、对象 `200/206/416`、SSE、任务恢复与一次受控付费链路。确认成功后再切换 Nginx `/api` upstream 并开放写入。
4. 监控 5xx、429、Redis 可用性、任务积压、未知供应商状态、CPU/内存和 FFmpeg 失败。故障时先停写和停止 worker；若新写入仍可由 Node 读取，可对账后切回旧镜像。不能用旧备份覆盖切流后产生的新数据。

Docker Compose 的 `depends_on: condition: service_healthy` 只解决启动顺序，业务可用性仍需接口和任务回归。参考：[FastAPI 教程](https://fastapi.tiangolo.com/tutorial/)、[Psycopg 异步连接](https://www.psycopg.org/psycopg3/docs/advanced/async.html)、[Redis 限流计数](https://redis.io/docs/latest/commands/incr/)、[Redis 内存淘汰](https://redis.io/docs/latest/develop/reference/eviction/)、[Docker Compose 启动顺序](https://docs.docker.com/compose/how-tos/startup-order/)。
