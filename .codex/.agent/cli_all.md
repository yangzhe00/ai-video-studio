# AI Video Studio 项目架构规范

> 适用范围：本仓库的所有应用、共享包、插件、API 和部署脚本。依据 2026-10-29 的本地工作树整理，供 CLI 开发与架构评审使用。本文描述**现行约束**和**明确的迁移边界**；设计稿中的目标能力不能当作已经上线。前端细则见同目录的 `front.md`。

## 1. 产品主链路与系统边界

产品从一句话或关键词和参考照片开始，支持人物与动物题材：

```text
关键词 → 三条 5–10 秒单镜头脚本 → 选择/编辑 → 选择项目与分集、上传照片
       → 检查计划并显式确认 → 后台图生视频 → 结果资产 → 分集画布/时间线 → 微调与输出
```

- 三条脚本是**文字灵感**，归属于账号；选择脚本不会创建视频任务或消耗视频生成额度。线上灵感服务使用 Cursor Cloud Agent，代码还保留其他文字模型适配器。
- 画布与视频生成不是同一个自动执行器。一张画布对应一个分集，视频节点表达镜头意图，用户逐节点启动；生成结果由用户加入整集时间线。
- 可灵无声图生视频需要用户确认和服务端凭据。密钥鉴权及任务查询通过不等于完成真实视频生成；没有端到端证据时不得标记为已验收。
- 网页和桌面是当前主要交互端；移动端有 Expo 代码，真机交互仍需验收。画布只接入网页和桌面，移动端复用领域规则与任务协议。

## 2. 仓库分层与依赖方向

仓库使用 `pnpm@10.30.1` workspace，根 `pnpm-workspace.yaml` 收纳 `apps/*`、`packages/*`、`plugins/*`。

| 层 | 目录 | 责任 |
| --- | --- | --- |
| 应用入口 | `apps/web` | React 19、TypeScript、Vite；网页路由、会话、同源 `/api` 适配与页面组合。 |
| 应用入口 | `apps/desktop` | React、Tauri/Rust；本地项目、媒体文件、桌面能力、云端适配和导出。 |
| 应用入口 | `apps/mobile` | Expo/React Native；原生界面、移动会话和轻量任务操作。 |
| 云端服务 | `apps/api` | Node.js HTTP API、账号与项目授权、对象存储、Agent/生成/渲染 worker；线上 `20261030-official-04` 使用 PostgreSQL schema 1，当前候选要求 schema 3。 |
| HTTP 协议 | `packages/api-contracts` | 服务端与 Web、桌面、移动共用的请求、响应和错误码 Schema。 |
| 领域契约 | `packages/project-schema` | Zod 三层项目 DSL、跨层校验、版本声明。 |
| 领域规则 | `packages/project-core`、`packages/agent-core` | 本地/云端旧格式、迁移、同步命令、时间线规则、Agent 计划与状态类型。 |
| 平台接口 | `packages/platform-ports` | 本地文件、媒体、导出等能力的接口；实现放在各应用。 |
| 展示层 | `packages/components`、`packages/ui-web`、`packages/ui-native`、`packages/design-tokens` | 共享页面、Web 控件、原生展示层和语义设计变量。 |
| 功能模块 | `packages/plugin-sdk`、`plugins/*` | 静态功能声明及画布、生成、剪辑等功能实现。 |

依赖应从应用/服务指向共享契约和功能模块；共享领域包不得反向依赖应用、Tauri、Node 文件系统或 React。跨包使用 workspace 包名及公开 `exports`，不从其他包的 `src` 深层相对导入。UI 组件通过类型化数据和回调接收能力，不直接持有服务端凭据或平台 I/O。`pnpm check:boundaries` 是现有自动边界检查；它未覆盖的跨包导入也必须按本规范评审。

插件由 `FeaturePlugin` 声明唯一 ID、版本、支持平台、依赖和贡献能力，构建时静态注册。注册表只声明能力，不会自动生成页面，也不是可在线安装或动态执行代码的插件市场。新功能要同时接通应用入口、平台适配、数据命令和测试；不能只增加描述对象。

## 3. 三层项目 DSL：基础 → 片段 → 资产

`@ai-video/project-schema` 是目标项目语义的唯一结构定义；`schema: "ai-video/project"` 与 `dslVersion: 1` 必须同时识别，不能把本地 `ProjectManifestV2.version` 或旧云文档版本混为 DSL 版本。

