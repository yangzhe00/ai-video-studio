# Official Website Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 `https://39.108.55.176/` 展示 AI Video Studio 官网，并把最新版网页创作应用稳定放到 `/studio/`，以真实版本清单提供 macOS DMG 下载。

**Architecture:** 官网是独立静态站点，不依赖 API 才能显示；创作应用继续同源访问 `/api/`。Nginx 分别路由 `/` 官网、`/studio/` 应用、`/downloads/` 版本化文件；下载清单由已验收的 DMG 发布流程提供。

**Tech Stack:** HTML/CSS/TypeScript、Vite、现有 React/Vite 网页应用、Nginx。

**Spec:** `docs/product/2026-10-30-official-website-prd.md`、`docs/superpowers/specs/2026-10-30-official-website-design.md`

## Global Constraints

- 用户已选择官网 `/`、最新版创作 `/studio/`、同源 `/api/`、现有 HTTPS IP。
- 官网只陈述有证据的能力；三版文字灵感上线前必须完成公网真实调用验收，未通过则修改主卖点文案。
- 只发布通过安装启动验证的 Apple Silicon DMG；没有 Developer ID 时标记未经 Apple 公证的测试版，链接 Apple 官方允许打开说明。
- 下载按钮不能指向本地 `target/`、不存在的文件或 HTML SPA fallback。
- 保留当前脏工作区其他任务改动；只提交本计划范围的文件，且发布需与 PostgreSQL/DMG 计划门禁联动。

## Review Focus

1. 手机/窄屏：390×844 无水平滚动，菜单可开关且 Escape 后焦点回到按钮；Task 1 的浏览器测试。
2. 没有下载清单、清单损坏或文件缺失：下载区显示不可用，不能出现能点击的坏链接；Task 2/3 测试。
3. `/studio/` 直接访问、刷新与深路径：加载应用资源而不是官网/404，`/api/` 仍同源；Task 3/4 测试。
4. `/downloads/missing.dmg`：返回真实 404，绝不返回官网 HTML；Task 4 公网测试。
5. 下载中断/Range：响应 206 与正确字节区间，最终哈希等于清单；Task 4 公网测试。

---

## File map

| 文件 | 职责 |
| --- | --- |
| `apps/website/index.html`、`src/styles.css`、`src/main.ts` | 独立官网内容、响应式布局、菜单/FAQ/复制哈希交互。 |
| `apps/website/src/release.ts` | 解析 `/downloads/latest.json`，拒绝缺字段或错误平台，生成唯一下载 URL 与展示数据。 |
| `apps/website/src/*.test.ts` | 站点交互与清单解析的聚焦测试。 |
| `apps/website/package.json`、`vite.config.ts`、`tsconfig.json` | 独立 `dev/build/test` 命令与输出目录。 |
| `apps/web/vite.config.ts` | 生产构建的 `/studio/` base，开发本地维持 `/`。 |
| `deploy/nginx/ai-video-ip.conf` | 版本控制的四条路由、缓存与 404 规则。 |
| `deploy/site/verify-routes.mjs` | 对指定基址检查 HTML、API、下载响应与哈希，不写服务器。 |

### Task 1: 官网语义内容与响应式布局

**Files:** 创建 `apps/website` 的 HTML、CSS、TypeScript、配置和聚焦测试；新增包并维护 lockfile。

**Interfaces:** 静态锚点 `#features/#workflow/#download/#faq`；网页版 CTA 统一 `/studio/`；首屏下载 CTA 统一 `#download`。下载卡由 Task 2 的 `loadRelease` 提供，缺清单时保持禁用。

- [ ] 用真实项目截图和自有 CSS/SVG 分镜图形实现 PRD W0–W5；不复制可灵素材、文案或布局细节。
- [ ] 写 DOM 测试：两主行动目的地、菜单/FAQ/图片放大层的键盘操作、哈希复制反馈、缺清单时禁用下载。
- [ ] 运行 `pnpm --filter @ai-video/website test` 与 `pnpm --filter @ai-video/website build`，应全部通过且 `dist/index.html` 无服务端密钥。
- [ ] 在 1280×720 与 390×844 预览截图中核对首屏与文字可读性，修复实际发现的问题。

### Task 2: 不可变下载清单与异常状态

**Files:** 创建 `apps/website/src/release.ts`、测试；定义 `deploy/site/download-manifest.schema.json` 或等价类型。

