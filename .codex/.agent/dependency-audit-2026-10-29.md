# Monorepo 依赖审计（2026-10-29）

## 范围与结论

本次以 `pnpm-workspace.yaml` 下的 23 个 `apps/*`、`packages/*`、`plugins/*` 包为节点，分别检查 `package.json` 的依赖声明与 157 个 JS/TS 源文件的跨包静态导入。Tauri 的单个 Rust crate 不属于 pnpm 包图。

**目前没有包级循环依赖。** 生产依赖有 47 条 workspace 边；把开发依赖、peer 依赖一起纳入后仍无循环。源码导入图也没有包级环。不过 `project-core` 内部存在一个**含类型导入的文件级环**，运行时值导入不构成环。`pnpm check:boundaries` 当前通过，但并不检查循环或所有跨包导入。

## 已声明的包依赖

箭头表示“左侧依赖右侧”；表内省略外部 npm 依赖。

| 包 | 直接 workspace 依赖 |
| --- | --- |
| `@ai-video/project-schema`、`agent-core`、`plugin-sdk`、`design-tokens`、`ui-native` | 无 |
| `@ai-video/project-core` | `project-schema` |
| `@ai-video/platform-ports`、`ui-web` | `project-core` |
| `@ai-video/components` | `ui-web` |
| `@ai-video/plugin-canvas` | `plugin-sdk`、`project-core`、`ui-web` |
| `@ai-video/plugin-captions`、`cover`、`export`、`generation`、`media`、`publishing`、`storyboard`、`timeline`、`video-edit` | 各自依赖 `plugin-sdk` |
| `@ai-video/api` | `agent-core`、`plugin-video-edit`、`project-core` |
| `@ai-video/mobile` | `plugin-sdk`、`project-core`、`plugin-video-edit`、`ui-native` |
| `@ai-video/web` | `agent-core`、`components`、`design-tokens`、`plugin-canvas`、`plugin-video-edit`、`plugin-sdk`、`project-core`、`ui-web` |
| `@ai-video/desktop` | `components`、`design-tokens`、`platform-ports`、`plugin-sdk`、`project-core`、`ui-web`、`plugin-canvas`、`plugin-captions`、`plugin-cover`、`plugin-export`、`plugin-generation`、`plugin-media`、`plugin-publishing`、`plugin-storyboard`、`plugin-timeline`、`plugin-video-edit` |

主要传递链：`desktop/web → components → ui-web → project-core → project-schema`；`desktop/web → plugin-canvas → ui-web/project-core/plugin-sdk`；`api → project-core → project-schema`。`plugin-sdk` 和 `project-schema` 都是底层节点，二者之间没有固定的依赖顺序。

## 发现的边界问题

1. **API 绕过包公开入口。** `apps/api/src/briefs.ts`、`cloud-document.ts`、`sync.ts` 各有对 `../../../packages/project-core/src/brief.ts` 的相对路径导入，合计 6 条导入语句。`CreationBrief`、`creationBriefs`、`validateCreationBrief` 已由 `@ai-video/project-core` 的公开入口导出；后续修改时应改用包名导入。
2. **网页测试直接依赖移动端源码。** `apps/web/src/mobile-session.test.ts` 与 `mobile-sync-command.test.ts` 分别导入 `../../mobile/src/session`、`../../mobile/src/sync-command`。这两条边使“全源码图”额外出现 `web → mobile`，但它不是正式包依赖，也没有在 `apps/web/package.json` 声明。建议把测试移到 `apps/mobile`，或将纯逻辑抽到共享包再分别测试；避免用测试跨应用穿透源码。
3. **文件级类型环。** `packages/project-core/src/project.ts` 类型导入 `studio.ts`；`studio.ts` 值导入 `canvas-extension.ts`；`canvas-extension.ts` 类型导入 `project.ts`，且类型导入 `studio.ts`。由于闭环中的回边都是 `import type`，当前没有运行时初始化循环，但类型结构耦合较紧。若后续引入值级相互引用，应先抽出共享类型或调整模块边界。
4. **现有边界检查覆盖不足。** `scripts/check-boundaries.mjs` 主要扫描部分目录的 React、Node、Tauri 引用；它未建立 workspace 包图、未检测循环、未核对导入与 `package.json` 声明，也未发现以上跨包相对路径。其绿色结果只能证明现有规则通过。将来若扩充 CI，优先复用 Node 脚本读取 manifest 和源码导入图；无需仅为本次审计立即增加 `madge` 或 `dependency-cruiser` 依赖。

## 检查方式与限制

- 已读取全部 23 个 workspace `package.json`，对生产依赖与所有声明依赖分别做有向环检查：均为 0 个包级环。
- 已扫描 157 个 JS/TS 文件，发现 141 条跨包导入语句、48 种源码跨包关系；其中唯一未在生产依赖声明中的关系是上述测试专用 `web → mobile`。排除测试的 112 个生产文件后，文件级导入图有上述一组含类型导入的环。
- `pnpm check:boundaries` 输出 `Workspace boundaries: OK`。本次是依赖审计和规范整理，没有修改业务代码，也没有把该命令当作完整的类型、单测或运行验收。