| 层 | 主要对象 | 规则 |
| --- | --- | --- |
| 基础 | `VideoProject`、元数据、画幅/渲染配置、人物、分集 | 项目拥有分集；一分集拥有自己的场景、轨道和封面。 |
| 片段 | `Scene`、`TimelineTrack`、`TimelineClip` | 场景是稳定的镜头意图；片段存位置、裁剪和音量，只通过稳定资产 ID 引用资产。 |
| 资产 | 照片、视频、配音、音乐、字幕、缩略图 | 资产在项目级管理，可跨分集复用；产物和微调版本追加新资产，不覆写原件。 |

必须保持以下不变量：

1. 项目内 ID 稳定且唯一。排序、同步、迁移、编辑和导出不得重建已有 `episodeId`、`sceneId`、`clipId`、`assetId`。`runId` 是运行身份，不等于新场景 ID。
2. 片段只引用存在且类型匹配的资产；图片参考必须引用图片，视频片段必须引用视频。跨层引用、来源链、轨道类型和同一视觉轨重叠由 Zod 校验器验证。
3. 时间统一用非负安全整数毫秒，区间按 `[start, end)` 理解；裁剪保持 `0 <= inMs < outMs`。现行 DSL 音量范围为 `[0, 2]`，迁移时不得静默压到 1。
4. `Scene.outputAssetIds` 保存成功产物的版本顺序，`selectedAssetId` 只能选其中一项。生成新版本或微调后，既有时间线 `clip.assetId` 不自动改指向新资产。
5. DSL 保存逻辑引用，不保存媒体二进制、桌面绝对路径、云端裸 `objectId`、短期 URL、密钥、任务状态或费用。资产 ID 到本地路径/云对象的绑定由对应适配层维护。
6. `extensions.canvas` 由画布插件拥有；关闭插件、移动端读取或旧格式迁移时保留未知扩展。当前打开的分集、画布视口等设备偏好不写成跨端项目事实。
7. 遇到不支持的更高 DSL 主版本，以只读方式保护原文；改变既有字段语义时升版本并提供迁移。缺失媒体或未知时长应给出待修复状态，不能伪造探测结果。

**当前迁移状态：**本地仍以 `ProjectManifestV2` 写入，云端仍有旧 `CloudProjectDocument` 写入路径；`packages/project-core/src/dsl/*` 提供转换，API 的 `GET /projects/:id/dsl` 目前是只读投影。不得假设 `/v2/projects` 或完整 DSL 写入已可用。切换权威写格式时先备份原文、保持旧数据可读，升级服务端读写与生成/渲染 worker，再逐端切换；同一个项目同一时刻只能有一个权威写格式。详情见 `docs/superpowers/specs/2026-10-28-three-layer-project-dsl-design.md`。

## 4. 云端账号、项目同步与任务账本

- 云端以账号和项目归属为授权边界。会话由服务端验证，项目、素材、运行、事件和编辑结果每次读取或修改都校验所有权；客户端传入的 ID 不是权限证明。
- `projects` 保存项目文档，`objects` 保存不可变媒体对象元数据；媒体文件由服务端数据目录管理。上传前校验实际格式、大小和账户/平台容量，不能只信浏览器 MIME。
- 资源同步使用 `resource_revisions` 和 `project_commands`。写入携带稳定命令 ID 与基础修订号；同命令重试复用结果，修订冲突交给用户逐项处理，不自动覆盖、静默合并或让整份 JSON 的最后写入者获胜。
- 桌面离线项目原文件不因关联云端被替换。迁移与首次上云先备份，再保留素材映射、片段 ID、排序、裁剪、音量和未知扩展；失败时保留原项目并给出可修复的错误。
- 一次视频生成的用户意图、外部付费操作和进度事件分别由 `agent_runs`、`operations`、`run_events` 持久化。客户端请求 ID、确认 ID、外部任务 ID 各有用途，不能互换。先落库并原子预留额度，再由 worker 发起一次供应商提交；响应不明进入 `unknown` 并查询原任务，不能盲目再次 POST。
- 运行进度用持久事件序号支持 SSE 重放；客户端刷新或重连时先取任务快照，再从已见序号继续。断线不能创建第二次视频任务。视频微调使用独立的编辑配方、命令和渲染操作账本，保留原片与历史版本。
- 三条文字脚本由 `prompt_idea_sets` 管理，与付费视频操作分离。选择/编辑后的文本须保留来源；重新获取灵感是新请求，恢复旧请求应查询原记录。

