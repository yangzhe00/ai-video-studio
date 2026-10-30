# AI Video Studio 代码规范

适用范围：本仓库的 `apps/*`、`packages/*`、`plugins/*`、脚本与 Tauri/Rust 代码。本文按 2026-10-29 的实际工作区制定；前端细则见 [front.md](./front.md)，API 与 Rust 细则见 [api.md](./api.md)，架构背景见 [cli_all.md](./cli_all.md)。改动实际架构或开发命令时，同步更新这些文档。

## 1. 以仓库实际技术栈为准

- 使用 `pnpm@10.30.1` workspace；Node.js 开发环境为 24。网页和桌面前端使用 React 19、TypeScript 严格模式、Vite；桌面原生层是 Tauri 2/Rust；移动端是 Expo/React Native。API 是 Node.js/TypeScript。线上 `20261030-official-04` 已使用 PostgreSQL schema 1；当前候选代码要求 schema 3，上线前须按 [升级手册](../../deploy/postgres/schema1-to3.md) 完成迁移和验收。
- 本仓库没有统一采用 React 18、Tailwind CSS、Zustand、Ant Design、React Router、React Query、Axios 或 Storybook。不得因通用模板而强制引入这些技术，也不得编造对应的 lint、type-check、覆盖率或 Storybook 门禁。
- 新依赖需说明现有能力为何不够、会进入哪些客户端包、体积和平台影响；经项目评审后再添加。更新依赖时同步维护 lockfile。

## 2. Monorepo 目录与依赖方向

| 位置 | 职责 |
| --- | --- |
| `apps/web` | 网页入口、同源 API 适配和页面组合。 |
| `apps/desktop`、`apps/desktop/src-tauri` | 桌面入口、Tauri 平台能力、本地媒体与导出。 |
| `apps/mobile` | Expo 原生界面、移动会话和平台适配。 |
| `apps/api` | 鉴权、项目与对象存储、Agent/生成/渲染任务。 |
| `packages/project-schema`、`packages/project-core`、`packages/agent-core` | 项目契约、迁移、纯业务规则与 Agent 计划。 |
| `packages/plugin-sdk`、`plugins/*` | 插件契约与功能模块；应用显式接入。 |
| `packages/platform-ports` | 平台能力的类型接口；实现留在应用。 |
| `packages/design-tokens`、`packages/ui-web`、`packages/components`、`packages/ui-native` | 设计变量、Web/桌面共用界面与原生界面。 |

- 依赖只能沿应用/服务 → 功能或展示层 → 领域规则/契约的方向下沉；具体以各包已声明的依赖为准，不机械套用一个固定的 `contracts → sdk → ui` 链。`project-core → project-schema`、`ui-web → project-core`、`components → ui-web`、多数插件 → `plugin-sdk` 是现有实例。
- **禁止包级循环依赖**，包括测试和开发依赖。新增跨包导入必须在导入方 `package.json` 声明对应 `workspace:*` 依赖，并通过被导入包的公开 `exports` 访问；禁止跨包 `../../` 穿透其他包的 `src`。同包内部也尽量避免互相引用类型形成文件级环。
- 共享领域包不得反向依赖 `apps/*`、React、Tauri、Node 文件系统或服务端密钥。Web/桌面可共享 DOM 组件；移动端只复用平台无关类型、规则和协议，不直接复用 DOM/CSS。
- `pnpm check:boundaries` 目前只检查部分平台/React 引用，**不等于**循环依赖或依赖声明检查通过。依赖现状、已发现的边界例外见 [dependency-audit-2026-10-29.md](./dependency-audit-2026-10-29.md)。

## 3. TypeScript、React 与文件组织

- 保持各包 `tsconfig` 的 `strict: true`；新增代码避免 `any`，外部 JSON、模型结果和持久化数据先视为 `unknown` 并做运行时校验。跨包契约从共享包导出，避免三端复制近似类型。
- 新组件使用函数式组件与 Hooks；组件 Props 采用明确的接口或类型，不使用 `React.FC` 作为默认约定。渲染保持纯粹，订阅、计时器、请求与清理放在事件处理器或 `useEffect` 中，不在渲染过程中执行副作用。
- 新组件文件采用 PascalCase；新工具模块和纯函数文件采用 camelCase，并遵循所在目录的既有命名。跨包公开 API、非直观的状态机及迁移函数写 JSDoc，说明输入、失败和兼容语义；无需给每个简单的内部函数重复注释。
- 通用业务规则放 `packages/project-core` 或对应共享包；应用层只做平台适配。公共 Web/桌面展示组件放 `packages/components` 或 `packages/ui-web`；原生展示放 `packages/ui-native`。避免在应用层复制同一业务算法。
- 当前样式以 CSS 文件和 `packages/design-tokens` 的 `--avs-*` 语义变量为准。共用组件改样式时同时检查网页与桌面、两套主题及窄屏；位置和缩放等运行时数值可使用动态样式。不要因模板要求强制引入 Tailwind 或禁止项目现有 CSS。

## 4. 数据、安全与异步任务

- API 密钥、供应商凭据和 `API_SESSION_SECRET` 只留在服务端环境；不得进入 Git、前端包、日志、项目文档或测试快照。会话使用服务端验证的 HttpOnly Cookie；切换移动端服务器时隔离会话。
- 用户输入、模型输出、上传内容和供应商 URL 都是外部数据：在服务端校验类型、长度、权限和目标；界面显示文本使用安全渲染，不拼接未经处理的 HTML。SQL 使用参数化查询，文件路径和媒体命令在平台边界校验。
- API 请求必须有明确的失败与未知状态，不能静默吞错。付费生成先持久化稳定请求/操作 ID；响应丢失时查询原任务，不能盲目重发付费 POST。项目同步携带资源修订和命令 ID；同资源冲突交给用户处理，不静默覆盖。
- 对象上传、生成结果和渲染结果统一受存储额度约束；原始素材与编辑版本分开保存。数据库迁移应兼容旧项目并提供回滚/备份路径。

## 5. 测试、验证与提交

- 新增或修改有行为的组件、领域规则、API 或同步逻辑时，在相应包添加能验证用户行为与边界的测试；跨端共享改动至少运行受影响包和客户端的测试与构建。仓库目前没有统一覆盖率阈值，不能把“80%”写成已经配置的门禁。
- 本仓库的实际根命令是 `pnpm test`、`pnpm build`、`pnpm check:boundaries`。修改完成后先运行受影响包的测试/构建，再按影响范围运行根命令和 `git diff --check`；报告每项结果。根目录目前没有 `npm run lint`、`npm run type-check` 脚本，不能把未运行的命令写成通过。
- 改 Tauri/Rust 时补跑 `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml`、`cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml`；桌面启动用 `pnpm tauri dev` 验证，`pnpm dev` 只启动 Vite。移动端真机、真实付费生成、部署与安装包验收必须单独报告，不能用模拟测试代替。
- 运行环境若禁止绑定本机端口并出现 `EPERM`，标为环境阻塞，在允许监听的环境复测；不要将其计为产品失败或测试通过。
- 线上部署拓扑、镜像构建、备份和回滚见 [deployment.md](./deployment.md) 与 `deploy/docker/README.md`。上线前确认镜像对应的代码和数据库版本；网页静态文件与 API 的发布状态分别记录。
- 提交前核对工作树，保留其他任务的未提交修改。新提交使用 Conventional Commits 风格，如 `fix(api): ...`；该约定不追溯要求重写历史提交。
