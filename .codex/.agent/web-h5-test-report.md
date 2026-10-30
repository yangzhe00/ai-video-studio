# Web H5 多机型布局测试报告

日期：2026-10-30。测试对象：本地 Web 开发版，默认 C4 奶油胶片主题；另测一张 C4 青夜主题。浏览器：macOS Headless Chrome 156.0.8078.73，使用设备视口模拟。使用 `h5-visual-check.mjs` 拦截同源 `/api` 并返回固定的测试账号与空项目数据；没有调用真实云端生成，也没有修改用户项目。

## 自动检查结果

| 视口 | 代表机型 | 截图页面 | 页面级横向溢出 | 结论 |
| --- | --- | --- | --- | --- |
| 320×568 | 小屏 iPhone | 登录、首页、生成及三页底部滚动 | 无 | 通过 |
| 375×667 | 传统 iPhone | 登录、首页、生成 | 无 | 通过 |
| 390×844 | 标准 iPhone | 登录、首页、项目库、新建弹窗、生成、结果、资产、画布概览、账号抽屉、深色生成 | 无 | 通过 |
| 412×915 | 大屏 Android | 登录、首页、生成 | 无 | 通过 |
| 640×800 | 手机导航断点 | 登录、首页、生成 | 无 | 通过 |
| 641×900 | 平板导航断点 | 登录、首页、生成、节点画布 | 无 | 通过；窄卡片已改为单列 |
| 768×1024 | 平板竖屏 | 登录、首页、生成、节点画布 | 无 | 通过 |
| 1440×900 | 桌面宽屏 | 登录、首页、生成、节点画布 | 无 | 通过 |

共 37 张截图。所有采样的 `documentElement.scrollWidth` 均等于视口宽度。手机底部导航始终贴合视口底边：320×568 为 `y=509–568`，390×844 为 `y=785–844`。320×568 的登录页内容高 781px、首页滚动区高 1169px、生成滚动区高 1108px；三处均可滚动到底部，登录按钮、首页内容和最近创作卡片可到达。视觉检查未见卡片、标题、弹窗或底部导航相互覆盖。641px 初测发现最近创作三列过窄，已调整为单列并重拍。平板与桌面保留节点画布；手机改为分集概览。

## 截图索引

| 检查点 | 证据 |
| --- | --- |
| 小屏登录首屏与底部按钮 | [首屏](screenshots/iphone-se-login.png) · [底部](screenshots/iphone-se-login-bottom.png) |
| 小屏首页与底部内容 | [首屏](screenshots/iphone-se-home.png) · [底部](screenshots/iphone-se-home-bottom.png) |
| 小屏生成页与最近创作 | [首屏](screenshots/iphone-se-generate.png) · [底部](screenshots/iphone-se-generate-bottom.png) |
| 标准手机生成和深色主题 | [奶油胶片](screenshots/iphone-14-generate.png) · [青夜](screenshots/iphone-14-generate-dark.png) |
| 标准手机项目与弹窗 | [项目库](screenshots/iphone-14-projects.png) · [新建项目](screenshots/iphone-14-create-dialog.png) |
| 标准手机结果、资产、画布入口、账号菜单 | [结果](screenshots/iphone-14-results.png) · [资产](screenshots/iphone-14-assets.png) · [分集概览](screenshots/iphone-14-canvas.png) · [账号抽屉](screenshots/iphone-14-drawer.png) |
| 平板生成与画布 | [生成](screenshots/tablet-generate.png) · [画布](screenshots/tablet-canvas.png) |
| 640/641px 导航断点 | [640px 生成](screenshots/phone-boundary-generate.png) · [641px 生成](screenshots/tablet-boundary-generate.png) · [641px 画布](screenshots/tablet-boundary-canvas.png) |
| 桌面首页与画布 | [首页](screenshots/desktop-home.png) · [画布](screenshots/desktop-canvas.png) |

全部图片与每张截图的 DOM 宽度测量数据分别保存在 `screenshots/` 和 `h5-visual-results.json`。复测脚本为 `h5-visual-check.mjs`；需先在本地启动 Web Vite 服务 `127.0.0.1:1426`，并启动开放 9226 调试端口的 Chrome。脚本使用假账号与空项目，仅验证布局及导航。

## 行为及构建

- `@ai-video/components`：4/4 通过，包含手机底部导航、账号抽屉和页面切换。
- `@ai-video/ui-web`：21/21 通过，包含手机作品设置隐藏节点画布选项的校验。
- `@ai-video/web`：38/38 通过，包含手机画布概览和节点画布不挂载的校验。
- `@ai-video/desktop`：37/37 通过；Web 与桌面构建均通过。
- `pnpm check:boundaries`、`git diff --check` 通过。

## 真机补测范围

设备视口模拟不能代替真实手机。测试同事仍需在 iOS Safari、Android Chrome 各一台设备上检查浏览器地址栏收缩后的 `100dvh`、刘海/手势安全区、软键盘弹出时输入框与按钮的可达性、触屏滚动与底部导航点击。使用真实账号和素材覆盖上传照片、生成状态（加载/成功/失败/未知任务）、结果视频播放、首尾裁剪/字幕/封面编辑与导出；本轮截图使用空项目，未验证这些真实媒体路径。平板实机还需验证节点拖动、连线和缩放。
