# 2026-11-02 媒体播放性能优化与线上部署

## 问题与改动

- 原 `/objects/:id` 对视频一次返回完整文件，不支持 HTTP `Range`；浏览器拖动进度条时难以按需读取。现在已在鉴权后支持单段字节范围请求，返回 `206`、`Content-Range` 和 `Accept-Ranges`，不合法范围返回 `416`。
- 生成页最近项目卡片、画布节点此前会提前挂载视频元素；现在只展示源图或播放占位，点击播放时才挂载播放器。
- 资产列表的视频元素改为 `preload="none"`，减少打开页面时的并发媒体下载。

## 本地验证

- API 范围解析 10/10；API 全量测试 107/107（隔离 PostgreSQL）；Web 48/48；UI Web 23/23；工作区 `pnpm test` 与 `pnpm build` 均通过。
- 视频节点的交互测试覆盖“点击前无 video，点击后才加载”。

## 上线范围

- 线上数据库仍为 schema 1，当前仓库候选 API 已要求 schema 4。为避免数据迁移风险，线上只以既有镜像 `ai-video-studio-api:20261102-kling-cdn-hotfix-01` 为基础，叠加媒体 Range 补丁，发布为 `ai-video-studio-api:20261102-media-range-01`。
- 网页从线上同版运行源码构建，仅包含上述媒体加载优化。静态构建上传到 `/usr/local/soft/docker/nginx/html/ai-video-studio/studio`，新 JS 为 `index-DH2wquGn.js`。
- 已备份旧站点和旧 Compose 环境至 `/srv/ai-video-studio/backups/20261102-media-perf/`；新环境文件为 `/etc/ai-video-studio/release-20261102-media-range-01.env`。
- 仓库中的其余候选功能已提交供后续开发，**本次没有把 schema 4 候选 API 部署到线上**。

## 线上回归

| 检查 | 结果 |
| --- | --- |
| 静态 JS、`/api/health` | 200、200；API 容器 healthy |
| 测试账号上传素材 | 201 |
| 授权账户 `Range: bytes=0-31` | 206；32 字节与原文件一致；范围响应头正确 |
| 越界 Range | 416；`Content-Range: bytes */<size>` |
| 不带 Range | 200；文件内容一致 |
| 其他账户读取该素材 | 404 |
| 5 秒 MP4 重复上述上传、Range、完整读取和跨账户检查 | 全部通过；Range 206 返回的字节与原视频一致 |

本次冒烟使用临时测试账号、一张 8×8 PNG 和一段 5 秒 MP4，不调用付费生成。已有视频在真实浏览器中的主观流畅度仍需人工复测；单个约 10 MB 视频的编码体积和服务器出站带宽尚未改变。

## 回滚

将 Compose 环境文件切回 `/etc/ai-video-studio/release-20261102-kling-cdn-hotfix-01.env` 并仅重建 `api` 服务；将 `/srv/ai-video-studio/backups/20261102-media-perf/studio` 复制回当前站点的 `studio` 目录。
