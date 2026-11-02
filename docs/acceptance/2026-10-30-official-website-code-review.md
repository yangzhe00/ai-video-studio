# 官网发布后代码评审

日期：2026-10-30。评审依据：正式[公网 QA](2026-10-30-official-website.md)、[发布记录](2026-10-30-official-release.md)、[官网 PRD](../product/2026-10-30-official-website-prd.md)。范围：官网页面与下载清单、Web 的 `/studio/` base、Nginx 路由/安全头、DMG 发布脚本、PostgreSQL 迁移预检与 SQLite 升级副本。工作树含并行开发的未提交文件；本次评审只对上述发布范围作结论。

## 已发现并处理

| 严重度 | 位置与发现 | 处理及验证 |
| --- | --- | --- |
| P1 产品能力 | 公网 `POST /prompt-ideas` 创建后最终 `failed/provider_error`，返回 0 版；当前 Agent 三版方向不可作为官网卖点。 | [官网首屏与能力区](../../apps/website/index.html)改为自写内容主路径，Agent 统一标“即将开放”；24 项官网测试、构建、正式 HTML 内容与公网路由复测通过。供应商功能本身**仍未修复**，见 QA O04。 |
| P2 下载响应 | [Nginx 配置](../../deploy/nginx/ai-video-ip.conf)原先的 `default_type` 被服务器全局 `.dmg` MIME 映射覆盖，公网回 `application/octet-stream`。 | 在 DMG 位置显式声明 `types { application/x-apple-diskimage dmg; }`；Nginx 语法与公网完整下载、Range、哈希验证通过。 |
| P2 会话延续门禁 | [PostgreSQL 预检](../../deploy/postgres/preflight.sh)原先未比较旧/新 `API_SESSION_SECRET`；表计数相同也无法保证老会话继续有效。 | 本地预检加入不输出密钥的等同性检查，`bash -n` 通过；已上线环境的旧/新值只读比较为相等。旧用户浏览器续期尚待 UI 验证。 |

## 已审查通过的路径

- [下载清单解析](../../apps/website/src/release.ts)限制版本、平台、文件名、哈希与日期；发布脚本只接受 Tauri 对应版本包，复制时拒绝同名不同内容；公网文件与清单 SHA-256 一致。
- [Nginx](../../deploy/nginx/ai-video-ip.conf)把官网、`/studio/`、`/api/`、下载文件分开；不存在的下载返回 404，下载支持 Range 206。安全头脚本覆盖 HTML、API 200/401、缺失下载，均通过。
- [Web 构建配置](../../apps/web/vite.config.ts)把生产资源指向 `/studio/`；公网直接打开与深链接回退检查通过。
- [SQLite 升级副本](../../apps/api/scripts/upgrade-sqlite-copy.mjs)会 checkpoint WAL 并切到 DELETE 日志模式；正式演练、导入、逐表计数与素材路径验证通过。正式 API 运行账号只能业务读写，不能 DDL。
- 官网无密钥写入静态产物，下载页明确 Apple Silicon 测试版及未经公证，FAQ 对手动拆镜、桌面本地项目同步条件有明确说明。

## 未关闭的验收风险

1. **P1：Agent 供应商能力失败。** 前端文案已降级，后端须另案定位 `provider_error` 并在公网取得恰好三版后才能恢复宣传。
2. **P2：DMG 实际用户安装未完成。** 本地包挂载、签名和独立目录进程启动及公网下载字节一致已证实；从浏览器下载、拖入 Applications、Gatekeeper 首次提示及窗口操作没有截图。未经 Apple 公证的首次启动会有额外系统步骤。
3. **P2：浏览器端完整业务未复测。** 公网 API 注册/登录/项目恢复通过；用户正在使用 Chrome，独立 IAB 暂不可用，未接管用户窗口。新版官网公网手机视口、键盘交互和修订后首屏截图仍待补。
4. **P2：旧账号/未完成任务的 UI 恢复未逐个实测。** 导入的 14 张表记录数、5 个账号、3 个项目、5 个素材和文件路径一致，且会话密钥相等；这些证据不能代替旧用户使用原凭据与原任务 ID 的端到端验证。

结论：官网静态展示、`/studio/` 路由、PostgreSQL 数据迁移、API 基础业务和 DMG 文件分发的代码/发布配置没有剩余的已确认阻断缺陷；**Agent 三版方向、真实安装和完整浏览器验收未通过发布完成标准**。因此对外仅可描述已验证的自写内容路径和测试版下载，不可宣称三版方向已稳定可用或 macOS 安装无阻碍。
