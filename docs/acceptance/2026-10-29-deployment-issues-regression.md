# 部署后四项问题排查与回归（2026-10-29）

本报告区分线上已观察事实、本地修复版回归和仍待线上验收的配置。测试使用隔离账号、测试 JPEG 和本地模拟灵感模型；未调用真实视频生成服务，也未修改业务代码。

## 问题归属

| 用户报告 | 排查结论 | 本轮处理 |
| --- | --- | --- |
| DevTools 能看到“源码” | 线上 HTML 加载带哈希的生产 JS `index-CJpmarSE.js`，约 373 KB、8 行压缩代码；对应 `.js.map` 为 404，`/src/main.tsx` 与 `/@vite/client` 返回 SPA HTML。Elements 面板能查看 DOM，浏览器端 JS 也始终可被查看，不能把代码当秘密保存。 | 架构层在 `apps/web/vite.config.ts` 显式锁定压缩和不生成 source map，补部署预检。修复版本地构建为 `index-C6wJpf19.js`，无 `.map`。 |
| “今天想拍什么”布局空出右半幅 | 前端首页无右侧卡片时仍使用两列网格。 | 无右侧内容时改为单列、居中且自适应；[修复后首页](evidence/2026-10-29/web-home-after.jpg)。 |
| 灵感服务未配置 | API 的 `IDEA_MODEL_BASE_URL`、`IDEA_MODEL_API_KEY`、`IDEA_MODEL_ID` 缺少任意一项会主动返回 `not_configured`。文字模型适配器已存在；视频 `agent-core` 未负责三版灵感。既有线上发布记录只写了会话配置，Linux 运行预检确认三项全缺。 | 前端增加明确重试/手写入口并保留已输入文字；[缺配置界面](evidence/2026-10-29/web-ideas-unconfigured.jpg)。本地模拟模型可成功返回三版；[成功界面](evidence/2026-10-29/web-ideas-ready.jpg)。真实线上三版生成仍需服务端模型凭据与一次真实调用验收。 |
| 上传照片报“无法识别媒体内容” | 精确文案来自后端 `ffprobe` 捕获兜底，不能仅凭该提示断定照片损坏。用户未提供原图；本轮有效 JPEG 在隔离 API 和公网 API 上都上传成功。线上 Linux 探测器预检已通过，但原照片当时报错的具体原因仍未知。 | 后端将探测器故障单独标为 503，损坏媒体保持 400/415；前端限制 JPEG/PNG 与空文件并给出具体建议。本地有效 JPEG 上传、自动选中、生成前计划成功；[上传与计划截图](evidence/2026-10-29/web-upload-plan.jpg)。 |

## 独立回归

- 本地浏览器：注册隔离账号 → 输入一句想法 → 模拟模型返回恰好三版 → 选一版 → 新建项目 → 上传有效 64×64 JPEG → 进入生成前镜头计划，状态为“等待确认”，未提交真实视频任务。刷新后照片和同一任务 ID 仍在。
- 故障路径：同一隔离 API 以缺失模型配置重启 → 新一轮灵感显示失败及“重新获取灵感 / 手写提示词继续” → 手写入口把原文带入生成页面。重新获取会明确发起新一轮；不会把旧成功结果当成当前新想法。
- 自动检查：API 37/37、Web 19/19、UI Web 14/14、组件 3/3 通过；Web `tsc` 与 Vite 生产构建、API `tsc`、依赖边界与 `git diff --check` 通过。[API 测试](evidence/2026-10-29/apps-api-test.log)、[Web 测试](evidence/2026-10-29/apps-web-test-jsdom.log)、[UI 测试](evidence/2026-10-29/packages-ui-web-test-jsdom.log)、[组件测试](evidence/2026-10-29/packages-components-test-jsdom.log)、[构建](evidence/2026-10-29/web-build.log)。

## 线上发布验收

架构任务的既有发布记录显示：Nginx 承载静态文件，systemd 承载 API，持久数据库独立于 release。13:33 左右已切换到独立 release `20261029-132415-hotfix`，旧站和 SQLite 已备份。测试侧随后独立读取公网首页，确认引用 `index-C6wJpf19.js` 与 `index-DvLBqZAo.css`；`/api/health` 返回 `{"ok":true}`，JS source map 为 404，`/src/main.tsx` 返回 HTML 而非源码。刷新用户现有 Chrome 页后，新版布局和“重新获取灵感 / 手写提示词继续”入口可见。架构侧用隔离账号通过 HTTPS 注册 201、有效 64×64 JPEG 上传 201，未触发视频生成。截图在本轮反馈中展示，未将包含真实账号邮箱的浏览器截图提交到仓库。

**尚未通过：线上三版灵感真实生成。** API 环境缺少 `IDEA_MODEL_BASE_URL`、`IDEA_MODEL_API_KEY`、`IDEA_MODEL_ID`。本地模拟模型三版成功只证明调用链与界面；线上没有真实模型凭据，不应宣称恢复。架构已完成 [Codex CLI 接入评估](../architecture/2026-10-29-codex-cli-idea-service-assessment.md)：建议为当前公开站点配置独立的服务端文本模型凭据，不复用个人 Codex 登录；配置后还需真实调用和预算/并发门禁验收。用户原照片未提供，因此只验收了测试 JPEG，不能推断原文件已能通过。

## 2026-10-30 当前公网版本补测

10 月 30 日正式发布已将官网放到 `/`、创作应用放到 `/studio/`，API 切至 PostgreSQL；上文的 10 月 29 日静态哈希和截图只对应当时的发布。测试侧再次只读检查 `https://39.108.55.176/studio/`：HTML 返回 200，加载 `/studio/assets/index-CQKuQP2v.js`（407,633 字节、9 行压缩产物，SHA-256 `59b12673f9bab022b06df49e8b505d3f2f1facc9a6068db5a87b859d2d061e14`）；同名 `.js.map` 返回 404，`/studio/src/main.tsx` 与 `/@vite/client` 返回 HTML，`/api/health` 返回 200。

使用全新隔离 QA 账号，经公网同源 API 注册返回 201，上传仓库测试图 `test-reference.png` 返回 201；该图为有效 512×512 PNG、3,317 字节、SHA-256 `a0c5e6717be433ad5d9cda5517ee36403a390a8d5d54a0fbd5f8c2795df8ff9d`，返回素材 MIME `image/png`、大小 3,317 字节并生成素材 ID。没有上传用户原始失败照片，没有触发视频生成。

正式发布后的真实三版灵感调用由[官网独立测试记录](2026-10-30-official-website.md)记录：创建 HTTP 201，最终 `failed/provider_error`、0 版；[脱敏 API 证据](evidence/2026-10-30-official-website/qa-public-idea-flow.json)。这证明功能仍未通过，且错误已由最初的 `not_configured` 变为供应商调用错误，不能再用“缺少 `IDEA_MODEL_*`”概括当前线上状态。架构对 Codex CLI 的评估仍适用：个人 Codex CLI 会话不适合作为公网共享的灵感服务凭据。

当前版本的浏览器操作截图未重新采集；[10 月 30 日 Docker 阶段的首页](evidence/2026-10-30-docker/online-home.png)、[灵感失败界面](evidence/2026-10-30-docker/online-idea-failure.png)及[照片上传界面](evidence/2026-10-30-docker/online-upload.png)只能证明该阶段的实际页面。当前 PostgreSQL 版本的上传结论是 API 层 201，不能据此宣称浏览器端全流程已复测通过。
