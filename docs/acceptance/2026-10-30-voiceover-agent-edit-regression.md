# 配音、Agent 剪辑与 PostgreSQL 发布回归

日期：2026-10-30（北京时间）。**当前状态：冻结源码归档的隔离 API 已完成 V03/V04 新项目独立复测并通过；Web 完成此前本地 GUI 检查，桌面当前开发实例完成配音入口、预览与导出 GUI 复测；Agent 模型与真实 TTS 未通过，新版尚未发布公网。** 下方原定用例表保留验收范围；实际结果、失败与修复复测见文末执行记录。旧发布截图、旧测试数量及官网既有发布记录不计入本轮配音/Agent 结果。

## 版本与环境门禁

| 项目 | 当前值 | 剩余验收要求 |
| --- | --- | --- |
| 仓库当前 `HEAD` | `dc066d22277808c425517d66aff9acc31e6eef55`，工作树有并行未提交修改；本轮音频修复候选源码归档 SHA-256 `648bff4b2475260b0a10b1d81198a542aac2dacdb97d5bba3902e8206d711b2d`，QA 独立重算一致 | 发布前仍需把 API、Web、桌面包与共享契约对应到同一归档或重建后的新归档。仅 `HEAD` 不足以标识脏工作树。 |
| 现有线上发布 | 官网记录为 `20261030-official-04`；该记录早于本轮配音和 Agent 剪辑候选 | 发布方给出本轮新 release、镜像 digest、静态资源哈希、数据库 schema、切换时间及健康检查。 |
| 隔离联调 | `http://127.0.0.1:8787` API 在冻结候选后重启，隔离 PostgreSQL 新建项目复测 V03/V04 通过；此前 `http://127.0.0.1:1421` Web GUI 已检查。凭据仅存于 0600 的 `/private/tmp/avs-integration-credentials.json` | 桌面 GUI、真实 TTS／Agent 服务和正式发布后在线回归仍需完成；真实付费调用须先确认测试额度与操作。 |
| 当前可用媒体工具 | 仓库内 macOS FFmpeg／ffprobe 已用于生成下述素材 | 候选服务器和桌面运行环境分别验证自己的 FFmpeg／ffprobe；不能以开发机通过替代 Linux。 |

联调实测：Web 的镜头与整集配音面板均有原始录音试听和独立的“合成预览”；隔离 API 的 5 秒镜头、10 秒整集预览与正式导出已生成 MP4，并以 `ffprobe`、频率分析和字节哈希核对一致，证据见文末 V03/V04。后端修复分集边界静音后，旧失败与新通过分别留档；冻结候选重启后又用新项目独立复测通过。桌面当前开发实例的配音预览与导出核心路径已复测；真实 TTS 及 Agent 模型调用仍未通过端到端验收。

需求补充（待执行验证）：Kling 2.5 Turbo 当前只支持 5／10 秒，第一版**新生成固定 5 秒**，不提供新建 10 秒；历史 10 秒项目仍可读取、编辑、导出。线上文字配音须先展示明确的“可灵按实际结果扣费”提醒，再经独立的二次确认提交；没有可验证价格时不得显示虚构预估金额。

本轮绝不把普通配音称作“对口型”；口型同步不在范围内。测试只编辑 `docs/acceptance/` 报告与证据，不修改业务代码。

## 固定素材

全是合成素材，生成器为 [make-fixtures.mjs](evidence/2026-10-30-voiceover-agent-edit/make-fixtures.mjs)，文件哈希、大小、时长和音视频流见 [fixture-manifest.json](evidence/2026-10-30-voiceover-agent-edit/fixture-manifest.json)。运行 `node docs/acceptance/evidence/2026-10-30-voiceover-agent-edit/make-fixtures.mjs` 已以退出码 0 生成 13 个文件；`ffprobe` 校验了有效文件。

