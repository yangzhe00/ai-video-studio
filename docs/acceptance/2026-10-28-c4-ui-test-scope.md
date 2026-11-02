# C4 共用界面测试范围（网页端 / 桌面端）

## 测试基线

- 设计依据：`design/interaction-clickthrough.html` 的 C4 方案。
- 本轮覆盖网页端和桌面端；共用窗口栏、侧栏、首页、结果页和状态面板来自 `packages/components`。生成页来自 `packages/ui-web`，画布仍作为独立插件注入。
- 在 macOS 桌面窗口和 Chrome 网页分别检查 1440 × 900、1280 × 800、900 × 700。另检查系统缩放或浏览器缩放 125%。
- 分别检查浅色 C4 与深色皮肤；窗口栏为 48px，导航和主要按钮可点击，标题、卡片、菜单、弹窗和提示不互相遮挡。

## 功能与状态

| 区域 | 测试点 |
| --- | --- |
| 登录 / 注册（网页端） | 登录、注册切换；邮箱和密码校验；服务端错误；提交中；退出后返回登录页。 |
| 首页 | 无项目入口、新建项目、打开已有项目；最近项目继续创作；切换项目后名称和分集一致。 |
| 生成页 | 无照片空态、上传照片、输入提示词、选择 5/10 秒、提交计划；提交中和运行中状态；任务 ID 可查；失败与未知提交状态。刷新页面后仍恢复原任务，未知状态只查询原任务。 |
| 画布 | 空态、创建参考照片人物、添加文本/图片/视频节点、连接和拖动节点、缩放与平移、逐节点运行、失败后查看原因、加入时间线、导出整集入口。窄窗口下工具栏和节点不得互相覆盖；画布可向任意方向平移。 |
| 结果页 | 无结果、生成中、失败、提交状态未知、视频完成；播放原视频；任务 ID；打开编辑；加入时间线；多个镜头切换。没有剪辑版本时必须明确显示为空，不应呈现虚假的已保存版本。 |
| 共用壳层 | 网页端与桌面端的顶栏、左侧导航、首页和结果页视觉一致；切换皮肤不丢当前页面；桌面原生窗口按钮和拖动区域正常；窄窗口标题与账户按钮不溢出。 |
| 编辑插件 | 已完成视频可进入编辑；首尾时长裁剪、字幕、封面操作；保留原视频；返回结果页后可选择实际保存的版本。 |

## 布局验收

- 检查文字不被卡片盖住，按钮不被顶栏或侧栏挡住，卡片边界不超出可见宽度，弹窗及错误提示可关闭。
- 生成、画布、结果页切换时内容应位于同一主视口；画布节点和连线位置随缩放保持一致。
- 检查键盘焦点可见、Tab 顺序合理、按钮可用键盘触发；打开系统“减少动态效果”后，背景动画不影响操作。
- 桌面端使用实际 Tauri 窗口复核窗口控制与文件选择；网页截图不能替代原生窗口验收。

## 本轮截图证据

- `design/previews/c4-implementation-web-login.png`
- `design/previews/c4-implementation-web-generate.png`
- `design/previews/c4-implementation-web-generate-dark.png`
- `design/previews/c4-implementation-web-home.png`
- `design/previews/c4-implementation-web-canvas.png`
- `design/previews/c4-implementation-web-canvas-node.png`
- `design/previews/c4-implementation-web-canvas-node-narrow.png`
- `design/previews/c4-implementation-web-results-empty.png`
- `design/previews/c4-implementation-web-results-narrow.png`
- `design/previews/c4-implementation-desktop-home.png`
- `design/previews/c4-implementation-metrics.json` 记录主要布局区域的边界和滚动宽度。

截图使用隔离的本地 API 测试项目，没有发起付费视频生成。完成态视频、真实云端失败恢复、编辑保存，以及桌面 Tauri 原生窗口需要测试人员使用受控样例另行验收。

本轮自动检查：`@ai-video/components` 构建与 3 项测试、网页端构建与 11 项测试、桌面端构建与 21 项测试、工作区依赖边界、`git diff --check` 与 Tauri `cargo check` 均通过。`tauri dev` 已编译并启动原生进程。启动日志曾显示确认弹窗缺少权限，已补 `dialog:allow-confirm`，需在实际窗口点击确认流程复验。本次运行环境无法截取该原生窗口；桌面截图为相同前端在浏览器中的实际渲染，原生窗口控件仍需人工验收。

## 移动端复用边界

移动端可直接复用颜色/字号等 token，以及 `@ai-video/components/contracts` 中的页面状态和结果数据模型；目前可视组件由 React DOM 渲染，移动原生界面需由适配层实现，画布不进入移动端。
