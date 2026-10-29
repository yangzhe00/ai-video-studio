# 插件与多端边界

当前阶段是可运行的 macOS 应用及共享基础。插件通过构建时静态注册，决定功能入口是否出现；它们不是可从网络安装的第三方插件，也不会动态执行外部代码。

## 目录职责

| 位置 | 放什么 | 不放什么 |
| --- | --- | --- |
| `apps/desktop` | Tauri 适配器、桌面页面、原生调用和 Rust 后端 | 跨端业务规则的唯一副本 |
| `packages/project-core` | `ProjectManifestV2`、镜头草稿、时间线纯函数 | React、Tauri、文件系统调用 |
| `packages/platform-ports` | 项目、媒体、导出、AI 配置的异步接口 | 平台实现 |
| `packages/plugin-sdk` | 插件描述、依赖校验和平台筛选 | 动态加载与运行时下载 |
| `packages/design-tokens` | 颜色、圆角等 CSS 变量 | 页面业务逻辑 |
| `packages/ui-web` | React Web 控件 | Tauri 调用或项目数据变更 |
| `plugins/*` | 功能 ID、平台声明、依赖及面板贡献 | 本地文件路径、密钥、平台实现 |

依赖方向为应用 → 插件 / `ui-web` / `platform-ports` / `project-core`，插件 → `plugin-sdk`。平台无关包和插件不能反向导入桌面应用或 Tauri。`pnpm check:boundaries` 会检查这条规则，`pnpm test` 也会运行检查。

## 新增一个功能

1. 在 `plugins/<id>` 建立 workspace 包，导出符合 `FeaturePlugin` 的静态描述。填写唯一 `id`、`supportedPlatforms`、`requires` 和 `contributes.panels`。
2. 在 `apps/desktop/src/lib/plugins.ts` 的注册表和启用列表中加入该描述。`resolvePlugins` 会检查重复 ID、缺失依赖及循环依赖，并按平台过滤。
3. 在桌面页面里为该功能接入可见入口和面板。当前面板仍由应用显式组合；注册表只负责声明能力和启用状态，不会自动渲染页面。
4. 功能需要本地文件、系统对话框、密钥或导出时，先在 `PlatformPorts` 定义接口，再在桌面适配器实现。需要 Web 或手机端时，分别提供对应适配器，并完成实际验证后再加入 `supportedPlatforms`。
5. 保持现有 `project.json` V2 格式兼容；需要新增持久化字段时，单独设计迁移与回读测试。

例如新增 `transitions`，可以先声明 `{ id: "transitions", supportedPlatforms: ["desktop"], requires: ["timeline"], contributes: { panels: ["timeline"] } }`，然后接通时间线命令和 UI。单独声明插件并不会自动产生转场效果。

## 后续阶段

- 故事板与时间线双视图，以及更完整的界面设计。
- Agent 的工具审批、任务状态与 MCP 桥接。Agent 应调用经过校验的项目命令，不能直接修改任意文件或把密钥交给模型。
- Web 客户端和手机 App。手机端优先预览、轻量修改和任务管理；多轨本地导出仍由桌面负责。
- 语音与口型同步的真实服务调用，以及动态数字费用估算。可灵无声图生视频已通过 `generation` 静态插件启用，原生层持久化任务并直连可灵 API。

除已注明的可灵无声图生视频外，以上后续方向尚未作为当前版本的可用功能。