| 用途 | 文件（均位于 `evidence/2026-10-30-voiceover-agent-edit/fixtures/`） |
| --- | --- |
| 参考照片 | `reference.jpg`，320×180 JPEG |
| 5／10 秒源片、无声／有声 | `shot-silent-5s.mp4`、`shot-audio-5s.mp4`、`shot-silent-10s.mp4`、`shot-audio-10s.mp4`；有声源片含 AAC 音轨 |
| 配音格式与长度 | `voice-5s.wav`、`voice-5s.mp3`、`voice-5s.m4a`；`voice-short-2s.wav`、`voice-long-12s.wav` |
| 背景音乐 | `music-12s.wav`，与配音使用不同频率，便于听辨三路混音 |
| 错误输入 | `broken.mp3`（扩展名伪装）、`empty.wav`（零字节）；超限文件按候选实际大小限制临时生成并记录哈希 |

## 用例表

下表是开测前固定的用例范围和原始状态。实际执行状态与证据以文末“本地候选执行记录”为准。每处“确认”只在隔离或已明确额度的测试环境点击。

| ID | 步骤与可判定预期 | 本轮证据要求 | 状态 |
| --- | --- | --- | --- |
| P01 | 核对冻结源码 SHA、API 镜像 digest、Web 哈希与同一候选；完整 `pnpm test`、`pnpm build`、Rust 定向测试、契约与 `git diff --check` 记录退出码。 | 版本清单、原始日志、失败项 | 未执行 |
| P02 | PostgreSQL 切换前停旧写入、备份活动 SQLite 和完整媒体目录；仅备份副本升 schema 9→10，再导入空 PostgreSQL。源／副本／目标逐表计数一致、`missingObjectFiles=0`，旧库字节不变。 | 备份与迁移摘要、版本、表计数、对象核对；不记录密钥 | 未执行 |
| P03 | 新 API 单实例健康，旧账号登录并读取旧项目／分集／素材；新账号创建项目、画布读取、照片上传、资产读取。新 PostgreSQL 开始写入后不得用旧 SQLite 快照直接回滚。 | 线上版本截图、HTTP 状态、数据核对 | 未执行 |
| P04 | 真实文字灵感生成恰好三条不同 5–10 秒单镜头方案；选择／编辑／刷新保留，失败有恢复；无视频 operation 与视频额度变化。 | 三方案与失败状态截图、任务／额度只读差异 | 未执行 |
| P05 | 无登录访问受保护资源为 401；跨账号项目／素材不可读取；非法媒体与非法请求有一致 HTTP／`code`；SSE 以原事件序号恢复，不重复付费提交。 | 脱敏请求日志及响应码 | 未执行 |
| P06 | 生成意图、显式确认及任务恢复引用同一 operation／外部 ID；重复确认不产生第二次供应商 POST。真实视频调用仅在确认的测试额度和操作内执行。 | 运行事件、额度账本、恢复截图 | 未执行 |
| P07 | 第一版新建视频在 Web／桌面只给出 5 秒，直接向 API 提交新建 10 秒请求也被明确拒绝，且没有运行、额度或供应商请求；用迁移前的 10 秒项目验证仍可读取、编辑、配音和导出，旧素材不被改写。 | 新建限制页面、API 错误码、旧 10 秒项目编辑／导出截图与版本记录 | 未执行 |
| V01 | 镜头和分集都能看到上传录音与可灵 TTS 两入口；上传 WAV／MP3／M4A 中实际支持格式，按内容探测并保存为同一种 `voice` 资产。损坏／空／超限／跨账号素材有明确错误。 | 上传录音、错误提示、素材元数据截图与 `ffprobe` | 未执行 |
| V02 | TTS 显示声音和文案；有可验证价格才显示金额，否则明确提醒“实际扣费以可灵结果为准”，不得填假预估。线上提交前有独立二次确认；取消或未确认不调用供应商。等待／成功／权限不足／超时／结果不明、刷新和重复确认状态可恢复；先查询原任务，避免第二笔付费。TTS 完成不自动渲染。 | 费用提醒与二次确认、取消后零提交、等待及成功或真实阻塞截图、任务 ID／费用状态脱敏记录 | 未执行 |
| V03 | 对新 5 秒和历史 10 秒、无声／有声源片分别测试配音起点、音频入／出点、人声音量、原声及音乐音量；2 秒和 12 秒音频裁剪／截断按配方工作，不意外循环或出现无声尾巴。临时混音预览与正式导出使用同一 FFmpeg 语义，试听内容、时序及音量一致。 | 单镜头混音预览截图、实际播放观察、导出 MP4 与 `ffprobe` AAC 音轨／时长记录；源录音试听不能替代此证据 | 未执行 |
| V04 | 两个 5 秒镜头构成分集，配音跨界连续，原声／音乐混音可听辨；云端整集导出为独立成片，不覆盖原镜头及旧版本。 | 分集时间线和导出截图、实际试听、MP4／`ffprobe` | 未执行 |
| V05 | 草稿保存／刷新恢复不触发渲染；同配方 revision 重复导出只得到同一结果；导出失败保留原片、上一成功版本及可重试任务。旧项目与 V1 配方可读取。 | 版本列表、操作 ID、刷新和错误状态 | 未执行 |
| V06 | Web 与桌面实际打开配音入口，验证忙碌、空、错误、成功状态和键盘可操作性；移动端只核对共享 API／DSL 类型，若无设备标未测。 | Web／桌面截图和类型检查退出码 | 未执行 |
| E01 | Agent 对镜头裁剪、镜头排序、字幕草稿、已确认语音资产配音给出结构化建议；显示理由及前后差异，可逐条接受／拒绝／修改后预览。 | 建议、预览、逐条选择截图 | 未执行 |
| E02 | 预览前后不改变项目 revision、渲染 operation 或视频／TTS 额度；确认后只应用所选编辑草稿，不自动渲染或提交付费任务。双击确认只执行一次。 | 确认前后版本／操作／额度对照、确认截图 | 未执行 |
| E03 | 幻觉 asset ID、跨账号资产、越界时间、未知动作、空建议均拒绝；预览后人工修改造成旧 revision 时返回冲突并保留人工改动。 | 错误码、差异和冲突提示 | 未执行 |
| E04 | 模型超时或解析失败时，人工剪辑仍可进入、保存和导出；原片、历史版本、现有字幕／配音不被 Agent 静默覆盖。 | 失败与人工编辑截图、版本清单 | 未执行 |

