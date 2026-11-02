# 配音与 Agent 剪辑候选发布预检

日期：2026-10-30（北京时间）。本文记录候选发布的服务器侧实测；当前公网尚未切换到该候选。

## 固定候选

| 项目 | 校验值 |
| --- | --- |
| 源码归档 | `648bff4b2475260b0a10b1d81198a542aac2dacdb97d5bba3902e8206d711b2d` |
| 服务器候选 API 镜像 ID | `sha256:39b999f30f7cf0058304eea0a05a00b030496685fe0ecf629246fcd2b7274694` |
| Web 构建归档 | `1e8d4ec93c07fec0369d57ae82992e9e1d9f82c56cd4cc4a0cee33287a4e466c` |
| Web `index.html` / JS / CSS | `fc6de40486782b9cbbf0225da606a2876648522c5ebb6a8885a4eb768ac76ce4` / `a95211393657a9a4e47505df7e47359f648818da31ea4df687197ea5136bde95` / `3799ae1bc47e06c13b1acbae1347385afab9213232a225e1511deb27e999e315` |
| 当前公网 API | `ai-video-studio-api:20261030-official-04`，镜像 ID `sha256:7deadab87afb60a160005459e0ad47fe5796e7fe4b8c620ccc19de6a28b147d8` |

源码与 Web 归档均已按完整 SHA-256 在服务器核对，分别解压至新的候选发布目录。候选镜像在服务器使用已缓存的 Node 24 Debian 基础镜像构建；构建未重启公网 API。完整源码文件清单见 [音频修复候选清单](evidence/2026-10-30-voiceover-agent-edit/source-manifest-audiofix.txt)。

## 生产现状与备份

只读检查确认：公网 API 已连接 PostgreSQL `ai_video_studio`，`api_schema_version=1`、15 张业务表；并非 SQLite 运行模式。数据库约 8 MB，媒体目录约 612 KB。服务器受限目录 `/srv/ai-video-studio/backup/voiceover-preflight-20261030T0610Z` 保存了 PostgreSQL 自定义格式 dump、媒体目录 tar 和各自校验和；目录权限为 0700，备份文件为 0600。`pg_restore -l` 可读取 dump。该备份是演练快照，正式切换前仍须停写并取得最终一致性备份。

## 隔离演练结果

1. 将 dump 恢复至同集群的隔离数据库，使用候选镜像把 schema 1 升至 3；原有 15 张表逐表精确行数一致，新增 5 张表为空，生产库仍是 schema 1。
2. 在不开放公网端口的候选 API 容器中连接隔离库和媒体副本；`/health` 返回 200。候选迁移校验器确认 15 张旧表行数一致、`missingObjectFiles=0`；运行角色可操作业务表而不能执行 DDL。
3. 再将同一 dump 恢复至**独立 PostgreSQL 17 容器与内部 Docker 网络**，重做 schema 1→3、运行角色创建/授权和迁移校验。结果为 schema 3、20 张表、原表行数一致、`missingObjectFiles=0`；新 5 张表的 `SELECT/INSERT/UPDATE/DELETE` 权限逐项为 true，角色验证通过。该网络没有公网端口，也没有付费供应商凭据。
4. 候选 Linux 镜像的真实双镜头媒体渲染已验证第 6 秒有人声和音乐、第 9 秒仍有音乐，未检测到原先片尾静音；详见 [候选清单](evidence/2026-10-30-voiceover-agent-edit/source-manifest-audiofix.txt)。

## 正式发布前仍需完成

- 使用 [schema 1→3 升级手册](../../deploy/postgres/schema1-to3.md)在维护闸门下取得最终备份、核对源库与演练库、迁移正式库、授予新增表权限，然后私有验收并切换 API 与 Web。旧 SQLite 切换脚本不适用。
- 测试会话以同一候选完成桌面原生操作和完整回归报告；本地通过项不等于公网通过。
- 可灵 TTS HTTPS 域名可连通；真实账号权限、实际扣费、声音与结果尚未验证。当前配置只有官方文档示例的英文音色，中文音色需核实后配置。Agent 剪辑的兼容文字模型尚未配置，不能将建议生成标为已上线可用。

## 隔离 TTS 实测与配置修正

在独立 PostgreSQL 17 和不开放公网端口的候选 API 容器中，创建一次测试账号／项目；`POST /projects/:id/tts/estimate` 返回 `billingPolicy=actual-usage`、`estimatedCost=null`。随后用持久化的 `clientRequestId` **仅提交一次**官方示例英文音色的 TTS 请求，API 为 201，任务最终为 `failed`、`costStatus=unbilled`、无供应商任务 ID 与配音资产。没有再次提交。

免费账户查询定位到凭据区域问题：服务器现有 `KLING_API_KEY` 在 `api-beijing.klingai.com` 返回 HTTP 200、业务码 0；在 TTS 文档使用的 `api-singapore.klingai.com` 返回 HTTP 401、业务码 1002（`api key not found`）。北京域名的 TTS 路径返回 404。因而该凭据仍可留给现有视频流程，但不能作为此 TTS 地址的有效凭据。候选源码现已增加独立的 `KLING_TTS_API_KEY`，未配置时不提供音色／付费 TTS 提交；API 集成测试已验证此配置边界。**本节测试发生在早前归档候选上，新增配置代码需要重新冻结、构建和演练后才能发布。**
