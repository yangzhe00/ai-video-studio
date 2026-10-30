# API, Database and Deployment Security Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 统一阻止跨站有状态请求，收紧 API 资源边界，给当前 SQLite 与后续 PostgreSQL 部署建立可验证的最小权限和恢复门禁。

**Architecture:** API 入口集中处理请求来源/安全头，授权与计费逻辑继续由现有服务层负责。部署层只信任指定反向代理，数据库迁移与应用运行账号分离。上线配置与代码测试分别验证，不能由候选 Compose 文件推断线上状态。

**Tech Stack:** Node 24、TypeScript、`@ai-video/api-contracts`、PostgreSQL 17 候选、当前线上 SQLite、Docker Compose、Nginx、Vitest。

**Spec:** [安全检查](../../architecture/2026-10-30-security-audit.md)

## Global Constraints

- 保留已有账号/项目/任务与幂等 request ID；安全拒绝必须发生在扣额度或提交供应商请求之前。
- Web、桌面、移动会话都使用 Cookie；与前端会话协调请求头协议和强制校验启用时间。
- 本计划不执行 PostgreSQL 正式切换；先只准备和验证最小权限，按已有 `deploy/postgres/README.md` 的迁移门禁发布。
- 不在日志、测试快照、文档或命令输出中显示任何真实凭据；保留其他会话的脏工作树。

## Review Focus

1. 不带 Origin 的跨站 form、带错误 Origin 与 `Sec-Fetch-Site: cross-site` 的已登录 POST 均应在副作用前 403；在 Task 1 测试。
2. 登录/登出、`/objects` 二进制上传、`/runs/:id/approve` 也要覆盖安全头；在 Task 1 测试。
3. 代理下 20 个合法用户不应共享单个限流桶；伪造转发头不能绕过；在 Task 2 测试。
4. 多个慢速或超限上传不会持续占用内存/探测槽位或留临时文件；在 Task 3 测试。
5. PG 运行账号不能 DDL，备份可恢复且当前线上 SQLite 不受候选配置影响；在 Task 4 测试。

---

### Task 1: API 入口 CSRF 和来源策略

**Files:** Modify `apps/api/src/server.ts`, `apps/api/src/config.ts`, `apps/api/src/server.test.ts`, `packages/api-contracts/src/index.ts`；必要时新增 `apps/api/src/request-security.ts` 及其测试。

**Interfaces:** 共享协议导出 `AVS_REQUEST_HEADER_NAME = "X-AVS-Request"`、`AVS_REQUEST_HEADER_VALUE = "1"`。`POST|PUT|PATCH|DELETE`（包括登录/注册/登出、二进制上传）必须有该头；带 `Origin` 时与配置的允许源严格相等，`Sec-Fetch-Site: cross-site` 拒绝；OPTIONS 仅对允许源放行并声明 `content-type,x-avs-request`。没有 Origin 的 Tauri/移动原生请求仍需自定义头。生产 `API_ALLOWED_ORIGIN` 和 Secure Cookie 配置做启动校验，避免误配；测试环境用显式配置。

- [ ] 写失败集成测试：缺头、恶意 Origin、跨站 Fetch Metadata、简单 Content-Type form、登录 CSRF、已登录付费批准和合法三端请求；确认拒绝前未创建操作/扣额度。
- [ ] 以统一入口函数实现来源策略，检查时机放在任何鉴权及业务副作用前；CORS `Vary` 和错误响应同样一致。
- [ ] 跑 `pnpm --filter @ai-video/api test` 与 `pnpm --filter @ai-video/api-contracts test`，再与前端会话联调。强制校验上线前确认三端客户端都已适配；旧客户端升级策略明确记录。

### Task 2: 认证和高成本接口的抗滥用

**Files:** Modify `apps/api/src/server.ts`、`apps/api/src/config.ts`；新增 `apps/api/src/rate-limit.ts`/测试；如需持久/跨实例限流，使用现有数据库表或明确说明单实例边界，避免增加不必要依赖。

**Interfaces:** 只信任部署中明确的 Nginx 代理 IP，并由 Nginx 重写而非追加可伪造客户端地址；限流键同时考虑可信客户端 IP 与规范化账号/email。登录、注册、上传、灵感、渲染/生成确认分别设上限，返回 429 和可重试时间。IP/header 解析不暴露个人信息于日志。