## 执行与交付规则

1. 先锁定同一候选 SHA 和环境，保存 `git status`、源码归档哈希、API／Web／桌面构建标识；不要把当前脏工作树的 `HEAD` 当完整版本。区分隔离、本地候选、线上三套结果。
2. 先跑无付费的协议、API、媒体、UI 和数据库门禁；失败用例带步骤、期望／实际、日志与截图反馈对应开发会话。修复后记录新 SHA，对受影响路径及必要回归重测。
3. 线上真实可灵 TTS 只在页面显示实际扣费提醒并由测试账号再次确认后提交，记录供应商实际费用状态；无可信报价时不显示金额。真实视频仍仅在已确认的测试额度和操作中执行。若缺少相应额度或确认，标“阻塞”，改用模拟供应商验证幂等和恢复，不伪称真实成功。
4. 真实试听 MP4，并用候选运行环境 `ffprobe -show_streams -show_format` 记录音轨、时长、编码；截图分别保存上传录音、TTS 等待／成功或真实阻塞、单镜头试听、分集导出、Agent 建议确认、线上部署版本。
5. 正式报告中每项写明通过／失败／阻塞／未测、命令及退出码、HTTP 状态、截图绝对路径；缺陷修复后的结果与首次失败分开记录。证据中不放密钥、Cookie、个人素材或真实账号密码。

## 本地候选执行记录（2026-10-30）

本节保留**冻结前**的首轮执行历史；冻结候选的重新启动和新项目复测另见下一节。本轮在 `http://127.0.0.1:8787` 的隔离 PostgreSQL API、`http://127.0.0.1:1421` 的 Web 测试实例和合成媒体上执行。测试账号凭据只在 `/private/tmp/avs-integration-credentials.json`，未写入证据。没有调用真实可灵视频/TTS，也没有把此结果算作公网发布验收。源码为含并行未提交改动的工作树：初始[快照](evidence/2026-10-30-voiceover-agent-edit/source-snapshot-start.json)相关文件聚合 SHA-256 `75d6498833bae1d99fa2ff2f621b513446ef451d2e189557b0249498abb3796b`；分集修复后[快照](evidence/2026-10-30-voiceover-agent-edit/source-snapshot-current.json)为 `81f36a1e24818c31b848535454b36ca6aa5967784a8c8e850645a78cf731ab4b`；音频/桌面文件修改后本次媒体执行所参照的[快照](evidence/2026-10-30-voiceover-agent-edit/source-snapshot-final.json)为 `ede9080d730655c30570f5fc8d5a974f6699c00ff04c0bb3bc23b6942c21dcf0`。并行开发随后又修改这两个文件，[报告时快照](evidence/2026-10-30-voiceover-agent-edit/source-snapshot-postreport.json)为 `463f97edc9b5068b5f2221d02359d93580079dcede3991146e03791f06f80ab3c`。快照的 Git HEAD 均为 `dc066d22277808c425517d66aff9acc31e6eef55`；HEAD 单独不能标识候选。该阶段 API 进程启动于 13:15:46，晚于 `episode-media.ts` 13:13:05 的修复，早于 `audio-render.ts` 后续修改；当时仍需重启后完整复测，已在下一节完成。