**Interfaces:** `ReleaseInfo = { version: string; platform: "macos-arm64"; filename: string; bytes: number; sha256: string; publishedAt: string }`；`loadRelease(base = "/downloads/latest.json"): Promise<ReleaseInfo | null>`；文件名只允许 `AI-Video-Studio-<version>-macos-arm64.dmg`，URL 使用同源 `/downloads/`。

- [ ] 测试合法清单可显示版本/大小/完整哈希/下载链接；缺失、非 2xx、字段不全、文件名带路径或哈希非 64 位十六进制均不产生可点击链接。
- [ ] 实现安全解析与失败状态；复制哈希失败时显示手动复制提示，不静默失败。
- [ ] 聚焦测试与构建通过；实际 DMG 清单由 [DMG 发布计划](2026-10-30-macos-dmg-release.md)在发布门禁后生成，开发期用 fixture 不冒充已发布包。

### Task 3: 网页应用 `/studio/` 构建

**Files:** 修改 `apps/web/vite.config.ts`、必要的 Web 静态资源引用及测试。

**Interfaces:** 生产构建命令 `pnpm --filter @ai-video/web build` 以 `VITE_APP_BASE=/studio/` 产生 `/studio/assets/*` 路径；本地开发仍可从 `/` 使用；同源 API 保持 `/api`。

- [ ] 写构建检查：生产 `dist/index.html` 的脚本和 CSS 均从 `/studio/assets/` 加载，源码中的 `/api` 不被改写为 `/studio/api`。
- [ ] 配置 Vite base，修复硬编码根路径的静态素材/导航；不修改业务状态机。
- [ ] 运行 Web 全包测试、构建及上述构建检查；在本地模拟 `/studio/` 直接打开与刷新。

### Task 4: Nginx 路由和发布验证脚本

**Files:** 创建 `deploy/nginx/ai-video-ip.conf`、`deploy/site/verify-routes.mjs`；更新部署文档。

**Interfaces:** `/api/` 仍代理 `172.23.0.1:8787`；`/studio/` fallback 到应用 index；`/downloads/` 只返回已存在静态文件并允许 Range；`/` fallback 官网 index；下载不存在返回 404。官网资源与应用资源分目录，不互相覆写。

- [ ] 使用与线上 Nginx 版本兼容的配置写四条路由，明确静态根、缓存、DMG MIME 和 `Content-Disposition`；保留已有 HTTPS 与证书路径。
- [ ] 在隔离 Nginx 容器/测试配置运行 `nginx -t` 并用 HTTP 检查上述路由，缺失 DMG 不能返回 HTML。
- [ ] 验证脚本只读检查线上根页、`/studio/`、`/api/health`、下载头、Range 与 SHA-256；缺任一项返回非零退出码。
- [ ] 更新 `.codex/.agent/deployment.md` 的新拓扑、备份和回滚路径；不把旧 SQLite 回滚脚本误用在 PostgreSQL 版本。

### Task 5: 联合发布与独立验收

**Files:** 创建 `docs/acceptance/2026-10-30-official-website.md`、`docs/acceptance/evidence/2026-10-30-official-website/`。

- [ ] 先完成 [PostgreSQL 上线计划](2026-10-30-postgres-production-cutover.md)与 [DMG 发布计划](2026-10-30-macos-dmg-release.md) 的门禁，获得实际下载清单和可用 API。
- [ ] 备份线上静态目录和 Nginx 配置；先上传新目录和 DMG，最后原子切换官网/Nginx。切换前验证配置，切换后运行 `verify-routes`。
- [ ] 测试按 PRD O01–O10 在本地和公网实测，保存桌面/窄屏/下载/安装截图、HTTP 与哈希证据；真实三版 Agent 可用性单列。
- [ ] 测试完成后做代码审查；修复发现后复测并更新报告。若发布门禁失败，维持旧站可用并记录阻断，不展示坏下载按钮。

## Self-review

PRD W0–W5 对应 Task 1–2；`/studio/` 与 `/api/` 对应 Task 3–4；下载、异常、安装与公网证据对应 Task 2/4/5 及 DMG 计划。当前线上 SQLite→PostgreSQL 与文字服务失败不是静态站任务，已作为 Task 5 的明确前置，不能被“页面构建通过”代替。
