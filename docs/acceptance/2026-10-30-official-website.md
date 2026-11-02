# 官网独立测试记录（本地首轮）

日期：2026-10-30。对象：当前工作区的官网生产预览 `http://127.0.0.1:1434/`、最新版网页创作应用生产预览 `http://127.0.0.1:1435/studio/`。这是**本地首轮**结果；公网服务器、真实 DMG 下载、PostgreSQL 切换和账号数据均尚未据此判定通过。测试依据：[官网 PRD](../product/2026-10-30-official-website-prd.md)。

## 执行结果

| 用例 | 本地结果 | 观察与后续门禁 |
| --- | --- | --- |
| O01 首屏与窄屏 | 通过 | 1280×720 首屏能看到定位及两枚主行动；390×844 实际视口 `scrollWidth=clientWidth=390`，标题、主按钮和菜单无遮挡。见桌面、手机截图。 |
| O02 导航与菜单 | 通过 | 四个目标锚点都存在；点击“产品能力”到 `#features`、点击“桌面版”到 `#download`；手机菜单打开后第一项获得焦点，按 Escape 关闭并将焦点还给 `menu-toggle`。见菜单截图。 |
| O03 网页入口 | 部分通过 | 官网六处网页版链接均指向同源 `/studio/`；独立 Web 生产预览的 `/studio/`、刷新和 `/studio/project/route-check` 都显示登录页。**官网与 Web 合并到同一端口、线上 `/api/health` 尚待发布后验证**。见登录截图。 |
| O04 功能文案与截图 | 部分通过 | 页面有三步、四块能力、各自可放大查看的真实界面图和五项 FAQ；三版灵感标“测试中”，完整剧本明确“不会自动拆镜”，未见免费生成或网页版整集导出的承诺。**公网真实三版 Agent 结果仍待单独验收**。见能力区和截图放大层。 |
| O05 DMG 下载/Range/哈希 | 未测 | 本地没有发布清单；真实文件、Range 206 和 SHA-256 必须上线后从公网 URL 验证。 |
| O06 DMG 安装启动 | 未测 | 本轮 QA 未从公网下载到 Applications 安装。打包侧现有局部校验见[DMG 验收记录](2026-10-30-macos-dmg.md)，不能替代安装验收。 |
| O07 未发布/缺失下载 | 部分通过 | 无 `latest.json` 时页面显示“下载准备中”，下载 `<a>` 无 `href`，复制哈希按钮禁用。Vite 预览对缺失 `/downloads/latest.json` 返回 `200 text/html` 的 SPA 兜底；前端拒绝此内容，**正式 Nginx 必须返回 404**。见下载截图。 |
| O08 哈希、说明、FAQ 键盘 | 部分通过 | 安装说明可展开，展示 Apple 官方链接；FAQ 可展开、Escape 关闭并保留焦点；截图放大层打开时焦点在关闭按钮，Escape 关闭后回到原按钮。无正式清单，哈希复制成功/拒绝权限只由 23 项官网单测覆盖，浏览器实测待发布。 |
| O09 访客与账号 | 部分通过 | 官网无登录即可阅读；`/studio/` 显示登录界面。没有使用现有账号，项目、素材读取待服务和数据切换后验证。 |
| O10 公网发布 | 未测 | 需在 `https://39.108.55.176/` 验证四类路由、404、下载字节与截图；本地截图不得当成公网证据。 |

## 自动化与构建

- 独立重跑 `pnpm --filter @ai-video/website test`：23/23 通过；`pnpm --filter @ai-video/website build`：通过。
- 独立重跑 `pnpm --filter @ai-video/web test`：38/38 通过。
- Web 预览在独立端口上打开 `/studio/`，刷新及深路径后仍显示登录页；尚未在合并的 Nginx 配置中做端到端测试。

## 截图索引

