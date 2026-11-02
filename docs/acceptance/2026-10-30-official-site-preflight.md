# 官网与 DMG 发布预检（2026-10-30）

这是设计前的只读核查，**不是上线验收**；未修改服务器或现有安装包。

## 已确认

| 项目 | 观察与证据 | 发布影响 |
| --- | --- | --- |
| 现有公网入口 | `https://39.108.55.176/` 返回 200；`/api/health` 返回 `{"ok":true}`。 | 官网与网页版须保留同源 `/api/`。 |
| 静态站与 API | 服务器 `sr-nginx` 负责根目录静态页，`ai-video-studio-api` 容器健康。Nginx 配置有 `/api/` 代理、`/assets/` 缓存、`/` SPA fallback。 | 官网占 `/` 需新增 `/studio/` fallback 与 `/downloads/`，不能让 DMG 路径落进 SPA fallback。 |
| 发布目录 | 宿主机 `/usr/local/soft/docker/nginx/html/ai-video-studio` 可写，约 892 KiB；所在磁盘剩余约 114 GiB。当前 release 指向 `/srv/ai-video-studio/releases/20261029-cursor-01`。 | 空间足够存放 DMG；仍需备份静态目录和 Nginx 配置后切换。 |
| 服务端配置 | 仅核对变量**名称**：运行容器含 `IDEA_PROVIDER`、`CURSOR_API_KEY`、`KLING_API_KEY`、`API_DATA_DIR`；未读取或打印值。 | 已配置不等于线上真实生成验收；官网主张需用测试账号实测。 |
| 现有 DMG | `apps/desktop/src-tauri/target/release/bundle/dmg/AI Video Studio_0.1.0_aarch64.dmg`，3,395,892 字节，SHA-256 `9d8a27b7b309d31656ffc88f21c7796eeb2e23e5604a25210da120a03d338571`。`hdiutil verify` 校验有效，挂载后含 App 与 Applications 快捷方式。 | 容器存在，但不能只凭这两项判定可分发。 |
| 包内 App | `codesign --verify --deep --strict` 失败：`code has no resources but signature indicates they must be present`；`spctl -a -vv` 同样失败；`xcrun stapler validate` 无公证票据。`codesign -dv` 显示 ad-hoc/无 TeamIdentifier。 | **当前 DMG 不得挂官网作为可用下载**。须重新构建/签名并做安装启动实测；无 Developer ID 时只能标为未经公证的测试版。 |
| 部署入口 | 以前任务的临时 SSH 密钥可只读登录服务器；本轮只执行只读查询，未上传、覆盖或重载服务。 | 后续写入与回滚必须在设计批准及发布门禁通过后执行。 |

## 已确认的产品选择

1. 官网首页 `/`，最新版创作应用 `/studio/`。
2. 同次上线本地最新 Web 与 PostgreSQL API，必须先迁移并验证线上数据。
3. 先沿用现有 HTTPS IP；品牌域名以后再接入。

## 依据

- [Tauri 官方 DMG 构建](https://v2.tauri.app/distribute/dmg/)与[macOS ad-hoc 签名](https://v2.tauri.app/distribute/sign/macos/)；Tauri 明确 ad-hoc 不能消除系统“隐私与安全性”里的人工允许步骤。
- [Apple 软件分发说明](https://developer.apple.com/macos/distribution)、[Apple 公证要求](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution)与[Apple 用户打开未验证 App 的说明](https://support.apple.com/en-au/102445)。
