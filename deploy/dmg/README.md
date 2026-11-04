# macOS 发布包的云端地址

正式桌面包的 API 基址记录在 [release-config.json](release-config.json)，当前为 `https://39.108.55.176/api`。这是公开地址，不含密钥。`build-and-verify.sh` 校验该文件、要求源码工作树干净，然后将地址以 `AI_VIDEO_RELEASE_API_BASE_URL` 传给 Cargo，写入 Rust 发布构建。缺少地址的直接 release 构建会失败，发布版运行时也不会回退到 `127.0.0.1:8787`。

本地 `pnpm tauri dev` 默认连接 `http://127.0.0.1:8787`；需要其它本地 API 时，在开发进程设置 `AI_VIDEO_API_BASE_URL`。发布版忽略这一运行时变量，避免安装后继承开发环境并误连本机。网页端请求、对象媒体及 SSE 均使用同源 `/api`；Vite 的 8787 代理只用于本地开发。

在干净的 Apple Silicon 源码检出中运行：

```sh
node --test deploy/dmg/resolve-release-api.test.mjs
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml
bash deploy/dmg/build-and-verify.sh
```

记录脚本输出的 `source_sha`、`api_base`、`sha256` 和 DMG 路径。先将包内 App 安装到独立 QA 位置，退出旧进程后冷启动，验证注册、登录、项目读取、素材上传/下载和预览的实际请求目标。验收通过后用 `release-manifest.mjs` 生成新版本的不可变下载文件和 `latest.json`，发布到静态根目录，并从公网重新下载比对哈希。不得覆盖旧版本 DMG 文件。
