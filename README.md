# AI Video Studio

独立开发中的 macOS 短视频创作工具。仓库使用 pnpm workspace，当前可运行应用位于 `apps/desktop`。目标是从人物或动物照片出发，按自由提示词生成镜头；可选配音与口型同步，并能剪辑、加字幕、选封面和导出。狗狗做饭是演示案例，不限制其他题材。

## 当前可用

- 在本地创建、打开和保存独立项目（`project.json`）。
- 导入照片、视频和音频；先探测媒体内容，再复制到项目文件夹，不修改源文件。
- 将照片或视频加入时间线，排序、裁剪、调整音量、添加字幕和发布文案。
- 从任意人物或动物照片保存自由提示词分镜草稿；可选台词和示例模板。项目文件 V1 可在打开时迁移到 V2。
- 查看按模型和时长估算的费用，设置项目预算，并检查任务是否在预算内；当前不会提交付费请求。
- 在 macOS 钥匙串设置 Hedra、Runway、DeepSeek 的用户自有 API Key；项目文件只保存配置状态之外的创作数据。

可预览不超过 100 MB 的本地素材，并在开发环境中离线导出 9:16 MP4 与 PNG 封面。AI 生成与口型同步仍在开发中。当前代码不进行付费模型调用，也不包含可发布的 FFmpeg 二进制。

## 开发

需要 Node.js、pnpm、Rust 和 macOS。安装依赖后运行：

```sh
pnpm install
pnpm tauri dev
```

`pnpm tauri dev` 会准备仅供本地开发的 `ffprobe`。验证：

```sh
pnpm test
pnpm build
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
```

本仓库尚未选择开源许可证；发布前需要确定许可证，并完成第三方依赖及媒体二进制许可核对。
