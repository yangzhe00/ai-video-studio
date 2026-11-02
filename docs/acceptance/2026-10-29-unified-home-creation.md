# 首页统一创作入口独立验收（2026-10-29）

## 环境与结论

- 验收环境：本机独立 SQLite `/private/tmp/avs-unified-qa.oKzfVz/data`，API `127.0.0.1:18796`，网页 `127.0.0.1:1422`，文字模型为本机 `127.0.0.1:18795` 的 Chat Completions 模拟服务。未配置真实可灵视频密钥，未点击“确认并开始生成”，未调用付费视频服务。
- 真实浏览器截图为网页正在运行的页面，尺寸含 1280×720 与 390×844；`qa-photo.jpg` 与蓝/绿 MP4 均是本地生成的验收素材。MP4 经账号鉴权的 `/objects`、`asset` 和 `canvas` 命令接入，仅验证已有素材的画布编排，不证明真实视频生成。
- 总结：网页统一输入、Agent 三版、手写路径、项目归属与画布原文、待审批边界、异常请求恢复、账号隔离、窄屏与深色模式均有通过证据。A08 冲突 UI 首轮未达标，修复后真实网页复测通过。A04 网页导出尚无实现。root 使用当时最新 desktop dist 重新打包 `.app`，原生窗口复测 H0、S1 与无项目画布空状态通过；原生创建/重开/同步仍未验。2026-10-30 最新 Web logout 故障修复后，独立 Web 全包 **37/37**、构建通过；root 隔离 PostgreSQL 全仓测试与构建通过，QA 已核对日志。各轮证据按时间记录于文末。

## 回归命令

| 命令 | 结果 |
| --- | --- |
| `pnpm test`（默认沙箱） | API 网络用例因 `listen EPERM: operation not permitted 127.0.0.1` 超时，属于环境阻塞，不能计通过。 |
| `pnpm --filter @ai-video/api exec vitest run src/briefs.test.ts src/prompt-ideas.test.ts --maxWorkers=1`（允许本机 loopback） | 2 文件 / 7 用例通过。 |
| `pnpm test`（允许本机 loopback；最终 20:26 复跑） | API 56/56、api-contracts 4/4、web 26/26、desktop 29/29、project-core 31/31、ui-web 19/19、components 3/3 及其余包全部通过；Workspace boundaries OK。 |
| `pnpm build`（最终 20:27 复跑） | 全工作区 TypeScript 与 web/desktop Vite 构建通过。 |
| `git diff --check` | 通过。 |
| `pnpm --filter @ai-video/api-contracts test`（并行包链接变更后） | 4/4 通过。 |
| `pnpm --filter @ai-video/web build`（A08 修复与包链接变更后） | TypeScript 与 Vite build 通过。 |
| `pnpm --filter @ai-video/web test`（A08 修复与包链接变更后的中间轮次） | 曾 1 failed / 25 passed；开发修复旧 mock/初始 view 后，最终全量为 26/26。 |
| `pnpm --filter @ai-video/desktop build`（包链接变更后） | TypeScript 与 Vite build 通过。 |
| `pnpm --filter @ai-video/desktop test`（包链接变更后的中间轮次） | 曾 1 failed / 27 passed；开发修复首帧提示词映射后，最终全量为 29/29。 |
| [独立本机 API 脚本](./evidence/2026-10-29-unified-home-creation/qa-api-live.mjs) `verify` | 创建同 ID 重放、首条原文唯一、已有项目命令重放、陈旧版本 409、账号隔离、模拟模型只调用一次均通过；[结果 JSON](./evidence/2026-10-29-unified-home-creation/qa-api-live-result.json)。 |
| 同脚本 `verify-unknown` | 断线模拟模型返回 `unknown`，原 ID 重放后模型调用增量仍为 1。 |

## A01–A12