- [1280×720 官网首屏](evidence/2026-10-30-official-website/qa-preview-home-1280x720.jpg)
- [390×844 官网首屏](evidence/2026-10-30-official-website/qa-preview-home-mobile-390x844.jpg)
- [手机菜单展开](evidence/2026-10-30-official-website/qa-preview-mobile-menu-open.jpg)
- [产品能力区](evidence/2026-10-30-official-website/qa-preview-features.jpg)
- [下载禁用与安装说明](evidence/2026-10-30-official-website/qa-preview-download-disabled.jpg)
- [手机端下载区](evidence/2026-10-30-official-website/qa-preview-mobile-download.jpg)
- [FAQ 展开](evidence/2026-10-30-official-website/qa-preview-faq.jpg)
- [产品截图放大层](evidence/2026-10-30-official-website/qa-preview-image-dialog.jpg)
- [网页版 `/studio/` 登录页](evidence/2026-10-30-official-website/qa-preview-studio-login.jpg)

## 发布后复测清单

1. 在公网 `https://39.108.55.176/` 重测 O01–O04、O07–O10 并保存**公网**截图。
2. 用正式 `latest.json` 检查下载 HEAD/GET、`Content-Disposition`、Range 206、字节数与 SHA-256；不存在的 DMG 必须 404。
3. 在 Apple Silicon Mac 从公网下载、挂载、拖入 Applications、启动并记录 Gatekeeper 实际提示和窗口截图。
4. 用隔离测试账号验收登录、已有项目/素材、三版文字方向、无视频扣费；不触发付费视频生成。

## 公网第二轮（2026-10-30）

地址：`https://39.108.55.176/`。先从本机直接访问线上资源，再用 Chrome 实际打开官网并截图。测试期间用户正在操作同一 Chrome 窗口；本轮停止继续接管其窗口，手机公网截图及部分浏览器点击保持“未测”，不借用本地截图冒充。

| 用例 | 公网结果 | 证据与限制 |
| --- | --- | --- |
| O01 | 部分通过 | Chrome 中官网首屏实际渲染，产品定位、两枚主行动、创作示意图清晰可见；见[公网桌面首屏](evidence/2026-10-30-official-website/qa-public-home-desktop.jpg)。公网 390×844 未实测，本地 390×844 证据仍在上方。 |
| O02 | 部分通过 | 公网页面可访问性树确认四个锚点链接和目标区块均在页面内；用户并行操作 Chrome，未继续对公网菜单、Escape 和锚点实际点击复测。 |
| O03 | 部分通过 | `/studio/` 与深路径返回 200 且脚本资源位于 `/studio/assets/`；公网 API `/api/health` 返回 200。Chrome 中同源官网 CTA 指向 `/studio/`；公网浏览器登录页、项目页的点击流程未复测。 |
| O04 | 失败 | 公网 Chrome 实际页面含三步、四块能力、五项 FAQ、真实产品截图；本轮截图仍是改版前页面，三版灵感注明“测试中”。发布负责人用隔离账号做一次公网真实文字 Agent 调用：`POST /prompt-ideas` 返回 201，但任务最终为 `failed`、`provider_error`，获得 0 版，未满足三版能力门禁。详见[文字 Agent API smoke 记录](evidence/2026-10-30-official-website/qa-public-idea-flow.json)。该 JSON 是 API 调用记录，**不是浏览器截图**；改为“即将开放”的官网文案需要重发并复测。 |
| O05 | 部分通过 | 公网 `latest.json` 展示 v0.1.0、Apple Silicon、2.9 MiB 和完整 SHA-256；只读路由验证完整下载 2,992,581 字节、Range 206、哈希 `db2dbf78c874ac4f7dad6a8ddd06c0d374f52f7fbb17256f6e007e160ede8506`，与清单一致。浏览器直接点击下载及其下载管理器记录未测。 |
| O06 | 未测 | 未在本轮从公网 DMG 拖入 Applications 并打开。打包侧旧有校验及此轮哈希一致性不足以替代真实安装、Gatekeeper 提示截图。 |
| O07 | 通过 | 不存在的 `/downloads/missing.dmg` 返回真实 404；有效下载是 `application/x-apple-diskimage` 附件，未回退 HTML。 |
| O08 | 部分通过 | 公网页面下载卡显示“下载 DMG”“复制 SHA-256”“查看安装说明”，哈希全值与本地包一致。公网浏览器复制成功/拒绝、安装说明和 FAQ 键盘复测未完成；本地首轮已验说明与 FAQ。 |
| O09 | 部分通过 | 公网官网匿名可读。隔离 QA 账号 API 流程实测：匿名项目 401、非法邮箱 400、注册 201、账号读取 200、初始项目数 0、创建 201、列表及详情 200、退出 200、旧会话再读 401。见[账号项目流程 JSON](evidence/2026-10-30-official-website/qa-public-api-flow.json)。发布负责人另测公网注册、登录、项目恢复成功，但[文字 Agent API smoke](evidence/2026-10-30-official-website/qa-public-idea-flow.json)最终 `provider_error`；视频额度调用前后均为 `[3,0,0]`，未发生付费视频扣费。这些是 API 层证据，不能代替浏览器 UI 项目流程。 |
| O10 | 部分通过 | 公网根页、`/studio/`、API 均 200；缺失 DMG 404、Range 206、全包哈希一致，见[公网路由 JSON](evidence/2026-10-30-official-website/qa-public-http.json)和[公网桌面首屏](evidence/2026-10-30-official-website/qa-public-home-desktop.jpg)。手机公网、真实安装截图仍缺。 |

