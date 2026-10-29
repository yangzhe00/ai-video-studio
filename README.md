# AI Video Studio

从一句话灵感和一张参考照片出发，创作、编排和剪辑分集视频。

AI Video Studio 是一个正在开发的跨端视频创作项目。网页端用于云端创作与任务管理，macOS 桌面端提供本地素材管理和剪辑能力。人物与动物都可以作为创作主体；示例题材不限制实际用途。

> **在线体验：** [打开网页端](https://39.108.55.176/) · 桌面端可按下文从源码运行。

## 核心流程

1. **提出想法**：输入一句话或关键词，获取三条不同的 5–10 秒单镜头脚本，选中后仍可编辑。此步骤不会消耗视频生成额度。
2. **准备镜头**：选择或创建项目与分集，上传参考照片，确认提示词和生成计划。
3. **生成与编排**：确认后提交视频生成任务，查看进度和结果；在分集画布中按节点组织镜头，并将生成结果加入时间线。
4. **微调与输出**：裁剪视频首尾、添加手工字幕、选择封面；桌面端可在本地开发环境中导出 MP4 和 PNG 封面。

网页端包含首页、创作、画布、结果、资产和项目库。没有打开项目时，各工作区提供独立空状态和创建／选择项目入口。一个画布对应一个分集，画布中的视频节点对应镜头。

## 当前进度

| 能力 | 状态 |
| --- | --- |
| 网页端与 macOS 桌面端 | 网页端已有 HTTPS 体验地址；桌面端可从源码启动，安装包尚未发布 |
| 三条镜头脚本 | 已接入 Cursor Cloud Agent；模型与密钥由服务端配置，不向客户端下发 |
| 云端视频生成 | 已接入可灵任务流程，生成前由用户确认；可灵密钥和任务查询接口已验证，完整视频生成仍待实测 |
| 分集画布、时间线与视频微调 | 已有实现，仍在持续验收和完善 |
| 移动端 | 有 Expo 客户端代码，真机交互尚待验收 |
| 配音与口型同步 | 规划中；当前视频生成路径以无声视频为主 |

桌面端未登录时创建的项目仅保存在本机；登录和关联云端后，才会出现在同一账号的网页项目库中。

## 技术架构

- **网页端**：React 19、TypeScript、Vite，位于 `apps/web`。
- **桌面端**：React、TypeScript、Tauri/Rust，位于 `apps/desktop`。
- **服务端**：Node.js API、SQLite、后台生成与渲染任务，位于 `apps/api`。第三方模型凭证仅保存在服务端。
- **共享能力**：pnpm monorepo 中的项目规则、平台接口、UI 组件与插件，分别位于 `packages/*` 和 `plugins/*`。
- **项目数据**：`@ai-video/project-schema` 使用 Zod 定义“基础 → 片段 → 资产”三层 DSL，并提供旧格式转换。当前 API 可只读投影该 DSL；项目写入仍处于迁移阶段。

架构细节参见 [三层项目 DSL 设计](docs/superpowers/specs/2026-10-28-three-layer-project-dsl-design.md) 与 [插件契约](docs/architecture/plugin-contract.md)。

## 本地运行

开发环境使用 Node.js 24、pnpm 10.30.1；运行桌面端还需要 macOS 与 Rust。安装依赖：

```sh
pnpm install
```

在独立终端启动 API 和网页端：

```sh
API_DATA_DIR=/private/tmp/ai-video-studio-data \
API_SESSION_SECRET=replace-with-at-least-32-random-characters \
API_SECURE_COOKIES=false \
API_ALLOWED_ORIGIN=http://127.0.0.1:1421 \
pnpm --filter @ai-video/api dev

pnpm --filter @ai-video/web dev
```

打开 `http://127.0.0.1:1421`。另开终端运行桌面端：

```sh
pnpm tauri dev
```

默认配置只用于本地功能体验。线上三条脚本由 Cursor Cloud Agent 生成；本地可在 **API 进程**设置 `IDEA_PROVIDER=cursor`、`CURSOR_API_KEY`，并可选填 `IDEA_CURSOR_MODEL`。代码也支持 OpenAI 兼容文字接口和 Codex Agents API 适配器。真实视频生成还需要 `KLING_API_KEY`。配置项见 [`.env.example`](.env.example)。API 不会自动读取 `.env.local`；模型和视频服务密钥只能配置在服务端。

## 部署状态

网页端构建命令是 `pnpm --filter @ai-video/web build`，产物位于 `apps/web/dist`。当前体验站点使用 HTTPS，并将同源的 `/api` 请求代理到独立运行的 API；服务端持久化 `API_DATA_DIR`。文字灵感和视频生成分别需要服务端模型凭据。当前仍是开发体验环境。

## 仓库说明

项目仍在开发中，功能与数据格式可能调整。仓库目前没有选定开源许可证；第三方依赖和媒体工具的发布许可也需在公开分发前核对。