| 用例 | 结果 | 独立实测证据与边界 |
| --- | --- | --- |
| A01 首页布局 | 通过 | [1280×720 首页](./evidence/2026-10-29-unified-home-creation/web-home-1280x720.jpg)、[390×844 窄屏](./evidence/2026-10-29-unified-home-creation/web-home-narrow-390x844.jpg)、[深色窄屏](./evidence/2026-10-29-unified-home-creation/web-home-dark-narrow-390x844.jpg)。一个主输入区、两个主动作在首屏；窄屏 DOM `scrollWidth=390=innerWidth`。 |
| A02 关键词找灵感 | 通过 | 真实 UI 返回恰好三张不同的单镜头卡，选择第二版后编辑文本进入 S1；[三版截图](./evidence/2026-10-29-unified-home-creation/web-three-ideas-1280x720.jpg)、[S1 截图](./evidence/2026-10-29-unified-home-creation/web-work-setup-1280x720.jpg)。进入项目前 DB 为 `projects=0, agent_runs=0, operations=0, demo_used=0, demo_reserved=0`。 |
| A03 自有提示词 | 通过 | 手写 24 字进入 S1，出现“我确认这是一段单镜头描述”，勾选后进入 G1；模型计数仍为 1，未新增调用。 |
| A04 完整剧本画布 | 部分通过 | 原剧本保存在非执行面板 [截图](./evidence/2026-10-29-unified-home-creation/web-canvas-brief-1280x720.jpg)，初始仅时间线节点；手动新建两个视频节点 [截图](./evidence/2026-10-29-unified-home-creation/web-canvas-two-manual-nodes.jpg)。本地种入两段测试 MP4 后画布可加入时间线，UI 加入第二段并由 DB 确认两段记录 [截图](./evidence/2026-10-29-unified-home-creation/web-canvas-two-seeded-clips.jpg)。第一段通过鉴权 API 作为探针加入；首次 UI 点击第一段未产生 episode 命令，刷新后未复现，原因未定。网页“导出整集”仍禁用，`CanvasPage` 要求 `onExport`，当前 web 未提供，故网页成片导出不通过。真实生成未验收。 |
| A05 长文本直接生成 | 通过 | S1 最终内容 2001 字时直接生成禁用，显示“请缩短内容，或进入画布手动拆镜”；[截图](./evidence/2026-10-29-unified-home-creation/web-overlength-direct-disabled.jpg)。 |
| A06 新项目响应丢失 | API 通过，UI 未验 | 同 ID/同内容二次 `POST /projects` 返回 200 且仅一项目一原文；不同内容 409。没有真实浏览器断网丢响应场景。 |
| A07 加入已有项目 | 通过 | S1 选择已有项目与目标分集后，画布仍 3 个节点，原文数由 1 变 2；[旧原文](./evidence/2026-10-29-unified-home-creation/web-existing-project-brief-append.jpg)、[新原文](./evidence/2026-10-29-unified-home-creation/web-existing-project-second-brief.jpg)。API 同命令重放不重复。 |
| A08 同一原文两端编辑 | 修复后通过 | API 返回 409、服务端最新版本与修订号，本端未覆盖服务端。网页首轮仅给笼统错误，[首轮缺陷截图](./evidence/2026-10-29-unified-home-creation/web-brief-conflict-missing-both-versions.jpg)。修复后真实网页显示[本端草稿与云端当前版本以及三个明确处理按钮](./evidence/2026-10-29-unified-home-creation/web-brief-conflict-two-versions-after-fix.jpg)；点击“使用云端版本”后编辑框载入云端文本，冲突区域消失。 |
| A09 Agent 未知状态 | 通过 | 断线 mock 下 API `unknown` 同 ID 重放不新增调用；网页出现“查询原请求”“另起一轮”，手写按钮仍可用；点击查询前后 mock calls 均为 2。[截图](./evidence/2026-10-29-unified-home-creation/web-agent-unknown-recover.jpg)。未配置模型 UI 可继续手写由组件/API 自动化覆盖。 |
| A10 审批边界 | 审批前通过，确认后未验 | G1 缺照片按钮原先可点，前端修复后真实页面已禁用，[修复截图](./evidence/2026-10-29-unified-home-creation/web-g1-missing-photo-disabled-after-fix.jpg)。上传本地测试 JPEG 后进入 G2；[审批卡截图](./evidence/2026-10-29-unified-home-creation/web-generation-approval-card-1280x720.jpg)显示提示词、参考图、5 秒、目标分集和 1 次额度。刷新后重新打开项目可找回待确认计划。未点确认时 DB `operations=0,demo_used=0,demo_reserved=0`；确认后单任务未在真实 UI 执行，避免付费调用。 |
| A11 账号与桌面状态 | 网页通过；桌面未登录主路径通过，创建/同步未验 | 第二账号首页无首账号草案、项目与灵感；无项目时创作/画布/结果/资产各有空状态及“选择已有项目/新建项目”入口，[网页资产空状态](./evidence/2026-10-29-unified-home-creation/web-assets-empty-second-account.jpg)。root 用当前 desktop dist 重新打包 `.app` 并在真实 CUA 原生窗口复测：H0 点“画布”显示[专属画布空状态](./evidence/2026-10-29-unified-home-creation/desktop-native-canvas-empty-current.png)，有选择/新建项目入口；H0 手写内容到[S1 作品设置](./evidence/2026-10-29-unified-home-creation/desktop-native-work-setup-current.png)，S1 点“画布”到空状态，再点“继续作品设置”原文逐字保留。上述桌面结果由 root 补测，非本 QA agent 亲测。旧 19:59 `.app` 截图仅为无效历史证据，不作当前结论；原生创建/重开/同步未验。 |
| A12 返回刷新切页 | 通过 | 第二账号填写未提交草稿，切到画布空状态再回首页及刷新，原文仍在；切页未调用模型/视频。Agent 旧三版在输入改动后标过期。 |