| 用例 | 本地结果 | 独立证据与限制 |
| --- | --- | --- |
| P01 / P02 / P03 | **部分** | 记录了含脏工作树的三个源码快照；隔离账号登录、项目/分集读取、照片/音频/视频上传和本地 PostgreSQL 写入成功。未获得本轮统一冻结归档、完整构建及正式备份/迁移记录；公网仍为先前正式版本。 |
| P07 | **部分通过** | [Web 新建页](evidence/2026-10-30-voiceover-agent-edit/local-candidate-creation-5s.png)显示固定 5 秒；[API 种子记录](evidence/2026-10-30-voiceover-agent-edit/local-api-seed.json)中直接提交 10 秒返回 400，项目运行数 0→0。历史迁移前 10 秒项目读取/编辑/导出未实测。 |
| V01 | **本地通过有效格式与主要错误路径** | 浏览器实际上传 `voice-5s.wav` 并显示 5.0 秒；[WAV/MP3/M4A 与损坏/空文件 API 结果](evidence/2026-10-30-voiceover-agent-edit/local-voice-upload-check.json)：有效素材 200（去重）/201，`durationMs` 分别 5000/5040/5000；损坏和空文件均 400。超 20 MB、跨账号素材未测。[网页配音编辑器](evidence/2026-10-30-voiceover-agent-edit/local-web-voice-editor-reopened.png)。 |
| V02 | **阻塞** | 网页可见文字配音入口；当前费用说明按钮与声音选项禁用。未配置真实可灵 TTS 测试凭据及额度，故未验证二次确认、收费、等待/恢复/成功；没有供应商请求。 |
| V03 | **本地通过 5 秒样例，10 秒旧片待测** | [单镜头 API 记录](evidence/2026-10-30-voiceover-agent-edit/local-media-flow.json)中预览及导出均成功；[ffprobe/频率分析](evidence/2026-10-30-voiceover-agent-edit/local-media-analysis.json)显示两者为相同 5.000 秒 H264+AAC 字节（SHA-256 `99937f…`），0.1 秒仅有 660Hz 原声、1 秒新增 440Hz 配音。网页实际点击“合成预览”后显示可播放；[截图](evidence/2026-10-30-voiceover-agent-edit/local-web-mixed-preview.png)。物理扬声器试听与历史 10 秒片未完成。 |
| V04 | **旧快照失败，修复后本地通过** | 旧[分集音轨分析](evidence/2026-10-30-voiceover-agent-edit/local-episode-analysis.json)与[静音日志](evidence/2026-10-30-voiceover-agent-edit/episode-silence.log)显示 10 秒文件约 5.96 秒后全静音，尽管配方要求人声 3–8 秒、音乐 0–10 秒。后端修改 `episode-media.ts` 后，隔离测试分集保存为 revision 5，再次保存相同配方为 revision 6 避开旧渲染缓存；[新 API 结果](evidence/2026-10-30-voiceover-agent-edit/local-episode-recheck.json)预览/导出 201→succeeded，共用新成片资产。[新音轨分析](evidence/2026-10-30-voiceover-agent-edit/local-episode-after-fix-analysis.json)为 10.000 秒 H264+AAC、预览/导出字节相同；第 6 秒有 440Hz 人声和 220Hz 音乐，第 9 秒仍有 220Hz 音乐。Web 刷新后显示 2 片段/10 秒；[导出成功截图](evidence/2026-10-30-voiceover-agent-edit/local-web-episode-export-lower.png)。此为本地候选，不代表线上已修。 |
| V05 | **部分通过** | 同配方 revision 重复预览/导出返回 200 和相同资产 ID，说明可复用已完成结果；修改 revision 后返回 201 并产生新结果。失败保留、旧 V1 配方和刷新恢复未全测。 |
| V06 | **Web 部分通过，桌面阻塞** | Web 实际打开镜头配音与整集配音面板，查看上传、文字、混音预览和导出状态。重新打开编辑器时恢复 API 已保存的 0.5 秒起点、4 秒出点、30% 原声；旧编辑器保存时出现“视频配方版本冲突”，关闭重开可读最新版本。Mac 再次锁屏，当前 Tauri 实例无法完成 GUI 操作与截图；移动端未测。 |
| E01 / E02 | **API 联调阻塞，定向测试通过** | [本地实测](evidence/2026-10-30-voiceover-agent-edit/local-agent-flow.json)：创建建议返回 503 `service_unavailable`、`Agent 剪辑模型尚未配置`，前后镜头 revision 2、视频运行数 0、版本数 1、演示额度 0 均不变；网页“生成建议”按钮不可用。配置模型后的结构化建议、逐条预览/确认/幂等尚未端到端执行。使用隔离 PostgreSQL 测试 schema 的 `agent-edit.test.ts` **3/3** 通过；前端 Agent/配音定向测试 **6/6** 通过，仅证明模拟路径。 |
| E03 / E04 | **部分/未测** | 定向测试覆盖过期 revision 和无效跨项目配音建议；真实模型错误、人工编辑恢复及浏览器逐条选择未测。 |