- [ ] 写失败测试：反向代理下两账号隔离、伪造 `X-Forwarded-For` 不绕过、单账号爆破、长时间积累不造成 Map 无界增长、额度操作限流无副作用。
- [ ] 实现代理信任策略与有界限流存储；若正式多实例部署，再提供跨实例一致方案。
- [ ] 跑 API 测试并在 Nginx 候选配置核对 `X-Real-IP` / `X-Forwarded-For` 的实际覆盖方式。

### Task 3: 上传与媒体处理资源边界

**Files:** Modify `apps/api/src/server.ts`、`apps/api/src/media-inspect.ts`、`apps/api/src/server.test.ts`，必要时新增 `apps/api/src/upload.ts`。

**Interfaces:** 保持现有 20 MB 上限、MIME/内容探测、对象额度和随机对象名；改为流式暂存、超时、有限并发，HTTP 断开及所有错误清理暂存文件。媒体探测命令设置时长/输出上限。图片/视频文件由服务端生成下载头，不依赖客户端文件名。

- [ ] 写失败测试：超限、错误 MIME、慢上传/断开、多并发、探测失败及配额失败后临时文件清理；正常 JPEG/PNG/WebP/MP4 通过。
- [ ] 实现流式读写和探测并发限制；避免修改对象幂等性和付费任务逻辑。
- [ ] 跑 API 测试；用小规模并发压测记录峰值内存、响应码与目录残留，不对线上直接压测。

### Task 4: 数据库账号、SQL 适配与恢复门禁

**Files:** Modify `apps/api/src/db.ts`、`apps/api/src/db.test.ts`、`deploy/docker/compose.yaml`、`deploy/postgres/{README.md,preflight.sh,verify.sh}`；新增版本化迁移/授权 SQL 文件，必要时测试脚本。

**Interfaces:** PG schema 由迁移账号执行；API 运行账号只拥有必要 DML/序列权限，启动只读检查 schema 版本，不在 API 进程运行 DDL。PG 连接池设置连接/空闲/语句超时，私网连接与 TLS 要求按同机 Docker/远程链路分别定义。SQL 占位符转换不误处理 SQL 字面 `?` 和 PG JSON 操作符。当前线上 SQLite 先验证目录/DB/WAL/备份文件访问权限与恢复，不执行切换。

- [ ] 写失败测试：运行账号执行 `CREATE/ALTER/DROP` 被拒，合法业务查询通过；占位符包含字面问号/JSON 操作符仍正确；schema 版本不符拒绝启动。
- [ ] 拆分迁移与运行凭据、收紧角色与权限；验证候选 PG Docker 网络和密码文件权限；把当前 SQLite 的只读备份与恢复检查写入运维步骤。
- [ ] 运行 `pnpm --filter @ai-video/api test`、PG 隔离库迁移演练及 `deploy/postgres/verify.sh`；保留结果但不打印连接串密钥。正式切换另走维护窗口审批与既有回滚门禁。

### Task 5: Web 入口安全头与密钥/镜像检查

**Files:** Modify `deploy/nginx/ai-video-ip.conf`、对应部署说明/检查脚本，必要时新增 CI 安全扫描配置。

**Interfaces:** 对官网与 `/studio/` 配置经实测可用的 CSP、`nosniff`、Referrer-Policy、frame-ancestors/点击劫持防护；对 `/api` 保持无缓存与正确 Content-Type。HSTS 先核验证书和目标域名/IP 访问策略再启用，不使用未经确认的 `includeSubDomains`。凭据文件和备份权限检查只输出权限/存在性，不输出内容；镜像与依赖扫描保存版本和结果。

- [ ] 写/运行 Nginx `-t` 与响应头脚本，核对 `/`、`/studio/`、API JSON、对象下载及错误页；先 CSP Report-Only 找出合法资源，再转强制策略。
- [ ] 实测部署的容器用户、只读文件系统、端口绑定、数据库暴露面、密钥/备份权限；线上不可达时标记待验证，不声称通过。
- [ ] 对锁文件、镜像、Git 追踪文件做安全扫描，记录命中项和处理；避免把测试密钥误报作泄露。

## 交付证据

每项提供改动、自动化测试命令和退出码、负例结果；部署项再给经过脱敏的实际配置/响应头/权限检查。区分当前线上 SQLite、候选 PostgreSQL 和本地开发进程。
