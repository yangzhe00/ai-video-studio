# 首页统一创作入口：独立代码审查

日期：2026-10-29。依据：[PRD](../product/2026-10-29-unified-home-creation-prd.md)、[独立验收](./2026-10-29-unified-home-creation.md)、当前工作区代码及 Git diff。本轮只读审查；以下问题尚未修复，严重度按影响排序。

## 发现

### P1 · 桌面创建项目与首条原文分两次落盘，重启后无法恢复

- **位置**：`apps/desktop/src/App.tsx:124-139`；`apps/desktop/src-tauri/src/project.rs:105-131`。
- **触发**：在桌面首页输入剧本，S1 选择“新建项目”并提交。native `create_project` 先写出不含 `creationBriefs` 的 `project.json`，前端再调用 `projects.save` 写入首条原文。若进程在两次写入之间退出，或者首次保存失败后退出，磁盘上留下空白项目。`workLocalCreate` 仅存于 React state，重启后丢失；再次选择相同目录执行 `create_project` 会因目录已存在被拒。
- **影响**：用户以为已创建的作品没有剧本，且无法从首页按原创建意图一键恢复。现有 `apps/desktop/src/App.test.tsx:64-81` 仅覆盖同一进程内首次保存失败后重试，没有跨重启测试。与 PRD 的“新建项目与原文同一次可恢复创建意图”和 A04/A06/A12 不符。
- **建议验收**：把首条原文纳入 native 创建时的同一次原子写入，或持久化含项目根目录及 brief ID 的待完成意图并在启动时恢复；故障注入在第一次落盘后退出，重开必须得到同一个项目和同一条原文。

### P1 · 桌面“加入已有项目”忽略用户选定的目标分集

- **位置**：`apps/desktop/src/App.tsx:140-153`。分集切换的正确入口是 `packages/project-core/src/studio.ts:121-130` 的 `selectEpisode`。
- **触发**：在有两集的本机项目中保持第 1 集为 active，首页输入内容，在 S1 选择“加入已有项目”及第 2 集，选择“直接生成一个镜头”或“进入画布编排”，点击“加入项目并继续”。代码只向项目追加 brief，随后 `openProject(next)`，未使用 `selection.episodeId`。
- **影响**：进入原活动集；直生后续计划和画布操作可能落到第 1 集，用户在 S1 的明确选择失效。现有桌面测试 `apps/desktop/src/App.test.tsx:83-127` 只用单集 fixture，未覆盖多集目标。
- **建议验收**：保存 brief 后使用 `selectEpisode(manifest, selection.episodeId)` 并保存切换结果；对直生和画布各补一个多集测试，确认目标分集和视频计划一致。

### P1 · 桌面原文同步冲突仅显示两侧前 800 字，长剧本无法比较

- **位置**：`apps/desktop/src/features/studio/StudioWorkspace.tsx:664-670`；显示组件 `packages/ui-web/src/SyncConflictDialog.tsx:42-58`。
- **触发**：同一条 1000 字以上创作原文在桌面和网页各改结尾，触发 `brief` 资源修订冲突。两侧 JSON 被 `.slice(0, 800)` 截断；若前 800 字相同，弹窗展示完全相同的“本地”和“云端”预览，却仍允许选择“保留本地并覆盖云端”或“采用云端”。
- **影响**：用户无法看到实际差异便可能覆盖其中一版，违反 PRD A08 的双方版本比较。现有 `apps/desktop/src/lib/sync.test.ts:166-198` 验证冲突被检测，但没有验证长文本冲突 UI。
- **建议验收**：brief 冲突显示完整可滚动的 `finalText`、不可变 `originalText` 与来源，并在两侧差异位于 800 字之后时确认差异仍可见。

### P2 · 网页 S1 从加载中的已有项目切回新项目会永久禁用提交

- **位置**：`apps/web/src/App.tsx:335-350`；`packages/ui-web/src/WorkSetup.tsx:59-63`。
- **触发**：S1 选择已有项目，详情 `GET /projects/:id` 尚未返回时点击“新建项目”。effect cleanup 将 `live` 置为 false，原请求的 `finally` 不再清除 `workProjectLoading`；新建目标分支直接 return，也不清除。`WorkSetup` 对新建项目仍以 `!projectsLoading` 为提交条件。
- **影响**：“创建项目并继续”持续禁用，用户必须重新选择已有项目并等待一次成功加载才能继续。慢网络可稳定触发。现有网页测试没有延迟目标项目详情请求后切换目标的用例。
- **建议验收**：切换到新建目标时清除已有项目详情 loading，或让提交条件仅在 `target=existing` 时受其限制；用可控延迟 GET 覆盖切换前后状态。

