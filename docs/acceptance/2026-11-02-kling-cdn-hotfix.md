# 可灵视频下载域名热修复（2026-11-02）

## 问题与证据

- 任务 `a0c0880e-96a5-439f-9ab2-9948a69f3adc` 的可灵查询返回 `succeeded`；视频下载地址主机为 `v2-fdl.kechuangai.com`，直接请求返回 `200 video/mp4`、`10173126` 字节。
- 原线上镜像 `ai-video-studio-api:20261030-official-04` 的 `apps/api/src/kling.ts` 仅放行 `klingai.com`、`inkwai.com` 及其子域名，拒绝上述新主机。任务长期停在 `downloading`，无对象记录、项目镜头或暂存文件。
- 当前仓库候选 API 要求 PostgreSQL schema 4，而线上为 schema 1，因此只对旧镜像叠加单文件修复；未部署候选 API，也未迁移数据库。

## 变更

- 仓库 `apps/api/src/kling.ts` 精确放行 `v2-fdl.kechuangai.com`，仍要求 HTTPS，仍逐跳校验重定向。`apps/api/src/kling.test.ts` 覆盖该主机可下载及其他 `kechuangai.com` 子域名被拒绝；5 项定向测试和 API 类型检查通过。
- 线上使用 `FROM ai-video-studio-api:20261030-official-04`、`COPY kling.ts /app/apps/api/src/kling.ts` 构建镜像 `ai-video-studio-api:20261102-kling-cdn-hotfix-01`（镜像 ID `sha256:701e9c698ee279164654f96edb1515f8936c11c44a5f0d7da2a30cae3bcc2f5c`）。原镜像与数据库不变。
- 新发布环境文件为 `/etc/ai-video-studio/release-20261102-kling-cdn-hotfix-01.env`，权限 `0600`；原 `/etc/ai-video-studio/release-20261030-official-04.env` 保留。

## 上线后核验

- API 容器 `healthy`，公网 `/api/health` 和站点首页均返回 200。
- 原任务及其操作自动变为 `saved`，未重新提交生成。事件 6 的 `assetId` 为 `3354b437-1f28-41cd-9bd5-87da55736207`；对象表和项目文档均引用该资产。
- 媒体文件已入库，`ffprobe` 识别为 H.264 MP4，828×1108，时长 5.041667 秒，大小 10173126 字节。
- 浏览器账号态播放仍需用户在网页端实际确认；未在此记录中声称已经完成浏览器播放验收。

## 回退

若出现回归，使用原发布环境文件对原 Compose 文件仅重建 API 服务：

```sh
docker compose --env-file /etc/ai-video-studio/release-20261030-official-04.env \
  -f /srv/ai-video-studio/releases/20261030-official-04/deploy/docker/compose.yaml \
  up -d --no-deps api
```

回退不会删除已入库的媒体，但旧镜像仍会拒绝从该 CDN 下载新的结果。
