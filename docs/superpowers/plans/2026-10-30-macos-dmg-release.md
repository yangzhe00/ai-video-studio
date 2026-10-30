# macOS DMG Release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 从最新版桌面源码生成经过校验、可安装启动的 Apple Silicon 测试版 DMG，并把真实版本信息交给官网发布。

**Architecture:** 在 Mac 上按 Tauri 官方 DMG 流程构建，使用 ad-hoc 签名（当前没有 Developer ID），对 App Bundle 和 DMG 分别验证。安装测试后将不可变文件名、大小和 SHA-256 写入下载清单；上传服务器后再取回比对。公开页面明确提示未经 Apple 公证和官方首次打开步骤。

**Tech Stack:** Tauri 2、Rust、macOS `codesign`/`hdiutil`/`spctl`、Nginx。

**Spec:** `docs/product/2026-10-30-official-website-prd.md`、[Tauri DMG 官方文档](https://v2.tauri.app/distribute/dmg/)、[Tauri ad-hoc 签名](https://v2.tauri.app/distribute/sign/macos/)

## Global Constraints

- 现有 `AI Video Studio_0.1.0_aarch64.dmg` 的包内 App 严格签名校验失败；绝不直接上传为可用下载。
- 当前只交付 macOS Apple Silicon，不声称 Intel、Windows 或已公证。
- 不通过禁用 Gatekeeper 或移除隔离属性来掩盖安装失败；验证用户按 [Apple 官方“仍要打开”步骤](https://support.apple.com/en-au/102445)可启动。
- 下载公开前，DMG 的本地与公网 SHA-256 必须一致；版本化文件名不覆盖旧包。
- 保留未提交的其他工作，不让测试构建覆盖现有用户项目文件。

## Review Focus

1. App Bundle 只有 Mach-O ad-hoc linker signature、资源未封存：严格验证失败，不能发布；Task 1 检查。
2. DMG 容器校验通过但 App 不能启动：必须安装到 Applications 并实际打开；Task 2 检查。
3. 网站显示版本/哈希与下载文件不一致：上传后重新取回哈希；Task 3 检查。
4. 用户在 Intel 或手机看到下载按钮：始终标注 Apple Silicon，不靠 UA 猜芯片；Task 3 检查。
5. Nginx 把缺失 DMG 改写成官网 HTML：404 和 MIME/Range 公网检查；Task 3 检查。

---

## File map

| 文件 | 职责 |
| --- | --- |
| `apps/desktop/src-tauri/tauri.conf.json` | `bundle.macOS.signingIdentity="-"` 与正式版本。 |
| `deploy/dmg/build-and-verify.sh`（新） | 在 Mac 上构建、严格签名验证、DMG 校验、版本/架构与哈希记录。 |
| `deploy/dmg/release-manifest.mjs`（新） | 从通过验证的 DMG 生成 `latest.json`，拒绝任意路径和哈希格式。 |
| `docs/acceptance/2026-10-30-macos-dmg.md` | 安装/启动/下载实际结果及截图。 |

### Task 1: 重新构建并严格校验包内 App

**Files:** 修改 Tauri bundle 配置；创建构建验证脚本。

**Interfaces:** 构建产物只来自冻结的最新版桌面源码；版本号与 DMG 文件名一致。`build-and-verify.sh` 接受 `--version` 和输出目录，成功才输出文件路径/大小/SHA-256。

- [ ] 为 Tauri 设置官方支持的 ad-hoc `signingIdentity: "-"`；检查当前签名失败是否来自打包顺序，避免对已打好的坏 DMG 原地补签。
- [ ] 运行 Desktop TypeScript/Vite、Rust `cargo test` 与 `cargo check`；用 `pnpm tauri build --bundles dmg` 构建新包。
- [ ] 对包内 App 执行 `codesign --verify --deep --strict --verbose=2`，对 DMG 执行 `hdiutil verify`；核对 `CFBundleVersion`、arm64 Mach-O 与包内 Applications 链接。任何失败均停止发布。

### Task 2: 真机安装与首次启动

**Files:** 验收文档与截图，不修改用户已有项目。

- [ ] 在测试用 macOS 用户环境挂载新 DMG，复制 App 到独立的测试 Applications 位置或先备份现有同名 App，确保不覆盖用户当前安装。
- [ ] 从复制位置实际启动，记录窗口、首页、无项目空态、创建本地测试项目；验证退出与重启。测试素材使用独立临时目录。
- [ ] 对带浏览器下载隔离标记的文件验证首次打开体验；若 Gatekeeper 拦截，按 Apple 官方“仍要打开”流程确认可运行并截图。不可把开发机本地未隔离启动当作公网安装证明。

### Task 3: 版本化上传与官网清单

**Files:** `deploy/dmg/release-manifest.mjs`、`/downloads/AI-Video-Studio-<version>-macos-arm64.dmg` 与 `latest.json`、验收文档。

**Interfaces:** 清单结构与[官网计划 Task 2](2026-10-30-official-website.md)的 `ReleaseInfo` 完全一致；SHA-256 为 64 个十六进制字符，`bytes` 是实际字节数。

- [ ] 根据已验收文件生成不可变文件名和清单，先上传暂存路径；服务器计算哈希与本地相同后原子移入 `/downloads/`，最后才发布 `latest.json`。
- [ ] 公网 HTTPS `HEAD/GET` 得到正确类型、长度、附件文件名和 206 Range；取回完整 DMG 核对 SHA-256；不存在版本返回 404。
- [ ] 官网下载卡显示真实版本/大小/哈希；从官网点击下载，下载后再次安装启动并保存截图。若发布链路任何一步失败，清单不更新、旧可用版本保持不变。

## Self-review

当前坏签名先在 Task 1 关闭；真实安装在 Task 2；官网链接、服务器与字节一致性在 Task 3。无 Apple Developer ID 的 Gatekeeper 提示和未公证状态是明确的测试版体验，不被脚本“通过”替代。