## 已核对的关键边界

- API `POST /projects` 在 `apps/api/src/server.ts:246-292` 中先校验 brief 和 Agent 归属，项目、首集、brief 资源修订在同一 SQLite 事务写入；`creation_hash` 保持同 ID 同意图重放，异内容返回 409。`apps/api/src/briefs.test.ts:42-69,101-126` 与独立 API 验收覆盖同 ID、账号隔离、Agent 来源及不创建视频任务。
- 已有项目的 brief 命令在 `apps/api/src/sync.ts:128-163` 使用命令 ID、资源修订与 409 当前快照；`assertBriefEdit` 保持原文和来源字段不可变。网页的冲突 UI 经过 A08 修复，独立浏览器验收已确认双版本显示和显式选择。
- 首页 Agent、手写、S1 保存与画布原文展示不直接调用视频审批；`POST /projects/:id/runs` 在 G1 检查计划，`POST /runs/:id/approve` 仍由 G2 确认按钮调用。独立模拟环境证实审批前 `operations=0`、额度未变。真实文字模型、真实视频服务与确认后的单任务链路未在本轮验收。
- 旧云项目迁移为 `briefs: []`，本地 DSL 与云 DSL 投影带入原文；桌面 sync 的 `brief` 独立资源可 push/pull，并在同一条原文双端编辑时抛修订冲突。现有测试覆盖单资源冲突与独立原文拉取；上述桌面重启、目标分集、长文本冲突 UI 仍需补测。
- 网页“导出整集”已有缺口见独立验收 A04；本次没有把它判为统一首页改动引入的回归，也不计为本需求通过。

## 审查范围与方法

检查了 `apps/api/src/server.ts`、`sync.ts`、`briefs.ts`、`db.ts`、`cloud-document.ts`，`packages/project-core/src/brief.ts` 与 DSL 迁移，`packages/ui-web/src/PromptIdeas.tsx`、`WorkSetup.tsx`、`SyncConflictDialog.tsx`，Web/Desktop App、桌面同步与 StudioWorkspace、画布原文面板及相应测试。新文件中有尚未纳入 Git 的源码，已直接读取，不只依赖 `git diff`。复现路径依据代码控制流与现有测试断言；本审查未改产品代码，未将尚未执行的故障注入写成已实测通过。

## 第二轮复审（修复后）

复审日期：2026-10-29。保留以上原始发现作为历史记录；本节记录当前代码状态。

| 原发现 | 复审结果 | 证据 |
| --- | --- | --- |
| P1 桌面创建与首条原文分两次落盘 | **原数据丢失路径已关闭** | `apps/desktop/src/App.tsx:131` 将 brief 传入 native；`apps/desktop/src-tauri/src/project.rs:148-185` 先在同父目录的暂存目录写出含 brief 的完整项目，再 rename 到正式目录。`project.rs:268-289` 检查首次可见项目即含原文、无效 brief 不建目录；`App.test.tsx:66-88` 检查随后一次前端保存失败时，同进程重试不另建文件夹。 |
| P1 桌面忽略 S1 目标分集 | **已关闭** | `apps/desktop/src/App.tsx:143-150` 对已有项目调用 `selectEpisode(withBrief, selection.episodeId)` 后保存；`App.test.tsx:90-116` 分别验证 direct/canvas 指向第 2 集。 |
| P1 长 brief 冲突预览截断 | **已关闭** | `StudioWorkspace.tsx:35-40,672-680` 向弹窗传完整 brief；`packages/ui-web/src/SyncConflictDialog.tsx:52-56` 展示来源、完整输入原文和最终内容；样式 `styles.css:64-68` 允许区域内滚动。`SyncConflictDialog.test.tsx:41-57` 验证超过 800 字后的不同结尾可见。 |
| P2 Web 切回新项目后 loading 卡住 | **已关闭** | `apps/web/src/App.tsx:335-353` 在不查询已有项目时清除 loading，`App.tsx:808-809` 仅对 existing 目标传 loading/error；`App.test.tsx:236-260` 用延迟 GET 复现原竞态并验证切换前后可提交。 |

