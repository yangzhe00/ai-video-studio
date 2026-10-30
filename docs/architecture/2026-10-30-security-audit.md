# AI Video Studio 安全检查（2026-10-30）

> 进度说明：下表记录本轮审计发现时的代码状态。多会话正在并行修改工作树；复核时已看到 API 入口新增 `request-security.ts`、共享 `X-AVS-Request` 常量以及 PostgreSQL 迁移/运行角色分离脚本。它们属于**待完整回归和发布验收的候选修复**。移动端 `session.ts` 仍接受远程 HTTP，桌面发布配置仍未启用 macOS App Sandbox。线上当前 SQLite 容器不因这些未提交代码而自动改变。

## 范围、证据与边界

静态检查当前工作树的 `apps/api`、Web、Expo、Tauri/Rust、共享协议包及 Docker Compose；没有读取或记录任何密钥。线上 `https://39.108.55.176/` 在本次检查环境中无法连接，因此线上 Nginx 响应头、容器运行参数、数据库账号权限和备份权限均为**待实测**，不能把本地源码等同于线上版本。当前工作树 API 是 PostgreSQL 实现；仓库开发规范记录线上 Docker 仍为 SQLite，两个阶段须分别验收。

风险级别：P1 = 下个安全迭代优先处理；P2 = 随平台发布或数据库切换处理。这里描述的是代码边界或部署待验证项，未把未经复现的路径写成已发生的攻击。

## 已有防护

- `apps/api/src/auth.ts` 使用随机 salt + scrypt 存密码摘要，数据库仅存会话 ID 的 HMAC 摘要；`apps/api/src/server.ts` 的会话 Cookie 有 `HttpOnly`、`SameSite=Lax`，配置默认启用 `Secure`。
- API 查询普遍使用参数；对象读取包含 `owner_id`；Kling 视频下载限制 HTTPS 域名、重定向次数和 100 MB 大小；上传限制类型并调用媒体探测。
- `apps/desktop/src-tauri/tauri.conf.json` 已设置生产 CSP；`capabilities/default.json` 没有开放通用 shell 或 fs 插件权限；`media.rs` 的素材预览会检查 canonical 路径仍在项目内。
- Docker 候选 Compose 将 API 端口默认绑定到 `127.0.0.1`，API 容器使用非 root、只读根文件系统、去除 Linux capabilities；PostgreSQL 网络标为 internal，密码使用 Compose secret。上述是候选文件属性，不能证明线上容器已经如此运行。
- `.gitignore` 排除了本地 `.env`；`git ls-files '*.env*'` 仅返回 `.env.example`。

## 需要改进的点

