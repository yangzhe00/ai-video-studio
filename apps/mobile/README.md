# 移动端构建

移动端采用 Expo/React Native，使用云端 API 完成登录、项目浏览、照片上传、五秒镜头生成、结果预览和单镜头微调。默认 API 地址是 `https://39.108.55.176/api`，也可以在登录界面修改。`EXPO_PUBLIC_API_BASE_URL` 只用于覆盖公开的 API 地址，不能放密钥。

```sh
pnpm --filter @ai-video/mobile test
pnpm --filter @ai-video/mobile build
pnpm --filter @ai-video/mobile exec expo export --platform ios --output-dir /private/tmp/avs-mobile-ios
pnpm --filter @ai-video/mobile exec expo export --platform android --output-dir /private/tmp/avs-mobile-android
```

上述 `expo export` 只生成 JavaScript 资源包，不是可安装的 IPA/APK。当前 EAS 项目为 `@yy12222/ai-video-studio`。要打原生包，先在 Expo CLI 登录；从 `apps/mobile` 运行：

```sh
EAS_NO_VCS=1 /Users/yangzhe/Library/pnpm/pnpm dlx eas-cli build:inspect --platform android --stage archive --profile preview --output /private/tmp/avs-eas-android-inspect
# 核对归档没有本机 .env、密钥及 Git 历史，再提交构建
EAS_NO_VCS=1 /Users/yangzhe/Library/pnpm/pnpm dlx eas-cli build --platform android --profile preview
EAS_NO_VCS=1 /Users/yangzhe/Library/pnpm/pnpm dlx eas-cli build --platform ios --profile simulator
# 拥有 Apple Developer 签名后才运行真机构建
EAS_NO_VCS=1 /Users/yangzhe/Library/pnpm/pnpm dlx eas-cli build --platform ios --profile preview
```

根目录 `.easignore` 限制上传范围。当前使用无 VCS 归档以避免将 Git 历史上传；每次改动忽略规则后，先用 `build:inspect` 检查实际归档。`preview` 的 Android 产物为可直接安装的 APK；iOS `simulator` 产物只供模拟器使用。iOS 真机 `preview` 需要 Apple Developer 证书、描述文件和测试设备授权。上架版本使用 `production` profile，Android 产物为 AAB。打包前在 Expo 控制台核对上传的源码与环境变量，保持服务端供应商密钥只在 API 服务器。

本地 Android Studio/Xcode 构建还需要完整的 Android SDK/JDK 和 Xcode。手机无法访问电脑上的 `127.0.0.1`；联调本地 API 时需提供局域网地址，并使用开发构建。发布构建只允许 HTTPS API 地址。