**剩余 P2 恢复体验风险**：桌面 native 创建已把原文安全落盘，但 `App.tsx:128-132` 仍在 `await projects.create(...)` 返回后才记录 `workLocalCreate`，且该状态只在内存。如果 native 已 rename 成功，而 IPC 返回丢失或应用恰在返回前退出，用户下次通过首页选同名目录会看到“目录已存在”，需要手动“打开已有项目”找回。原先“空白项目/原文丢失”风险已消除；仍建议在此异常路径明确提供“打开已创建项目”入口，或持久化创建意图。现有测试未模拟 native 成功但 invoke 返回丢失与应用重启，不把它计作已验收。

**本轮聚焦门禁**：复审独立运行 `apps/web` 的 `vitest run src/App.test.tsx --environment jsdom` 为 16/16，`apps/desktop` 同命令为 13/13，`packages/ui-web` 的 `vitest run src/SyncConflictDialog.test.tsx --environment jsdom` 为 3/3。Rust project 7/7 由独立 QA 报告通过，本审查未重复运行。全工作区 `pnpm test` / `pnpm build` 当前受并行 PostgreSQL API 迁移中间状态阻断，不能把上述聚焦通过写成全量通过；待迁移收敛后仍需重跑完整门禁。本轮修复路径未发现新的 P0/P1。

## 第三轮复审（桌面 IPC 返回丢失恢复）

复审日期：2026-10-29。原 P2 的“native 已建项目但调用方没收到返回”路径现在会在 `create` 抛错后打开目标目录，读取首条原文；同内容则继续使用磁盘上原有 brief，不重复追加。`apps/desktop/src/App.test.tsx:90-130` 的丢返回和二次重试用例通过。本审查独立重跑该文件为 **16/16 通过**；Desktop 全包 34/34 与 build 由独立 QA 报告通过。以下新发现使该 P2 **尚不能安全关闭**。

### P1 · 同名同文本的旧项目会被误认作本次创建成功

- **位置**：`apps/desktop/src/App.tsx:20-24,139-161`；相关测试 `apps/desktop/src/App.test.tsx:90-109,132-148`。
- **触发**：本机已有项目目录 `/parent/小狗端菜`，标题“小狗端菜”，只有一条手写 brief，原文与最终内容均为“小狗端菜”，brief ID 为旧 ID。用户从首页再次以相同名称和内容明确选择“新建项目”。native `create_project` 正常返回“目录已存在”；前端 catch 对任何创建错误都尝试打开旧目录。`sameCreationContent` 忽略 brief ID、创建时间和任何创建意图令牌，因而接受旧 brief，随后 `projects.save` 并 `openProject` 进入旧项目。
- **影响**：用户以为建了新项目，实际打开原项目；后续手动拆镜或确认生成可能写入错误作品。旧项目若已关联其他账号，同一内容也可能先被误打开再在同步环节失败。负例只覆盖“同名但文本不同”；正例中磁盘 brief ID 与当前新生成 ID 不同，恰好证明仅凭内容无法识别本次创建。
- **建议验收**：调用 native create 前持久保存稳定创建 ID/nonce，并写入项目 manifest；仅当磁盘令牌等于本次意图时自动恢复。若无匹配令牌，保留“目录已存在”错误并提供显式打开已有项目入口。补“同名同文本但不同令牌、旧项目已有节点”的拒绝测试，以及“同令牌 IPC 丢返回、重启后恢复”的通过测试。只比较时间戳或文本不足以确证归属。

**门禁边界**：该发现来自源码控制流与现有测试夹具的反例分析，尚未由独立 QA 在真实桌面窗口执行；不可把当前 Desktop 34/34 解释为该误认路径通过。并行 PostgreSQL API 迁移期间的全仓 `pnpm test` / `pnpm build` 状态仍以单独门禁记录为准。

## 最终复审（持久创建意图与严格认领）

复审日期：2026-10-29。第三轮 P1 **已关闭**；其历史描述和当时的门禁边界保留在上方。

