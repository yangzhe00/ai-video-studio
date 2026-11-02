# 官网与 PostgreSQL 正式发布记录

日期：2026-10-30（北京时间）。范围：官网 `/`、最新版创作应用 `/studio/`、PostgreSQL API `/api/`、Apple Silicon 测试版 DMG `/downloads/`。公网入口：[https://39.108.55.176/](https://39.108.55.176/)。

## 构建与发布物

| 发布物 | 标识或校验 |
| --- | --- |
| 冻结源码归档 | `20261030-official-04`，SHA-256 `a7eccad117d4be4891a578fab286479a935cde6605c1a4f65b1d3cc810188343` |
| API 镜像 | `ai-video-studio-api:20261030-official-04`，在服务器 Linux 环境从冻结源码构建 |
| PostgreSQL | 17 系列，镜像摘要 `sha256:839fbb5a4942a7758dd93e18b42ea5649807491a0545b5eeeb8f0b8bb11857a5` |
| 官网页面 + Web + 下载包 | 暂存归档 SHA-256 `d5d9497b0ba4fb6ebb524faeb3b63ff349308a39f841c13635b6813f21629025` |
| macOS DMG | `AI-Video-Studio-0.1.0-macos-arm64.dmg`，2,992,581 字节，SHA-256 `db2dbf78c874ac4f7dad6a8ddd06c0d374f52f7fbb17256f6e007e160ede8506` |

源码工作树有其他未提交的并行改动；上述归档是本次部署的冻结边界。Nginx 下载配置在公网首次检查后追加显式 DMG MIME 映射，已同步到服务器 release 源目录和本地 `deploy/nginx/ai-video-ip.conf`，并重新通过语法与公网检查。

当前服务器 Nginx 配置单文件 SHA-256：`5804b5d36d25722ba095a34e4f7350ec04ecfa8fddf2e42f599ce7dd9700f026`。此哈希反映上线后的 MIME 修正，原冻结源码归档哈希不代表这份运行时配置。

公网真实三版 Agent 验收失败后，官网又单独发布文案修订包 `website-rev2-20261030.tar.gz`（SHA-256 `73914b594085c727cbc155e105c02ca9c1aa99c212d664bb68327f111d2c85a4`）。首页由 Agent 主叙事改为用户自写内容，明确标注“Agent 三版镜头方向即将开放”。线上 `index.html` SHA-256 为 `8573267282a64528e610455b2c452f288cf8998b823431532f66775a321274a9`；修订后公网路由、下载哈希和安全响应头均重新通过。

## 数据与服务切换

1. 备份旧 SQLite API 的完整数据目录、在线一致性数据库副本、旧镜像、环境文件、Compose 和 Nginx 配置。限制权限的备份位于服务器 `/var/backups/ai-video-studio/20261030-official-04-20261030T020910Z`；静态站备份位于同一备份根目录。备份内容不入 Git。
2. 在独立 PostgreSQL 数据目录完成第 5 次迁移演练，验证账号 5、项目 3、素材记录 5、全部 14 张业务表的计数和 5 个对象文件路径。演练期间旧 API 保持可用。
3. 将公网 `/api/` 暂时切到 503 维护响应；停止旧 API 写入，正式导入 PostgreSQL，逐表与源库计数核对，缺失对象文件 0。业务运行账号仅有 DML 权限，`CREATE`/`ALTER`/`DROP` 均被拒绝。
4. 启动单实例新版 API 并确认容器健康。维护闸门内使用独立验收账号验证注册 201、当前账号 200、项目创建 201、读取 200、退出 200、再次登录 200、重新列出项目 200。未调用付费视频服务。
5. 完整静态文件先上传，再切换首页和 Nginx 配置。配置语法通过；正式公网 `/`、`/studio/`、`/api/health`、`/downloads/latest.json` 均返回 200。正式 API 与数据库容器均为 `healthy`。

公网 `/api/` 另使用独立验收账号重跑同一组业务动作，状态均与私网一致（注册 201、项目创建 201、退出及再次登录 200、重新列出项目 200）。上线后只读比较旧/新 API 环境文件中的 `API_SESSION_SECRET`，结果为相等；未输出密钥内容。旧账号的浏览器会话延续仍需独立 UI 测试。

**回滚边界**：公网已重新开放并使用 PostgreSQL；此后新增写入只在 PostgreSQL。不能直接恢复旧 SQLite 快照，否则会丢失发布后的账号、项目和素材。出现故障时应先恢复 API 维护闸门、保留当前 PostgreSQL 数据，再评估修复或定向迁移。旧镜像和数据备份用于调查与经审查的恢复方案。

## 公网核验

`node deploy/site/verify-routes.mjs https://39.108.55.176/` 通过：首页 200、创作页及深链接 200、API 200、缺失 DMG 404、Range 206；完整下载的字节数和 SHA-256 与清单一致。初次检查发现 DMG 为 `application/octet-stream`，修复后为 `application/x-apple-diskimage`，`Content-Disposition: attachment`。文件详细记录见[DMG 验收](2026-10-30-macos-dmg.md)。

`node deploy/nginx/verify-security-headers.mjs https://39.108.55.176/` 通过：官网、创作页、API 健康与未登录响应、缺失下载响应均有要求的安全头；页面 HTML 为 `no-cache`，API 为 `no-store`。

本地验证：完整 `pnpm build` 通过，`pnpm test` 在隔离的临时 PostgreSQL Unix socket 上通过（API 78/78、官网 23/23、Web 38/38、Desktop 37/37，其他包亦通过）；`git diff --check` 通过。独立浏览器 QA 和代码评审结论另见[官网 QA](2026-10-30-official-website.md)。

## 发布限制

- DMG 为 ad-hoc 签名、未经 Apple 公证的 Apple Silicon 测试版；本地挂载、严格签名检查、独立目录启动和公网下载哈希一致已验证。浏览器下载后拖入 Applications、隔离提示和窗口操作以独立 QA 截图为准。
- 三版文字灵感服务的公网真实验收**失败**：隔离账号请求返回 201，最终 `failed/provider_error`、0 版，视频额度前后均为 `[3,0,0]`。官网已改为“即将开放”并以自写路径为主入口，详见[独立 QA](2026-10-30-official-website.md)。旧账号登录后的旧项目读取、历史未完成任务恢复及付费视频端到端生成尚不能由健康检查证明；不得宣传免费或稳定生成。