线上 API 已使用 PostgreSQL schema 1，当前候选的配音、混音预览和 Agent 剪辑新增表要求 schema 3；生产升级见 `deploy/postgres/schema1-to3.md`。现网仍是单 API 实例，worker 与部分限流仍在进程内。多实例、复杂逐节点 Agent 或更高吞吐需要另行验证共享存储、跨实例限流和任务调度；不要把设计稿里的 `agent_steps` 或多操作运行当作已上线能力。

## 5. 模型、可灵与安全配置

- 文字灵感的服务端适配器由 `IDEA_PROVIDER=chat|agents|cursor` 选择；线上当前选择 Cursor。选择不同提供方须验证接口协议、模型 ID、返回结构、超时恢复和账号配额，不能仅替换 model 名与 API Key。
- 可灵图生视频通过 `GenerationWorker` 和 `KlingGateway` 调用；只有 API 进程配置 `KLING_API_KEY` 时才创建视频 worker。任何供应商提交都必须经过项目授权、输入校验、用户确认和持久操作账本。
- `CURSOR_API_KEY`、`OPENAI_API_KEY`、`KLING_API_KEY`、`API_SESSION_SECRET` 等只进入 API 进程秘密配置。不得写入项目 DSL、客户端构建、日志、错误响应、测试快照或 Git；`.env.example` 只放占位值。
- Cookie、CORS、请求体和上传限额以 `apps/api/src/config.ts` 和 `server.ts` 为准。新增接口必须定义输入校验、错误码、所有权检查、幂等语义及恢复路径。
- 模型结果只作为待校验数据；不能让模型直接写数据库、执行任意文件操作、自动批准付费请求或绕过项目命令。

## 6. 客户端与用户体验边界

- 网页经 `apps/web/src/api.ts` 访问同源 `/api`；桌面云端请求经 `apps/desktop/src/lib/cloud.ts` 等适配器；移动端使用自己的 API/安全存储适配。共享展示组件不直接发请求。
- 网页与桌面复用业务展示组件和 `--avs-*` 语义设计变量；移动端不复用 DOM/CSS。主题和页面交互细则见 `.codex/.agent/front.md`。
- 首页、创作、画布、结果、资产在没有打开项目时也可进入，但必须显示各自空状态及创建/选择项目入口。付费生成前明确展示计划与确认按钮，不在加载、刷新或切换页面时自动提交。
- 异步 UI 区分等待确认、排队、运行、成功、失败和结果未知；超时不等于任务失败。进度、结果与编辑版本可在重新打开项目后恢复。

## 7. 变更与验收门槛

1. 修改共享契约时先定位受影响的 API、Web、桌面、移动适配和迁移器；更新同一份类型来源，避免三端各自定义相近却不兼容的 DTO。
2. 修改项目格式、数据库或同步协议时提供版本迁移、旧数据回读、失败回滚/备份和冲突测试；不在打开项目时触发生成、扣额度或重写媒体原件。
3. 修改付费操作时验证重复点击、请求超时、服务重启、供应商响应丢失和完成后存储不足；断言同一意图至多一次供应商提交。无真实供应商证据时，只报告模拟测试或只读接口验证。
4. 代码检查使用 `pnpm test`、`pnpm build`、`pnpm check:boundaries` 和 `git diff --check`；Rust/Tauri 变更补跑 `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml` 与实际 `pnpm tauri dev`。沙箱阻止本机端口时，先确认 `EPERM` 是环境限制，再在允许监听的环境复测。
5. 发布网页端前完成构建、API 健康检查、配置与数据库备份；切换后检查网页、登录、文字灵感与任务恢复。源码提交、构建成功和线上发布是三个不同的验收状态，报告时分别写明。
6. 当前线上由 Nginx 容器服务网页静态文件和 HTTPS，单实例 API 使用 Docker Compose。镜像须从明确 release 构建并在 Linux 检查媒体二进制；切换前备份 PostgreSQL 和对象目录，按 schema 1→3 升级手册演练并迁移，切换后检查容器健康、同源 `/api`、注册及有效照片上传。部署命令和回滚见 [deployment.md](./deployment.md)。

## 8. 文档维护原则

`README.md` 负责对外产品介绍和运行入口；`packages/project-schema/README.md` 说明当前 schema；本文件规定跨端架构边界；`front.md` 规定前端实现细节；[deployment.md](./deployment.md) 记录线上部署状态。`docs/superpowers/specs/*` 包含已批准设计及未落地目标，阅读时先看状态和现行代码。架构发生实际变更时，同步更新相关规范与迁移说明，并明确“已实现、已测试、已部署”各自的证据。