## 缺陷与限制

1. **并行包链接后的回归已修复：** 新增 `api-contracts` 的中间轮次曾出现 Web 1/26、Desktop 1/28 单测失败；开发修复后独立全量复跑为 Web 26/26、Desktop 29/29。保留中间失败记录，最终门禁以 20:26 全量复跑为准。
2. **A04 网页导出缺口：** 两个测试素材虽可编排，网页 `导出整集` 仍禁用。无法把网页长视频闭环计为通过。
3. **A04 首次加入时间线未提交：** 在经 API 种入素材后，首次点击第一段 UI 按钮，DB 仍 0 且无 episode 命令。API 直接写入一段后，刷新并点击第二段 UI 成功写入。此现象尚未复现，暂不定性为产品缺陷。
4. **桌面原生覆盖边界：** 本 QA agent 运行 `pnpm --filter @ai-video/desktop tauri dev` 启动了 `target/debug/ai-video-studio`，但 CUA app inventory 未列出该调试进程；按绝对路径、bundle ID、名称绑定均返回 `Invalid app`。root 随后用最新 dist 打包 `.app` 并提供可信原生 H0/S1/画布空状态截图，证明未登录主路径。旧包的“画布弹项目选择”截图无效，不作为当前缺陷。原生创建/重开/同步仍未覆盖。没有将网页截图冒充桌面窗口。

测试截图均为真实运行页面。A08 修复后的实际 UI 复测与旧缺陷截图同时保留。

## 代码审查四项修复：独立复测（21:04–21:10）

以下复测在开发完成后由独立 QA 运行。聚焦用例通过不代表当前全工作区门禁通过；并行 API PostgreSQL 迁移改变了后端测试和构建前提。