第二轮没有触发视频生成，也没有使用或更改用户现有账号。QA 账号使用 `example.invalid` 地址且凭据与会话 Cookie 均未保存。上线结论目前可支持**官网静态路由、账号/项目 API 与 DMG 文件分发可用**；**三版文字 Agent 的公网供应商能力未通过**。浏览器端完整业务、移动公网与 Mac 安装体验仍需补测。

## 公网文案修订后复核（2026-10-30）

针对 O04 的真实供应商失败，前端把官网主路径改为“写下想法或剧本 → 保存到项目 → 单镜头或手动画布创作”，并将 Agent 三版方向统一标注“即将开放”。官网测试 24/24、构建通过。修订包发布后，公网首页 HTML 已核对包含“Agent 三版镜头方向即将开放”，线上首页文件 SHA-256 为 `8573267282a64528e610455b2c452f288cf8998b823431532f66775a321274a9`。

再次执行路由/下载完整性脚本：官网 200、`/studio/` 200、API 200、缺失 DMG 404、Range 206，完整下载 2,992,581 字节且 SHA-256 仍为 `db2dbf78c874ac4f7dad6a8ddd06c0d374f52f7fbb17256f6e007e160ede8506`；安全响应头脚本五个目标全部通过。**这次修订只改变官网措辞，并未修复 Agent 供应商错误**；O04 的功能验收仍为失败。上方公网桌面截图拍摄于修订前，只证明当时页面的真实渲染，不能作为修订后文案的视觉截图。新版公网浏览器截图、手机视口、浏览器交互及 Applications 安装仍待独立复测。

## 公网 Safari 与 DMG 第三轮复测（2026-10-30）

在 Safari 实际打开修订后的 `https://39.108.55.176/`，首屏、下载区和版本清单可见；见[修订后公网首屏](evidence/2026-10-30-official-website/qa-public-home-rev2-safari.png)。点击下载按钮后 Safari 提示允许该站下载，下载管理器显示 3 MB DMG 完成。下载文件的 SHA-256 与发布清单一致，且带 Safari 隔离标记。O05 的**浏览器点击下载**得到补证；O01 的**修订后桌面首屏**得到补证。公网手机视口、菜单键盘、登录项目 UI 未在本轮复测。

O06：官网 DMG 在 Finder 挂载，包内 App 的严格签名验证通过。为了保留本机原有 `/Applications/AI Video Studio.app`，安装同字节包为 `/Applications/AI Video Studio QA.app`，成功出现首页窗口；带 Safari 隔离标记的副本则用 Finder 安装到独立目录。首次打开被 macOS 拦截，系统“隐私与安全性”页面提示无法验证 App，点击“仍要打开”后出现首页窗口。见[拦截截图](evidence/2026-10-30-official-website/qa-safari-gatekeeper-block.png)、[允许后的首页截图](evidence/2026-10-30-official-website/qa-safari-approved-app-home.png)与[完整 DMG 记录](2026-10-30-macos-dmg.md)。**O06 判定部分通过**：真实下载、安装副本和首次打开流程可用，但未覆盖安装到原有同名 Applications 路径；未经公证的首次启动存在可见阻碍。Agent 三版供应商错误仍未修复，O04 继续失败。