### 定向命令结果

- `pnpm --filter @ai-video/api exec vitest run src/episode-media.test.ts src/audio-render.test.ts`：在报告时新修改后再执行，退出码 0，2/2。
- `TEST_DATABASE_URL=… pnpm --filter @ai-video/api exec vitest run src/agent-edit.test.ts`：使用隔离 PostgreSQL Unix socket，退出码 0，3/3；URL 不含口令，未入报告。
- `pnpm --filter @ai-video/plugin-video-edit exec vitest run --environment jsdom src/web/AgentEditWorkflow.test.tsx src/web/VoiceoverWorkflow.test.tsx src/web/AgentSuggestionPanel.test.tsx`：退出码 0，6/6。
- 首次未设置 `TEST_DATABASE_URL` 的 Agent 定向测试退出码 1，原因仅是测试环境变量缺失；设置隔离库后 3/3 通过。首次 WAV 重复上传返回 200 是素材去重，不是格式失败；测试预期已更正为有效素材接受 200/201。

## 冻结音频修复候选独立复测（2026-10-30，13:31 后）

架构提供的[候选清单](evidence/2026-10-30-voiceover-agent-edit/source-manifest-audiofix.txt)记录 345 个源码文件，归档 `/private/tmp/avs-release-audiofix-final-20261030-G56xQm.tar.gz` 的 SHA-256 为 `648bff4b2475260b0a10b1d81198a542aac2dacdb97d5bba3902e8206d711b2d`；QA 使用 `shasum -a 256` 独立重算相同。清单中的 Linux/amd64 本地镜像 ID 为 `sha256:f9b3810dcb4cb6c9098adb42dff2053c3281a4381a5af569357766fe3e690a0c`，QA 所在主机无法连接 Docker socket，故镜像 ID 仅为架构记录，未独立检查镜像元数据。重启的隔离 API 进程于 13:31:48 启动，晚于媒体修复源码时间。测试前后相关 214 文件的[快照](evidence/2026-10-30-voiceover-agent-edit/source-snapshot-restart-before.json)与[复测后快照](evidence/2026-10-30-voiceover-agent-edit/source-snapshot-restart-after.json)聚合 SHA-256 均为 `463f97edc9b5068b5f2221d02359d93580079dcede3991146e03791f06f80ab3c`。这证明该复测期间相关源码未变化；仍需发布方确认线上镜像与归档的对应关系。

QA 在隔离 PostgreSQL 创建全新项目 `QA Frozen Audio c113f748`（项目 `3f38ed4c-0feb-4e82-9767-482bbae652cd`），无付费供应商调用。[种子 API 记录](evidence/2026-10-30-voiceover-agent-edit/frozen-api-seed.json)显示项目创建 201、有效照片/视频/配音对象接受 200（内容去重）、新建 10 秒请求 400、运行数 0→0。旧失败文件保留，未以新结果覆盖。