| 修复项 | 结果 | 独立证据与边界 |
| --- | --- | --- |
| P1 native 首条原文原子创建 | 聚焦通过 | `cargo test project::tests --lib` 7/7；其中首次落盘测试直接读 `project.json`，确认 `extensions.creationBriefs[0]` 与输入相同、重开得到同一 manifest、已有 root 再创建报错且文件字节不变；无效首条原文不会创建目录。另跑 Desktop App 聚焦测试，首次后续 save 失败后同进程恢复只调用一次 create，原文 ID 不变。未模拟突然断电或并发进程抢占同一路径。 |
| P1 桌面选第 2 集 | 聚焦通过 | `pnpm --filter @ai-video/desktop exec vitest run src/App.test.tsx -t 'opens the chosen second episode\|recovers an atomically created' --maxWorkers=1`，3/3；直生输入进入第 2 集，画布标题为第 2 集，保存的 `activeEpisodeId` 为第 2 集。该轮是 React + native port 模拟测试，未在当前新打包 `.app` 上操作两集。 |
| P1 长原文冲突 | 组件逻辑通过；滚动视觉未完成 | `pnpm --filter @ai-video/ui-web exec vitest run --environment jsdom src/SyncConflictDialog.test.tsx --maxWorkers=1`，3/3；两侧 1000 字以上正文的不同结尾都完整存在于组件 DOM，原文、最终内容、来源均显示。CSS 为可滚动的 `pre`。QA 在 Chrome 通过临时 Vite 页面挂载**真实 SyncConflictDialog 组件**并保存[运行截图](./evidence/2026-10-29-unified-home-creation/desktop-long-brief-conflict-component-harness.png)和[测试输入源码](./evidence/2026-10-29-unified-home-creation/desktop-long-brief-conflict-component-harness.tsx)；截图标记“QA 组件测试页面 · 非真实云同步”，但视口中还没有同时露出两侧结尾。继续滚动时 Mac 锁屏，CUA 报无法自动解锁，因此**未取得尾部差异可见的截图，也未完成原生同步冲突操作**。 |
| P2 Web 慢 GET 后切回新建 | 聚焦通过 | `pnpm --filter @ai-video/web exec vitest run --environment jsdom src/App.test.tsx -t 'keeps new-project submit available after leaving a slow existing-project lookup' --maxWorkers=1`，1/1；模拟详情 GET pending、切回“新建项目”、选择画布，提交按钮立即恢复可点，迟到的 GET 返回后仍可点。真实网络慢 GET 浏览器实操未重复。 |

聚焦构建：`pnpm --filter @ai-video/web build` 与 `pnpm --filter @ai-video/desktop build` 均通过。Rust `cargo test project::tests --lib` 7/7；Desktop 聚焦 3/3、Web 聚焦 1/1、ui-web 组件 3/3。首次直接调用 Web vitest 未传项目脚本所需的 `--environment jsdom`，因 `document/window is not defined` 失败；用项目一致的 jsdom 参数复跑通过，这是命令环境问题，不是产品断言失败。

### 当前全工作区门禁阻断

- `pnpm test` **未通过**：[完整日志](./evidence/2026-10-29-unified-home-creation/code-review-pnpm-test-blocked.log)。API 测试当前 `createDb()` 要求 `DATABASE_URL`，旧测试配置未提供；默认沙箱还报 `listen EPERM 127.0.0.1`。这两项发生在并行 PostgreSQL 迁移中的 API，不归因于四项交互修复，也不能计为全量通过。
- `pnpm build` **未通过**：[完整日志](./evidence/2026-10-29-unified-home-creation/code-review-pnpm-build-blocked.log)。首个 TypeScript 错误为 `apps/api/src/briefs.test.ts:21` 的配置缺少必填 `databaseUrl`，随后旧 API 测试将异步 `createApi()` / `createDb()` 当作同步值使用，出现 `Promise<Server>` 无 `listen`、`Promise<PgDatabase>` 无 `prepare` 等错误。Web 和 Desktop 各自构建通过。
- `git diff --check` **未通过**：[输出](./evidence/2026-10-29-unified-home-creation/code-review-diff-check.log) 记录 API 的 generation-worker、prompt-ideas、render-worker、runs、server、sync、video-edits 等文件共 16 处新增行尾空格；需在并行迁移改动稳定后清理并重跑。此项不属于产品用例。

A04 网页“导出整集”、真实视频供应商调用、原生创建后重开与跨端同步依旧不在本轮通过范围内。

## 复审剩余 P2：桌面创建响应丢失恢复（21:28）

