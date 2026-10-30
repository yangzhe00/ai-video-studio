# Frontend, Mobile and Desktop Security Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 Web、Expo、Tauri 三端遵守统一的安全请求协议，限制移动端明文传输和桌面端本机文件访问，并产出可验证的 macOS 沙箱构建。

**Architecture:** 服务端先在 `@ai-video/api-contracts` 发布 `X-AVS-Request: 1` 约定；三端调用方统一发送，服务端负责最终拒绝。桌面文件授权和路径检查必须在 Rust 命令边界执行，JS 侧选择器只承担交互。macOS App Sandbox 与 Tauri capability 分别验证。

**Tech Stack:** React 19、Expo/React Native、Tauri 2/Rust、Vitest、Cargo、macOS codesign。

**Spec:** [安全检查](../../architecture/2026-10-30-security-audit.md)

## Global Constraints

- 保留现有 Node 24、pnpm 10.30.1、React 19、Tauri 2 技术栈；不引入未评审依赖。
- 保留已有项目、资产、付费请求 ID 与当前云端同步语义；失败后不能自动重发付费 POST。
- 与后端约定同一请求头常量。服务端强制校验与三端更新必须协调发布；不在客户端持有服务端 API 密钥。
- 不把 `capabilities/default.json` 中的 Tauri 插件权限误作自定义 Rust 命令的路径约束；Rust 自行验证。
- 修改前检查脏工作树，保留别的会话正在进行的改动；提交只包含本计划文件。

## Review Focus

1. 无 body 的登出 POST 仍需发送安全请求头；在 Task 1 测试。
2. 原生桌面 `cloud_request` 的变更请求与素材上传命令也必须发送该头；素材下载 GET 保持原样；在 Task 1 测试。
3. 移动端从 HTTPS 服务器切换到远程 HTTP 时应拒绝并清理旧会话；在 Task 2 测试。
4. 恶意项目目录中的符号链接及伪造 `root` 不能越界读写；在 Task 3 测试。
5. 沙箱构建跨重启打开旧项目、导入、FFmpeg 导出仍可用；在 Task 4 真机验收。

---

### Task 1: 三端适配有状态请求安全头

**Files:** Modify `apps/web/src/api.ts`, `apps/mobile/src/api.ts`, `apps/desktop/src-tauri/src/cloud.rs`; Test `apps/web/src/api.test.ts`, `apps/web/src/mobile-session.test.ts` 或新增 `apps/mobile/src/api.test.ts`、Rust `cloud.rs` 测试；依赖后端会话在 `packages/api-contracts/src/index.ts` 导出的 `AVS_REQUEST_HEADER_NAME = "X-AVS-Request"` 和 `AVS_REQUEST_HEADER_VALUE = "1"`。

**Interfaces:** Web/移动 `POST|PUT|PATCH|DELETE` 的普通 JSON、无 body 与二进制上传均设 `X-AVS-Request: 1`；Tauri Rust `cloud_request` 的变更请求、`cloud_upload_asset` 设同一头。`cloud_download_asset` 是 GET，保持原样；EventSource 也保持原样。登录/注册发送该头。TypeScript 从共享包读常量，Rust 使用同值常量并用协议测试防漂移。

- [ ] 先写失败测试：登录、登出、素材上传、项目命令、付费确认都有头；GET 不必带头；桌面 IPC 到 API 的请求保持 Cookie 且带头。
- [ ] 运行受影响测试，确认新增断言先失败；再由 TypeScript 客户端复用共享常量，Rust 侧定义同值常量并验证协议一致。
- [ ] 运行 `pnpm --filter @ai-video/web test`、受影响移动测试、`cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml`；记录各项退出码。
- [ ] 与后端会话对照预检允许头、403 错误格式和发布顺序；用浏览器、桌面、移动的登录/创建/上传/确认请求实测。

### Task 2: 移动端只向可信 HTTPS 服务器发送凭据

