# 网页部署问题核查与上线预检（2026-10-29）

## 已核实的线上现状

2026-10-29 12:47–12:50（北京时间），`https://39.108.55.176/` 由 nginx 返回生产 HTML，引用带哈希的 `/assets/index-CJpmarSE.js`。该 JS 为 372,981 字节的压缩构建；对应 `.js.map` 返回 404。`/src/main.tsx` 和 `/@vite/client` 返回的是同一份 366 字节的 SPA HTML，**不是** TypeScript 源码或 Vite 开发客户端。`/api/health` 返回 `{"ok":true}`。核查开始时仓库 `apps/web/dist` 的 JS 哈希与线上一致；随后本地继续改动并重建，不能据此认定线上已更新。

浏览器必须下载并运行客户端 JavaScript，用户始终可以在 DevTools 查看或格式化这部分代码，也总能查看页面 DOM、CSS 和网络请求。压缩只能减小产物、提高随手阅读难度，不能保护业务秘密。密钥、付费权限与敏感规则应只留在 API；不能通过增加混淆器来替代服务端校验。仓库已显式声明生产构建 `minify: true`、`sourcemap: false`，并应只发布 `apps/web/dist`，绝不公开工作区、`src` 或 `.env` 文件。

## 灵感服务与 Agent 边界

`packages/agent-core` 当前的 `validated-input` 是视频运行前的确定性校验，不负责写三版创意。三版灵感由 API 的 `apps/api/src/idea-model.ts` 调用 OpenAI Chat Completions 兼容文本服务。收到“灵感服务未配置”说明 API 进程缺少 `IDEA_MODEL_BASE_URL`、`IDEA_MODEL_API_KEY`、`IDEA_MODEL_ID` 中至少一项，或服务地址不合法。单靠前端发布、可灵视频密钥或引入 `agent-core` 不能让三版灵感工作。模型密钥只能从 API 服务进程环境注入；仓库 `.env.example` 只是占位，API 不自动读取 `.env` 文件。配置完成后还需用真实模型请求验证返回恰好三版，不把模拟测试当上线验收。

## API 部署前检查

在**与生产 API 相同的服务器、Node/pnpm 安装及环境变量上下文**运行：

```sh
pnpm install --frozen-lockfile
node scripts/check-api-runtime.mjs
```

脚本只显示缺失的变量名，不打印密钥值；会验证模型地址格式并执行当前平台包里的 `ffprobe -version`。这一步尤其要在 Linux 服务器运行，不能用开发机 macOS 通过来代替。若 `ffprobe` 缺失、不可执行或缺共享库，先恢复对应 Linux 平台包和运行依赖，再重启 API。上传接口使用实际媒体探测；前端应只发原始有效 JPEG/PNG/WebP/MP4 字节及相符的 MIME，服务器继续拒绝伪装或损坏的文件。`ffprobe` 可运行不等于任意用户照片都可识别，仍需拿一张有效照片做实际上传回归，并记录 HTTP 状态与服务端诊断。

部署还需确认 API 环境中持久化 `API_DATA_DIR`，安全提供不少于 32 字符的 `API_SESSION_SECRET`，并使同源 `/api` 和 SSE 指向同一个 API 实例。上线前备份现有数据目录，避免新版本迁移覆盖无法恢复的数据。

## 发布与复查边界

仓库只有 GitHub `origin` 和 Vite 构建命令，尚无自动部署脚本。随后经用户确认，取得并核实了旧“架构”任务已有的手工 SSH 发布入口。该服务器以 `/srv/ai-video-studio/current` 指向 release，systemd `ai-video-studio.service` 运行 API，Nginx 从独立静态目录 `/usr/local/soft/docker/nginx/html/ai-video-studio` 提供网页。API 持久数据在 `/var/lib/ai-video-studio`，环境文件在 `/etc/ai-video-studio/api.env`；本轮未输出或修改任何密钥值。

## 本轮实际发布与回滚点

2026-10-29 13:24–13:33（北京时间），从旧 release `20261029-0305` 独立复制出 `20261029-132415-hotfix`，仅覆盖本轮明确的前端布局/上传请求、后端媒体探测和生产构建文件；未把工作树中并行开发的 DSL 改造一起发布。新 release 的 API TypeScript、网页 TypeScript/Vite 构建、Linux 媒体探测测试 3/3 通过。切换前，旧静态目录保存在 `/srv/ai-video-studio/backups/20261029-132415-hotfix-web`；活动 SQLite 使用在线 backup 保存到同目录的 `20261029-132415-hotfix-db.sqlite`，`PRAGMA integrity_check` 为 `ok`，权限 0600。旧 release 保持完整。激活脚本在 API 健康或新首页检查失败时会自动恢复旧 release 和旧首页。

切换后 `current` 指向新 release，systemd 为 active；公网首页引用新 `index-C6wJpf19.js` 和 `index-DvLBqZAo.css`，JS 返回 200，`.js.map` 返回 404，`/src/main.tsx`、`/@vite/client` 只返回 SPA HTML，`/api/health` 返回 200。隔离 QA 账号经公网 HTTPS 注册 201，有效 64×64 JPEG 上传 `/api/objects` 返回 201（249 字节），未触发付费生成。目标 Linux 服务用户运行的预检确认 `ffprobe` 可执行，但 `IDEA_MODEL_BASE_URL`、`IDEA_MODEL_API_KEY`、`IDEA_MODEL_ID` 仍缺失；本轮没有伪造灵感或写入个人 Codex CLI 凭据，相关方案见 [Codex CLI 灵感服务评估](2026-10-29-codex-cli-idea-service-assessment.md)。

若发现回归，可将 `current` 原子指回 `20261029-0305` 并重启 `ai-video-studio.service`，再从上述静态快照恢复 `index.html`；新旧哈希资产可以共存。数据库备份仅用于数据损坏恢复，普通代码回滚不应覆盖发布后新增的用户数据。
