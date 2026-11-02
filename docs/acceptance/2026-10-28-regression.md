# AI Video Studio 实测回归报告（2026-10-28）

本轮只执行测试、记录证据和缺陷，未修改业务代码。测试使用隔离账号、本地 API 数据目录和模拟可灵服务；没有发起真实付费生成。工作区由多个任务同时修改，以下结果按实际执行时间和源码快照解释，不能把单元测试或构建当作真机验收。

## 结论

| 项目 | 结果 | 实测范围与证据 |
| --- | --- | --- |
| 总测试 `pnpm test` | 通过，108/108 | 18:46 的工作区快照，含项目 DSL、API、网页、桌面和组件测试；[日志](evidence/2026-10-28/pnpm-test-current.log)。 |
| 总构建 `pnpm build` | 通过 | 18:46 的工作区快照，含 API、移动端类型检查、网页和桌面产物；[日志](evidence/2026-10-28/pnpm-build-current.log)。 |
| `git diff --check`、依赖边界 | 通过 | 最新差异格式检查无输出；边界检查包含在总测试末尾。 |
| Rust `cargo test --offline` / `cargo check --offline` | 通过，17/17 / 通过 | 17:54 执行；此后 Rust 源文件未变；[测试](evidence/2026-10-28/cargo-test.log)、[检查](evidence/2026-10-28/cargo-check.log)。 |
| 网页画布真实交互 | 通过（模拟供应商） | 浏览器中建项目、上传照片、连接图片和提示词到视频节点、生成审批、刷新恢复、结果回填、播放视频、加入时间线并再次刷新；[刷新中截图](evidence/2026-10-28/web-canvas-after-reload.png)、[结果截图](evidence/2026-10-28/web-canvas-completed.png)、[视频预览](evidence/2026-10-28/web-video-preview.png)、[时间线](evidence/2026-10-28/web-timeline-after-reload.png)。 |
| API 运行与错误恢复 | 通过（隔离实例） | 持久化提交意图、同 ID 重放、审批重放、SSE 序号补读；`storage_pending` 跨进程重启恢复，无第二次供应商提交；[API 记录](evidence/2026-10-28/api-smoke.log)、[待存储](evidence/2026-10-28/stage-storage-restart.log)、[恢复](evidence/2026-10-28/storage-recovered.log)。 |
| 并发冲突与片段元数据 | 通过（API） | 两个客户端用同一旧版本写入分集：后写者收到 409；冲突期间云端再修改，旧版“保留本地”再收到 409。片段 ID、入出点、音量经过保存及测试实例重启仍一致；[操作记录](evidence/2026-10-28/api-conflict-smoke.log)、[重启复查](evidence/2026-10-28/api-conflict-restart-latest.log)。 |
| 移动端 A→B 会话隔离 | **失败** | `uploadPhoto` 在本地文件读取期间切换服务器会把 B 的 Cookie 发往 A；独立执行当前源码复现；[复现程序](evidence/2026-10-28/mobile-upload-race.mjs)、[输出](evidence/2026-10-28/mobile-upload-race.log)。 |
| 桌面、移动端原生界面 | 未完成 | 桌面 `pnpm tauri dev` 的 1420 端口已被其他进程占用；单独 `cargo run` 启动了进程但未观察到应用窗口。机器没有可用的 iOS 模拟器/真机。桌面同步与备份只完成代码和自动测试验证；[Tauri 启动日志](evidence/2026-10-28/tauri-dev.log)、[Cargo 启动日志](evidence/2026-10-28/tauri-cargo-run.log)。 |

## 缺陷与风险

### P0：移动端上传照片会跨服务器发送会话 Cookie（已动态复现）

位置：`apps/mobile/src/api.ts:29-36`。函数先固定 A 服务器地址，然后等待本地图片读取，发起上传时却调用 `session.headers()` 读取**当前**会话。复现顺序：A 已登录 → 开始读取本地图片并暂停 → 将服务器切到 B 并登录 → 恢复读取；实际请求发往 A，但携带 `avs_session=server-b`。期望旧上传取消，或请求始终使用与目标服务器对应的会话。普通 `request()` 路径以及 `session.ts` 的 A→B/迟到 Cookie 单测通过，未覆盖此异步上传窗口。该问题涉及跨服务端凭据发送，应在发版前修复并补回归测试。

### P1：移动端选择“云端版本”可能采用过期冲突快照（代码审查发现，未真机执行）

位置：`apps/mobile/src/App.tsx:107-112`。冲突弹窗打开后若云端再次改变，点击“云端版本”直接 `setProject(conflict.remote)` 并关闭弹窗，没有重新拉取最新版本。API 实测证明这种期间变更会发生，且“保留本地”遇旧版本会再收到 409。云端分支可能让用户暂时看到旧数据，需在真机或组件级交互中验证。

### 构建门禁的中间快照

18:35 曾在并行编辑期间出现 TS5097，见[当时日志](evidence/2026-10-28/pnpm-build-latest.log)。18:46 对随后稳定快照重跑的完整构建已通过，因此该中间错误不列为当前缺陷。

## 实际执行细节与限制

- 网页画布运行 ID 在刷新前后保持一致。模拟服务商一共收到 2 次提交，分别对应 API 脚本和浏览器各自一次；刷新、API 重启、审批重放后仍为 2 次。结果在原视频节点回填，节点/连线仍为 4/2；预览视频可播放（约 1 秒），加入时间线后刷新仍有 1 个片段。[供应商计数](evidence/2026-10-28/mock-counts-final.json)。
- `storage_pending` 恢复注入的是本地已下载有效 MP4：对象额度设为 1 时保留 `.ready` 文件与预留额度；重启后将额度设为 2，操作和运行变为 `saved`，对象/镜头各只增加一次，文件字节一致，预留额度释放。此场景验证了落盘恢复，未覆盖真实供应商视频下载链路。
- 桌面同步的独立资源合并、同资源冲突、过期本地选择、片段元数据往返，分别由 5 项相关 TS 测试覆盖；冲突前项目及媒体备份由 Rust 测试覆盖。尚未在桌面 GUI 验收。
- 大于 100 MB 文件、长时运行、多镜头实际导出、跨端同账号真机同步及真实付费生成尚未执行。相关用例保留在 [测试分析](2026-10-28-test-analysis.md)。

证据目录：`docs/acceptance/evidence/2026-10-28/`。测试账号、素材和服务数据只存在本机隔离目录 `/private/tmp/avs-regression-20261028/`；该目录可能被系统清理，以上复制到仓库的日志与截图供复查。