**Files:** Modify `apps/mobile/src/session.ts`, `apps/mobile/src/App.tsx`; Test 新增 `apps/mobile/src/session.test.ts` 或现有跨端会话测试；必要时更新 `apps/mobile/src/api.ts`。

**Interfaces:** `setUrl()` 在生产只接受合法的 `https://` 服务器源（无用户信息、路径、查询、片段）；开发版 HTTP 必须显式开发开关并限于明确的本机/模拟器地址，生产构建永不启用。恢复旧存储 URL 时若不符合策略，删除对应 Cookie 和 origin 并要求用户重新选服务器。服务器切换继续隔离 Cookie。

- [ ] 写失败测试：拒绝 `http://example.com`、含用户名/路径的 URL；生产恢复旧 HTTP 会话后不发送 Cookie；正常 HTTPS 登录/上传可用。
- [ ] 实现 URL 解析与生产/开发策略，更新 UI 提示，不将密钥/会话打印在日志中。
- [ ] 跑移动相关测试与构建；在真实移动运行环境核对 HTTPS 登录和切换服务器。

### Task 3: 桌面端原生文件授权和防越界

**Files:** Modify `apps/desktop/src-tauri/src/{lib,project,media,cloud,export}.rs`、`apps/desktop/src/lib/native.ts`，必要时 `apps/desktop/src-tauri/src/ai/kling.rs`；Test 同目录各模块的 Rust tests 和 `apps/desktop/src/App.test.tsx`。

**Interfaces:** Rust `AppState` 保存由原生选择器或应用创建获得的当前项目 canonical root，文件操作不接受任意字符串 root 作为授权凭据。用户选取的导入源仅在被授权后可读；项目内写目录禁止链接跳转。对现有 JS API 提供逐步迁移适配，最终删除可伪造的 root 参数。路径权限错误使用稳定可显示文案，不回显敏感路径。

- [ ] 写失败测试：伪造非当前项目 root、manifest 中越界或链接路径、`media/source`、`media/cloud`、`exports` 指向外部的符号链接、替换时机与非文件源；外部哨兵文件必须保持原字节。
- [ ] 在 Rust 侧实现 canonical root/来源/目的地检查和不跟随符号链接的创建/替换；导入、下载、导出与备份复用统一的检查函数，避免只在 JS 中防护。
- [ ] 跑 `cargo test`、`cargo check`、桌面 Vitest；使用一张真实本地照片完成打开项目、导入、生成后下载、导出回归。不得用模拟测试代替原生权限验收。

### Task 4: macOS App Sandbox 发布门禁

**Files:** Modify `apps/desktop/src-tauri/tauri.conf.json`，Create `apps/desktop/src-tauri/entitlements.plist` 或 Tauri 对应官方配置文件；按需要修改选择器授权持久化；更新 `docs/acceptance/` 的产物验收记录。

**Interfaces:** 发布配置启用 `com.apple.security.app-sandbox`，仅加必需的 `network.client` 与 `files.user-selected.read-write` 等权限；Tauri capability 保持最小，审查 `opener:default` 是否可缩小。若 App Sandbox 与 FFmpeg/旧项目访问冲突，先解决并记录，不在未经成功安装运行时声称已安全开启。

- [ ] 增加 entitlement 和发布构建脚本检查；构建后用 `codesign -d --entitlements :- <App>` 验证实际包内启用，记录输出（不含用户数据）。
- [ ] 从 DMG 安装到独立测试位置，验证首次和重启后打开旧项目、选择本机照片、媒体探测、云端下载、FFmpeg 导出及网络请求。
- [ ] 记录沙箱拒绝日志和处理结论；如果发布签名/公证条件尚未具备，明确标记产物门禁未通过，继续完成可独立交付的 Task 1–3。

## 交付证据

每项给出代码改动、自动化测试命令/退出码、负例验证和必要截图；区分源码通过、macOS 构建通过、实际安装运行通过。将可复现安全问题在回归材料中去敏处理，不上传用户素材或密钥。