- **同一路径原文匹配：聚焦通过。** 模拟 native 创建已写盘、IPC 响应丢失，前端打开同一路径，核对项目名称及唯一首条原文的 `source/originalText/finalText/ideaSetId/variantId`；复用磁盘上的 brief ID，保存后仍只有一条，不再调用第二次 create。`apps/desktop/src/App.test.tsx` 对应用例实跑通过。
- **初次打开失败后重试：聚焦通过。** 第一次 create 报“IPC response lost”、第一次 open 暂时失败；用户再次点击后 create 报目录已存在，再次 open 成功，保存的原文仍为磁盘唯一 brief。对应实跑通过。
- **同名不同原文：聚焦通过。** 模拟同名目录已有另一条剧本，前端保持 S1 和错误提示，不调用 save，也不把该路径写入最近项目。对应实跑通过。
- 命令：`pnpm --filter @ai-video/desktop exec vitest run src/App.test.tsx -t 'on-disk brief|retries a lost native response|same-name folder' --maxWorkers=1`，**3/3**；`pnpm --filter @ai-video/desktop test`，**7 文件 34/34**；`pnpm --filter @ai-video/desktop build`，TypeScript 与 Vite **通过**。
- 边界：上述是独立执行的 React 测试，native port 以可控故障模拟。Mac 锁屏，本轮没有真实 `.app` 进程崩溃/IPC 丢响应与重启的原生窗口验收；不会将它写成端到端通过。前节所记全工作区 `pnpm test/build` 阻断为 21:06 时点的观察，未因本轮 Desktop 单包通过而改写。

## 最终 P1 复审：唯一创建意图与跨重启恢复（21:52–21:54）

上一节 P2 只区分“同名但原文不同”，未覆盖同名同文本的旧项目。本轮开发把 `root/title/brief` 作为待完成意图写入本机 `localStorage`，恢复时要求磁盘上唯一 brief 的 ID、来源、原文、最终内容、Agent 引用与时间戳全部匹配；成功保存后清除 pending。独立 QA 针对新边界重新执行下列用例：

| 场景 | 结果 | 实测观察 |
| --- | --- | --- |
| native 创建已落盘但 IPC 回包丢失 | 通过 | 创建调用前 pending 已含原 brief ID；同路径打开后保存磁盘原 brief，不重复创建或追加；成功后 pending 清除。 |
| 后续 save 失败并跨组件重挂载恢复 | 通过 | save 失败时 pending 保留且最近项目未写入；重新挂载后点“查询原项目”，复用原 ID、同一条 brief，成功后清 pending。该重挂载模拟应用重启，未在真实 `.app` 重启操作。 |
| IPC 丢失、首次 open 暂时失败、跨组件重挂载 | 通过 | pending 跨重挂载保留，第二次查询打开同一项目，create 仅一次，保存唯一原 brief。 |
| 同名同文本的旧项目，但 brief ID 不同 | 通过 | 不认领、不保存、不写最近项目，S1 保持错误提示。 |
| 磁盘 brief 匹配但 pending 意图已消失 | 通过 | 不自动认领该目录，不保存、不写最近项目。 |
| 另有未完成意图时启动不同作品 | 通过 | “查询原项目”先阻断新建；用户明确点“另起新项目”后使用新 brief ID 创建。 |

命令结果：聚焦 `pnpm --filter @ai-video/desktop exec vitest run --dir src -t 'recovers an atomically|on-disk brief|restores a pending creation|same-name folder|same-name and same-text|pending intent disappeared|explicit new attempt' --maxWorkers=1` 为 **7/7**；`pnpm --filter @ai-video/desktop exec vitest run --dir src` 为 **7 文件 37/37**；`pnpm --filter @ai-video/desktop build` TypeScript 与 Vite **通过**；`git diff --check -- apps/desktop/src/App.tsx apps/desktop/src/App.test.tsx apps/desktop/src-tauri/src/project.rs` **通过**。

测试发现范围说明：并行打包期间，root 曾观察到默认 Desktop `vitest run` 扫描 `src-tauri/target/release/bundle/dmg/stage/Applications` 内另一应用的 17 个测试文件，因此本轮主门禁显式限制 `--dir src`。QA 在 21:53 检查时该 `stage/Applications` 已不存在，随后独立执行默认 `pnpm --filter @ai-video/desktop test` 也为 **7 文件 37/37**；不能把之前的污染描述为当前仍可复现的失败。QA 没有删除任何打包产物。

本轮 Mac 锁屏，未进行原生 GUI 操作。以上是 Desktop 应用逻辑的独立自动化复测；真实 `.app` 进程中断、IPC 回包丢失及重启恢复仍待原生验收。此前全仓 API PostgreSQL 迁移的 `pnpm test/build` 阻断记录对应 21:06；当前构建状态以下方最后一次快照为准。

### 最后一次全仓快照