- `apps/desktop/src/App.tsx:18-49` 以持久的 `PendingLocalCreate` 保存 `root/title/brief`。`samePendingBrief` 要求 brief ID、创建与更新时间、来源、原文、最终内容及 Agent 草案/版本 ID 全部匹配；磁盘项目还需标题一致且恰好一条 brief。由 `crypto.randomUUID()` 生成并由 native 首次写入 manifest 的 brief ID 已可充当本创建意图的唯一令牌；本轮未发现必须另设 nonce 才能防止误认领的具体路径。
- `App.tsx:176-199` 在调用 native `create` **之前**把意图写入 `localStorage`；IPC 抛错后只在持久意图仍存在、目标 root/title 相同、磁盘 brief 与意图严格匹配时自动认领。普通“目录已存在”的同名同文旧项目因 brief ID 不同而拒绝。`App.tsx:118-125,155-175` 支持重启后从相同内容恢复旧意图和原 brief ID；`App.tsx:203-229` 在保存并打开成功后清理相应待建记录。
- `apps/desktop/src/App.test.tsx:67-157,177-213` 覆盖首次后续保存失败并重启、IPC 丢返回、跨重启查询、同名同文不同 ID 拒绝、待建记录消失时拒绝；`App.test.tsx:215-234` 检查不同意图需明确另起新项目。本审查独立重跑 `App.test.tsx` 为 **19/19 通过**。独立 QA 报告本修复相关 7/7、Desktop 全包 37/37 和 Desktop build 通过。
- **结论**：四项原发现、第二轮剩余 P2 和第三轮新增 P1 的主触发路径，至此均已在代码和聚焦测试中关闭；本次只读复审未发现新的 P0/P1。用户手动复制一个包含相同 UUID brief 的项目文件夹属于外部复制场景，现有令牌设计无法区分副本，但没有证据表明它是本次创建流程的现实碰撞路径；不以此要求额外 nonce。

**全仓门禁仍单列**：root 报告当前 `pnpm build` 与 `git diff --check` 通过；21:57 的全仓 `pnpm test` 受并行 PostgreSQL API 迁移所需 `TEST_DATABASE_URL` 缺失及沙箱 loopback `EPERM` 阻断，不能记为全量测试通过。上述 Desktop 聚焦通过不替代 API 迁移收敛后的全仓复跑。

## Web 项目库导航竞态复审

复审日期：2026-10-29。`apps/web/src/App.tsx:145-152` 的账号恢复 effect 现只加载项目和灵感，不再对 `view` 写入 `home`；明确登录成功和退出登录分别在 `App.tsx:266-282` 回首页。账号恢复后用户打开项目库不会再被该 effect 的 `setView("home")` 覆盖。独立重跑 Web `App.test.tsx` **16/16 通过**；独立 QA 报告相关聚焦 2/2、Web 全包 27/27。root 报告隔离 PostgreSQL 的全仓 `pnpm test` 最新 exit 0（API 65、Web 27、Desktop 37，workspace boundaries OK），`pnpm build` 与 `git diff --check` 通过；此前 21:57 因环境受阻的记录保留为历史轮次。

### P1 · 旧账号异步响应可在退出或切换账号后写入新会话状态

- **位置**：`apps/web/src/App.tsx:145-152,190-203,266-282`。
- **触发**：A 账号登录时发出 `GET /projects`、`GET /prompt-ideas`，让响应延迟；A 退出并明确登录 B 后，A 的旧响应晚于 B 登录返回。`loadProjects` 和 `loadIdeas` 没有捕获并核验发起时的账号 ID/会话代际，仍会执行 `setProjects(A rows)`、`setRecentIdeas(A rows)`，且 `setIdeaSet(current => current ?? A rows[0])` 可在清空后装入 A 灵感。启动的 `GET /auth/me` 同样没有过期保护，若旧 cookie 下的响应晚于 B 登录或退出，也可 `setAccount(A)` 覆盖当前身份。
- **影响**：B 的首页或项目库可能短暂显示 A 的项目标题、灵感原文；若 A 的响应最后完成，旧数据会一直显示到再次刷新。服务端项目 GET 仍有账号隔离，但客户端展示泄露私有创作资料。这一问题不是移走 `setView("home")` 新引入，却属于本轮要求核查的登录/登出账号隔离。
- **建议验收**：在明确登录、退出及账号恢复开始/完成时维护会话 epoch，并让 `auth/me`、项目和灵感请求只在 epoch 与发起时一致且当前账号 ID 一致时落 state；或者用 abort + epoch 双保险。补延迟 A 请求→退出→B 登录→A 晚返回的测试，断言 B 页面无 A 标题、灵感且身份仍为 B；另补旧 `auth/me` 晚返回不得覆盖明确登录/退出。