| 用例 | 结果 | 冻结候选独立证据 |
| --- | --- | --- |
| V03 5 秒镜头 | **通过（隔离 API）** | [请求与任务状态](evidence/2026-10-30-voiceover-agent-edit/local-media-flow-frozen.json)：配音配方保存 revision 1→2，合成预览和正式导出各为 201→succeeded，同一结果资产。两份 [MP4 音轨分析](evidence/2026-10-30-voiceover-agent-edit/local-media-analysis-frozen.json)显示 5.000 秒 H264+AAC，字节哈希相同 `4714d5ba9c3fb0cd7368f3171c1a652969d9c4e605c6e4ebffdfcafe0f2b207d`；0.1 秒只见 660Hz 原声，1 秒新增 440Hz 配音。独立产物：[预览](evidence/2026-10-30-voiceover-agent-edit/local-shot-mixed-preview-frozen.mp4)、[导出](evidence/2026-10-30-voiceover-agent-edit/local-shot-mixed-export-frozen.mp4)。此前 [Web 合成预览截图](evidence/2026-10-30-voiceover-agent-edit/local-web-mixed-preview.png)属于冻结前 GUI 检查。历史 10 秒镜头仍未实测。 |
| V04 两镜头整集 | **通过（隔离 API）** | [请求与任务状态](evidence/2026-10-30-voiceover-agent-edit/local-episode-flow-frozen.json)：全新双镜头分集 revision 4，预览/导出各 201→succeeded，指向同一结果资产。[MP4 音轨分析](evidence/2026-10-30-voiceover-agent-edit/local-episode-analysis-frozen.json)显示 10.000 秒 H264+AAC、两文件字节相同，SHA-256 `479363843531656696bafa31a1554a82c7d61b8a9e4b35eaa54832a08d69918f`；第 6 秒仍有 440Hz 人声和 220Hz 音乐，第 9 秒仍有 220Hz 音乐。独立产物：[预览](evidence/2026-10-30-voiceover-agent-edit/local-episode-mixed-preview-frozen.mp4)、[导出](evidence/2026-10-30-voiceover-agent-edit/local-episode-mixed-export-frozen.mp4)。此前 [Web 导出截图](evidence/2026-10-30-voiceover-agent-edit/local-web-episode-export-lower.png)属于冻结前 GUI 检查。 |

### 桌面 V06 当前开发实例复测

测试绑定唯一的 `/private/tmp/AVS Dev Test.app` 原生窗口，指向桌面 Vite `127.0.0.1:1420` 和隔离 API `127.0.0.1:8788`。它是当前开发二进制的测试包装，不是 `/Applications` 中的旧安装包，也未与上述冻结归档逐文件绑定。首次启动时曾出现[白屏](evidence/2026-10-30-voiceover-agent-edit/local-desktop-devtest-blank.jpg)，当时开发服务器尚未就绪；重新读取窗口后[首页正常](evidence/2026-10-30-voiceover-agent-edit/local-desktop-devtest-home.jpg)，不将该白屏判为产品缺陷。

前端完成隔离账号登录、云端项目打开与 2 秒 WAV 导入后交还原生窗口。QA 独立检查[配音设置](evidence/2026-10-30-voiceover-agent-edit/local-desktop-devtest-voice-input.jpg)：`avs-feature-accept-voice.wav` 显示 2.0 秒，配音开始 1.0 秒、录音入点 0.0 秒、出点 2.0 秒，目标片长 5.0 秒；原录音试听和合成预览为两个独立控件。[预览截图](evidence/2026-10-30-voiceover-agent-edit/local-desktop-devtest-voice-preview.jpg)显示“合成预览：可播放”；QA 点击播放，辅助功能状态从 Pause/0 秒到 Play/5 秒，音量未静音。返回画布后重新进入，录音资产、1.0 秒起点与可播放预览均保留。点击“确认导出”后，状态由 `running` 变为 `succeeded`，[导出截图](evidence/2026-10-30-voiceover-agent-edit/local-desktop-devtest-export.jpg)显示独立成片；QA 再次播放，进度从 0 到 5 秒。Tab 键可以将焦点移到视频控件。**V06 的桌面核心路径通过；物理扬声器听辨、更多忙碌/空/错误状态和移动端未完成，因此 V06 整体仍为部分通过。**