- 21:54 后独立复跑 `pnpm build`：**通过**，API、Web、Desktop、Mobile 与共享包 TypeScript 构建完成，Web/Desktop Vite 产物完成；[完整日志](./evidence/2026-10-29-unified-home-creation/final-pnpm-build-passed.log)。这取代前述 21:06 的构建失败作为当前构建结论，失败日志仍保留以说明迁移中间状态。
- 同轮独立复跑 `git diff --check`：**通过**。前述 API 16 处行尾空格是历史中间状态，当前已清理。
- 21:57 root 再次运行 `pnpm test`：**未通过**。API 阶段共 36 个失败用例，`apps/api/src/test-db.ts:18` 明确报 `TEST_DATABASE_URL is required for PostgreSQL API tests`；模拟模型 HTTP 用例还因默认沙箱禁止绑定 `127.0.0.1` 报 `listen EPERM`。这次失败不能当作上述桌面修复的产品断言失败，也不能计为全仓通过。Desktop 当前默认测试与 `--dir src` 均为 37/37。

## Web 项目库导航竞态修复与最后全仓测试（22:08）

root 使用隔离临时 PostgreSQL 的首次全仓测试发现 Web 项目库竞态：用户点“全部项目”后，账号恢复 effect 的迟到 `setView("home")` 覆盖项目库页签。[修复前完整失败日志](./evidence/2026-10-29-unified-home-creation/postgres-full-test-web-fail.log)记录 Web **1/27 失败**，对应测试找不到“还没有项目”标题。前端已将回首页限定于明确登录成功或退出。

独立 QA 在修复后执行项目库创建与各页签空状态聚焦测试 **2/2** 通过；`pnpm --filter @ai-video/web test` 为 **6 文件 27/27**，`pnpm --filter @ai-video/web build` 的 TypeScript 与 Vite **通过**。Mac 仍锁屏，本轮没有真实浏览器点击。这是 Web 自动化复测，不扩充原生 UI 的已验范围。

随后 root 用 `TEST_DATABASE_URL` 指向隔离临时 PostgreSQL、在受控本机 loopback 环境运行全仓 `pnpm test`，报告命令退出码 **0**。QA 核对其[完整日志](./evidence/2026-10-29-unified-home-creation/final-pnpm-test-postgres-passed.log)：API **65/65**、Web **27/27**、Desktop **37/37**、ui-web **20/20**、project-core **31/31**，其余包通过，`Workspace boundaries: OK`。**这轮全仓测试由 root 启动，非本 QA agent 亲自运行**；它取代前述 21:57 的环境失败作为最新全仓测试结论。上一轮的 `pnpm build` 和 `git diff --check` 已独立通过。真实视频供应商、网页整集导出与原生 IPC 崩溃恢复的验收边界仍如上文。

## 2026-10-30 账号隔离与项目竞态最终复测

前端停改后，独立 QA 对 Web 新增的八个故障场景逐项实跑：A 账号项目/灵感列表迟到后切 B、旧 `/auth/me` 回包、旧项目详情回包、旧 S1 读取完成后企图写原文、A 账号命令未决时 B 编辑、旧照片上传回包企图结束 B 的文件选择、同账号连续快切两个项目，以及登出后邮箱/密码清空。聚焦 `vitest` **8/8**、Web 全包 `pnpm --filter @ai-video/web test` **6 文件 35/35**、`pnpm --filter @ai-video/web build` TypeScript/Vite **通过**；`git diff --check -- apps/web/src/App.tsx apps/web/src/App.test.tsx` **通过**。断言包括 B 项目与灵感不被 A 的迟到列表覆盖、旧 S1 不发 brief 命令、B 可继续发自己的编辑命令、同账号快切保留最后选择，以及清空登录表单。