**结论**：项目库被账号恢复 effect 拉回首页的导航回归已关闭；上述客户端账号隔离 P1 仍待修复与聚焦复测。全仓测试通过证明当前自动化门禁，但尚未覆盖这一异步交错路径。

## 最终复审：账号切换、异步回包与异常退出（2026-10-30）

本节复审修复后的当前代码。上方“待修复”是当时的历史结论，以下结论取代它。

| 历史风险 | 当前结论 | 代码与测试依据 |
| --- | --- | --- |
| P1：A 账号的项目、灵感和 `/auth/me` 晚返回污染 B | **已关闭** | `apps/web/src/App.tsx:167-205,249-308` 以账号 ID 和 epoch 拦截旧成功/失败响应；明确登录、登出在 `App.tsx:353-385` 先失效旧 epoch。`App.test.tsx:554-599` 延迟 A 列表和启动身份回包后验证 B 内容及身份不被覆盖。 |
| P1：旧 S1/项目操作在 B 会话续写，或旧命令堵住 B 的队列 | **已关闭** | `App.tsx:310-350,514-589` 的项目打开和 S1 提交逐次核验会话；恢复分支识别 `StaleAccountResponse`，不会把账号切换当网络丢包再发 GET/POST；`App.tsx:353-385,592-628` 在切换时重置队列及锁，命令开始和回包时均校验账号和目标项目。`App.test.tsx:661-763` 覆盖旧项目详情、S1 读取后阻断命令、A 命令未决时 B 可编辑。 |
| P2：旧照片上传回调结束 B 的文件选择；同账号快切项目被先前慢请求覆盖 | **已关闭** | `App.tsx:721-736,1202-1209` 将选图 resolver 绑定 generation 和账号 scope；`App.tsx:310-350` 的项目打开序号只接受最后一次选择。`App.test.tsx:764-836` 对旧上传与慢项目详情使用可控延迟响应。 |
| P1：退出请求失败仍展示登录页，服务器会话可能继续有效 | **已关闭** | `App.tsx:375-430` 在退出错误后用 `/api/auth/me` 查证：401 才清本地账号；确认原账号仍在则保留账号并提示重试；查证也失败时保留可见账号、标明状态无法确认并阻断其他账号操作；观察到另一账号时先清旧工作态，再激活新账号。`App.test.tsx:618-659` 覆盖原账号仍有效的重试和双断网待确认。 |
| 登出后旧邮箱与密码仍在表单 | **已关闭** | `App.tsx:369,421` 清除密码及登出后的邮箱/密码；`App.test.tsx:600-616` 验证。 |

**独立代码判断**：账号相关的 `requestApi` 仅用于登录、退出和启动身份恢复，其他项目/灵感/视频 API 经 App 内带 epoch 的 `api` 包装；`uploadObject` 虽独立发送，但上传后须先通过原账号 scope 才能附加素材。`sendCommand` 的冲突恢复分支在旧账号错误时直接退出，不会以 B 的 cookie 续发旧命令。SSE 与渲染轮询在切换时关闭或因 scope 失效停止回写；画布异步错误和三个内联任务刷新入口亦只向当前账号落状态。复审未发现尚未关闭的 **P0/P1/P2** 代码缺陷。

**证据边界**：独立 QA 最新 Web 聚焦登出故障 **2/2**、Web 全包 **37/37**、Web build 通过，详见[验收记录](./2026-10-29-unified-home-creation.md)；root 的隔离 PostgreSQL 全仓测试退出码 0，QA 核对[完整日志](./evidence/2026-10-29-unified-home-creation/final-pnpm-test-postgres-after-logout-fix.log)，包含 API 65、Web 37、Desktop 37 和边界检查。root 全仓 build 与本审查的 `git diff --check` 均通过。Chrome 中 A/B 切换的三张截图是登出故障修复**之前**的真实网页加本机模拟 API 证据；本次异常退出修复仅有自动化测试，用户使用 Chrome 时 QA 停止操作，未取得修复后的故障截图。真实视频服务、原生崩溃重启与网页整集导出仍属各自验收范围，不能由本轮代码复审代替。