同一页面初次 Agent 建议显示“引用了无效或过期的镜头编辑，仍可继续手工编辑”，截图见上述导出页。QA 随后独立只读核对隔离 API `8788`：项目 `2bd0a962-2c64-4d1f-9e6e-87d402555380`、分集 `a84d0747-b100-49f3-926c-c2693abc8192` 确有编辑 `3d40dd93-382d-4b1e-8dca-dc055b7e83d9`，revision 3。错误来自 `/private/tmp/avs-agent-edit-mock.mjs` 固定返回旧 `expectedRevision: 2`，是**过期模拟响应被正确拒绝**，不是“没有 video_edit”。QA 仅调整本地模拟服务按请求快照的 revision 返回建议，未改业务代码、未调用真实模型。

再试后，Agent 入口先显示加载，随后给出一条有理由的 0–3 秒裁剪建议和勾选项，[就绪截图](evidence/2026-10-30-voiceover-agent-edit/local-desktop-devtest-agent-ready.jpg)与[确认提示](evidence/2026-10-30-voiceover-agent-edit/local-desktop-devtest-agent-confirm.jpg)留档。点击“预览所选 1 条”只打开二次确认，页面明确“原视频保留；不会自动生成视频、调用 TTS 或扣费”；确认后显示[已应用状态](evidence/2026-10-30-voiceover-agent-edit/local-desktop-devtest-agent-applied.jpg)。隔离 API [确认前](evidence/2026-10-30-voiceover-agent-edit/local-desktop-agent-before.json)与[确认后](evidence/2026-10-30-voiceover-agent-edit/local-desktop-agent-after.json)只读快照均为 HTTP 200：镜头 revision **3→4**、裁剪终点 **4000→3000 ms**，视频运行数 **0→0**、演示额度预留/使用 **0→0**、渲染版本数 **0→0**。本地[快照脚本](evidence/2026-10-30-voiceover-agent-edit/qa-desktop-agent-snapshot.mjs)只读 API 且不输出凭据。**E01/E02 的受控模拟单条裁剪路径通过；真实模型质量、跨动作组合、重复确认和公网路径仍未验收。**

桌面当前开发实例中的文字 TTS 费用说明仍禁用；桌面 UI 的真实 TTS 提交、恢复和成片没有通过。桌面源片的音质不能仅凭 0→5 秒播放进度判定；冻结候选 API 的音轨频率与文件哈希结论见上表。

### 架构侧真实 TTS 单次提交：供应商认证失败

架构会话随后报告在隔离服务器用现有生产 `KLING_API_KEY` **只提交一次**真实 TTS：本地任务创建返回 HTTP 201，最终状态 `failed`、`costStatus=unbilled`，没有 `providerTaskId`。该会话的定向探测显示同一密钥访问北京主机的免费账号查询返回 HTTP 200／`code=0`，访问新加坡主机返回 HTTP 401／`code=1002`（`api key not found`）；北京主机被探测的 TTS GET 路由返回 HTTP 404。以上是架构侧报告，QA 尚未取得脱敏原始请求日志，故只作为供应商路径**失败线索**，不能判定所有地区或所有 TTS 路由的支持情况，也不能记为 V02 通过。用户目前无法取得适用于所测新加坡接口的新密钥。为避免重复扣费风险，本轮不再提交第二次真实 TTS；待凭据和路由由架构核实后，用同一个任务链验证等待、恢复、费用状态和成片。早期 V02 表中“没有供应商请求”只描述当时的本地联调阶段。

**待发布门禁**：冻结候选的 V03/V04 隔离 API 复测、桌面当前开发版核心配音路径和 Agent 模拟单条裁剪已完成；配置真实 Agent 剪辑模型，完成 E01–E04 真实模型及其他动作联调；补桌面物理听辨、更多状态与旧 10 秒项目；架构核实 TTS 路由和可用凭据后单独验收 V02；正式上线后重新核对发布哈希、数据库迁移及公网业务。没有这些证据，本轮不能标记整体通过。