真实 Chrome 使用[本机隔离 A/B 模拟 API](./evidence/2026-10-29-unified-home-creation/web-account-swap-mock.mjs)和全新 Vite 端口 `127.0.0.1:1432` 实操：A 账号的项目/灵感响应被延迟，登出并以测试凭据登录 B 后，延迟的 A 响应才释放；[B 项目库截图](./evidence/2026-10-29-unified-home-creation/web-account-B-project-library-after-late-A-current.png)只见“B 的项目”，[B 首页截图](./evidence/2026-10-29-unified-home-creation/web-account-B-home-idea-after-late-A-current.png)只见“B 的灵感”。B 登录时实际输入过邮箱和测试密码，再次登出后 Chrome 无障碍树中邮箱、密码均无值，[空表单截图](./evidence/2026-10-29-unified-home-creation/web-account-logout-empty-form-current.png)为该次登出后所拍。三张均为**真实浏览器运行页面，但后端是本机模拟服务**；旧 auth/me、项目详情、S1、命令、照片上传和同账号快切的异步边界由自动化测试覆盖，不能拿这三张图冒充各场景的端到端截图。QA 已关闭隔离浏览器页与测试服务；旧 `127.0.0.1:1421` Vite 错误覆盖页未用作证据。

root 对最终代码另以隔离 PostgreSQL 和受控 loopback 运行全仓 `pnpm test`，报告退出码 **0**。QA 独立核对[完整测试日志](./evidence/2026-10-29-unified-home-creation/final-pnpm-test-postgres-after-account-fix.log)：API **65/65**、Web **35/35**、Desktop **37/37**、ui-web **20/20**、project-core **31/31**，`Workspace boundaries: OK`；另核对[全仓构建日志](./evidence/2026-10-29-unified-home-creation/final-pnpm-build-after-account-fix.log)完成。`git diff --check` 由 root 报告通过。**全仓命令由 root 启动，不是本 QA agent 亲自执行**；上述 Web 聚焦、Web 全包与 Web 构建由 QA 亲自运行。A04 网页整集导出、真实供应商视频生成、桌面原生崩溃恢复仍未验收。

## 2026-10-30 登出网络失败复审

终审发现此前 `logout` 网络失败时仍清本地账号，服务端会话可能未撤销。前端修复为：登出请求失败后查询服务端 `/auth/me`；服务端仍确认原账号 A 时界面保留 A、显示失败并允许重试；登出与会话查询均失败时保持 A 可见并显示“退出状态无法确认”，在消歧前阻断其他账号操作；只有确认服务端已退出时清本地账号。

独立 QA 在最终停改后实跑两条新聚焦用例 **2/2**：第一次登出抛网络错误且 `/auth/me` 仍返回 A 时，A 邮箱保留、登录表单不出现，第二次点击退出成功；登出与会话查询双断网时，显示待确认提示，A 仍保留、登录表单不出现。`pnpm --filter @ai-video/web test` 为 **6 文件 37/37**，`pnpm --filter @ai-video/web build` TypeScript/Vite **通过**，Web 相关 `git diff --check` **通过**。

QA 已准备[首次登出断网的本机模拟服务](./evidence/2026-10-29-unified-home-creation/web-logout-fail-once-mock.mjs)，但打开真实 Chrome 故障页时 CUA 报用户正在切换 Chrome；刷新状态显示用户正在使用另一网页进行麦克风面试。QA 立即停止浏览器操作，并关闭隔离服务，**没有取得本次 P1 修复后的新截图**。上一节的三张 B 账号/登出空表单截图属于此 P1 修复之前的版本，仍可作为当时账号隔离与正常登出的历史证据，不能证明本次网络失败恢复。该边界目前仅有自动化通过证据；真实浏览器故障操作待用户空闲时补验。

上一节 root 的隔离 PostgreSQL 全仓 `pnpm test` **35/35 Web** 日志属于此 P1 修复前快照。root 已对本次修复后的最新代码再次运行隔离 PostgreSQL 全仓 `pnpm test`、`pnpm build` 与 `git diff --check`，报告三者退出码均为 **0**。QA 独立核对[最终测试日志](./evidence/2026-10-29-unified-home-creation/final-pnpm-test-postgres-after-logout-fix.log)：API **65/65**、Web **37/37**、Desktop **37/37**、ui-web **20/20**、project-core **31/31**，`Workspace boundaries: OK`；[最终构建日志](./evidence/2026-10-29-unified-home-creation/final-pnpm-build-after-logout-fix.log)显示 API、Web、Desktop 等各包构建完成；QA 同时独立运行 `git diff --check`，结果通过。**隔离 PostgreSQL 全仓测试及构建由 root 启动，QA 核对日志，非 QA 亲自运行**。真实浏览器 logout 网络故障操作仍待补验。