| 优先级 | 领域 | 代码证据与影响 | 处理与验收 |
| --- | --- | --- | --- |
| P1 | CSRF / 来源 | `apps/api/src/server.ts` 只在请求带 `Origin` 且不匹配时拒绝；无 `Origin` 的变更请求可进入业务，`readJson()` 不要求 JSON Content-Type，也无独立 CSRF 头。`SameSite=Lax` 是缓解，但不能作为所有场景的唯一保障。登录、登出、项目、素材、计费确认均应统一受保护。 | 服务端对所有有状态变更请求要求自定义 `X-AVS-Request: 1`，拒绝跨站 `Origin` / `Sec-Fetch-Site`，严格处理生产 CORS 与预检；Web、桌面、移动同步添加该头。未带头、恶意 Origin、`Sec-Fetch-Site: cross-site` 返回 403；合法三端成功。 |
| P1 | 移动会话传输 | `apps/mobile/src/session.ts` 接受任意远程 `http://`，`apps/mobile/src/api.ts` 随后会把登录 Cookie 和密码发往该地址。SecureStore 保护的是本机静态存储，不能保护明文传输。 | 生产构建只接受 HTTPS；本机开发 HTTP 只能通过显式开发配置限定地址。对远程 HTTP 输入阻断并清理旧会话；补登录和上传测试。 |
| P1 | 桌面文件边界 | `apps/desktop/src-tauri/src/lib.rs` 公开 `create/open/save/import/export/cloud_download` 等原生命令；多处命令直接接受 WebView 提供的 `root: PathBuf`。`media.rs` 导入时未证明源文件由原生选择器授权，写入目录可跟随符号链接；`cloud.rs` 下载的 `media/cloud`、`export.rs` 的 `exports` 也未在最终写入前验证目录仍在项目根内。`project.rs` 只校验相对路径组件。若 WebView 被注入或恶意项目目录含链接，可能扩大本机文件访问范围；需要用定向测试确定可利用性。 | 原生层持有当前项目句柄和选择器授权记录；每次命令在 Rust 侧 canonicalize 并校验根、来源和目标，写文件用不跟随链接的安全打开方式，拒绝链接目录和越界路径。负例测试覆盖伪造 root、`media/source`、`media/cloud`、`exports` 符号链接及项目 JSON 链接；正常导入/导出仍通过。 |
| P1 | 鉴权抗滥用 | `apps/api/src/server.ts` 登录/注册限流只按 `req.socket.remoteAddress` 的单进程 Map。Nginx 代理下可能把所有用户合成一个地址；重启和多实例也会清零。 | 在可信代理边界规范化真实客户端 IP，组合账号维度限流，限制上传、灵感和昂贵操作的并发/速率，返回稳定 429；测试共享代理地址下不同用户、伪造转发头和重启/多实例策略。 |
| P1 | 上传资源耗尽 | `server.ts` 的 `readBytes()` 将 20 MB 上传整体收进内存；同时请求数无限制，媒体探测再占进程资源。单请求大小限制已存在，但不足以约束并发峰值。 | 流式暂存/限流、请求体超时和解析并发上限；先保留现有 MIME、探测和额度逻辑。测试超限、慢上传、多并发下拒绝与临时文件清理。 |
| P2（PG 切换前） | 数据库最小权限 | 当前 PG `db.ts:createDb()` 在 API 启动时执行 `schema.sql` DDL；Compose 的 `POSTGRES_USER=ai_video_studio` 同时被初始化为库管理员，未体现迁移角色/运行角色分离。连接池只设置连接串和 `max`，TLS、超时与账号权限须由部署实测。 | 迁移脚本专用 DDL 角色；API 只授予必要表/序列 DML 权限；启动仅核对 schema 版本。数据库只在私网，备份及凭据 0600，定期恢复演练；用运行账号尝试 `CREATE/ALTER/DROP` 必须失败。当前线上 SQLite 先核验文件、目录和备份权限，不将 PG 计划当作已上线。 |
| P2 | SQL 占位符适配 | `apps/api/src/db.ts:parameters()` 对 SQL 全文做 `?` 正则替换；现有查询大多为静态参数化 SQL，但将来遇到字符串常量或 PG JSON 操作符会误替换。 | 改为显式 `$1…` 参数或安全的受限转换，并添加含字面问号/JSON 操作符的回归；不将其描述为现有 SQL 注入漏洞。 |
| P2 | 桌面沙箱与发布 | Tauri 能力文件和 CSP 不等于 macOS App Sandbox。当前 `tauri.conf.json` 只有 `signingIdentity: "-"`，未发现 App Sandbox entitlement；任意路径和媒体子进程还未经过沙箱兼容验收。 | 为 macOS 发布构建加入最小 entitlement：App Sandbox、网络客户端、用户选择文件读写；处理跨重启文件访问授权与 FFmpeg 子进程。产物用 `codesign -d --entitlements :-` 验证，再从 DMG 安装并实际导入、打开旧项目、下载、导出。若某一能力不兼容，保留具体失败证据与补救任务，不宣称“已开启沙箱”。 |
| P2 | 浏览器安全头 | Web 源码 `apps/web/index.html` 未设置 CSP；仓库的 `deploy/nginx/ai-video-ip.conf` 候选配置也没有显式安全响应头，但线上本次不可达，不能推断当前线上配置。 | 核验线上 `Content-Security-Policy`、`X-Content-Type-Options`、`Referrer-Policy`、`frame-ancestors` / X-Frame-Options、HSTS（证书及域名条件满足后）；先 Report-Only 观察，再强制。不要对 IP 站点贸然使用含子域的 HSTS。 |
| P2 | 密钥与供应链 | 服务端密钥来自 `/etc/ai-video-studio/api.env`；桌面 `ai/local_config.rs` 仍支持本地 `.env.local` 的 Kling Key。未发现已追踪密钥，但运行时文件权限、镜像/日志/备份和依赖漏洞未实测。 | 保持服务端密钥不下发客户端；桌面 BYOK 仅在用户明确启用时用系统安全存储；增加 secret scan、依赖/镜像扫描、版本化密钥轮换与备份权限核验。 |

## 方案与次序

1. 先做跨端 CSRF 请求头与服务端拒绝策略，后端定义协议、三个客户端同时适配；服务端启用强制校验前确认三端都已更新，避免破坏桌面/移动登录与付费确认。
2. 并行修复移动 HTTPS 和桌面本机文件边界；macOS App Sandbox 作为独立发布门禁，不与 Tauri capability 混为一谈。
3. 后端处理限流与上传资源边界；PG 最小权限随 PG 正式切换前完成，当前线上 SQLite 做独立权限/恢复检查。
4. 线上响应头、密钥、容器与 DB 权限需要具备服务器访问后补实测证据；任何验证都不得打印密钥或提交用户数据。

开发分工和逐项验收见 [前端计划](../superpowers/plans/2026-10-30-security-hardening-frontend.md) 与 [后端计划](../superpowers/plans/2026-10-30-security-hardening-backend.md)。

## 参考标准

- [OWASP CSRF Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html)
- [OWASP File Upload Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html)
- [OWASP HTTP Headers Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/HTTP_Headers_Cheat_Sheet.html)
- [Tauri Capabilities](https://v2.tauri.app/security/capabilities/)
- [Apple App Sandbox / user-selected file access](https://developer.apple.com/documentation/xcode/configuring-the-macos-app-sandbox)
- [PostgreSQL privileges](https://www.postgresql.org/docs/17/ddl-priv.html)
