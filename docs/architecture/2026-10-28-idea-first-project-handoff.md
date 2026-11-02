# 一句话灵感与项目入口：架构评估及研发测试交接

日期：2026-10-28
产品依据：[产品方案](../product/2026-10-28-idea-first-project-flow.md) · [可点击 HTML 原型](../../design/prototypes/idea-first-project-flow/index.html)

## 评估结论

方案可沿用现有 Tauri 桌面端、React 网页端和 Node/SQLite API。**三版灵感是一次账号级的文本创意请求，每版只描述同一个视频镜头**；它独立于项目创建和现有视频生成任务。用户选定并编辑一版、明确选择项目和分集、提供照片后，才进入原有的单镜头生成计划与审批链路。灵感阶段不创建项目、`agent_runs` 或视频 `operations`，不预留视频演示额度。

这是新增功能，不能把当前 `agent-core` 的 `validated-input` 规则计划称作真实模型创意能力：`packages/agent-core/src/index.ts:11-35` 只校验并复制单镜头输入；`apps/api/src/runs.ts:34-76` 直接创建视频运行。API 目前只配置了 `KLING_API_KEY`，尚无文本模型凭证和适配器。真实模型、凭证、调用限额与成本上限必须在后端接入并验证，测试用模拟服务不能作为上线证据。

用户选择**可配置的 OpenAI-compatible 后端接口**。首个适配器按 [OpenAI Chat Completions 官方接口](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create) 的 `POST /chat/completions`、`model`／`messages` 请求和 `choices[0].message.content` 响应形状实现；“兼容”只表示这一 HTTP 契约，不能假设所有供应商支持相同的 `response_format` 或严格 JSON schema。后端必须自行解析和验证返回内容。先用受控模拟模型服务验收，再用实际选择的模型和有效凭证做真实调用验收；两者在测试报告中分别标注。

桌面项目未登录时只存在本地；网页 `/projects` 只列当前 API、当前账号的云项目。本轮用户已确认桌面未登录，并要求暂不处理同步问题。**本交接不包含同步协议或后端同步修复。**仅调整项目入口的状态文案，避免把“已登录”误写为“已同步”。

## 依赖与接口契约

```text
登录首页 → POST /prompt-ideas → 三个单镜头候选 → 选择并编辑
         → 选择／明确创建项目 → 选择／明确创建分集 → 选择／上传照片
         → POST /projects/:id/runs → 展示现有计划与额度 → POST /runs/:id/approve
```

| 接口或数据 | 建议契约 | 边界 |
| --- | --- | --- |
| `POST /prompt-ideas` | `{clientRequestId, input}`；返回 `{id, state, input, variants:[{id,title,description,prompt}], createdAt}`。输入 1–200 字，成功结果恰好三版，完整提示词各不超过 2000 字。 | 登录后可用，不需要 `projectId` 或照片。同账号、同 ID、同输入重放返回同一草案；同 ID 不同输入返回 409。 |
| `GET /prompt-ideas`、`GET /prompt-ideas/:id` | 返回本人最近草案或指定草案，包含生成中、成功、失败状态；旧草案可找回。 | 每次按 `owner_id` 鉴权，列表分页或设上限；另一账号返回 404 或拒绝。 |
| `POST /prompt-ideas/:id/selection` | `{variantId, editedPrompt}`；保存用户最终文本快照并返回草案。 | 选择和编辑不触发视频调用；新一轮“三版”使用新的请求 ID，旧轮保留。 |
| `POST /projects/:id/runs` | 沿用 `{clientRequestId, episodeId, sourceAssetId, input, durationSec}`；可选传 `ideaSetId`、`variantId` 作为溯源字段，校验归属及最终文本快照。 | 仍只创建 `waiting_approval` 计划；现有 `planHash` 和 `approvalId` 保护不变。没有灵感来源的手工生成继续可用。 |
| `GET /projects` | 项目库需要 `updatedAt` 和可展示的最近分集摘要；网页客户端负责搜索与刷新。 | 当前只返回 `id/title/revision` 并按 `created_at` 排序。若按产品方案实现“最近更新”，须做项目时间戳迁移与所有写路径更新，不能仅改前端排序标签。 |

草案表建议为 `prompt_idea_sets`：`id`、`owner_id`、`client_request_id`、`input_hash`、`input_text`、`state`、`variants_json`、`selected_variant_id`、`edited_prompt`、`model_id`、`usage_json`、`error_code`、`created_at`、`updated_at`；唯一约束 `(owner_id,client_request_id)`。先持久化 `pending` 再调用模型，**不能持有 SQLite 写事务等待外部 HTTP**。同一 ID 并发请求只启动一次模型调用；进程重启后未完成请求应呈现可恢复或明确失败状态，不能悄悄再调用。模型返回必须做结构、长度、空值和完全重复检查；失败时显示失败并允许用户手写提示词，不用固定模板冒充 Agent 输出。文本模型费用与视频演示额度分开记录并限流。

服务端环境变量建议固定为 `IDEA_MODEL_BASE_URL`（受信任服务的 HTTPS API 根地址；仅本机模拟测试允许 loopback HTTP）、`IDEA_MODEL_API_KEY`（服务端密钥）、`IDEA_MODEL_ID`（模型名）、`IDEA_MODEL_TIMEOUT_MS`（默认 30 秒，限制在合理范围）。后端从配置拼出 `/chat/completions`，不接受浏览器或桌面端传入模型地址、模型名或密钥。只在 `.env.example` 写变量名与空占位；日志、草案记录、API 响应和客户端包均不得包含密钥。若凭证缺失，应返回明确的“灵感服务未配置”，不能自动返回演示文案。

模型请求使用有上限的超时与响应体大小。已持久化请求一旦进入外部调用阶段，网络超时或进程退出后，同一 `clientRequestId` 只返回 `pending`／`unknown` 状态，不默认再次 POST，以免产生第二次模型费用；用户明确点击“再给我三版”才创建新请求 ID。若所选供应商支持可靠的请求幂等或查询，再根据该供应商文档增加恢复机制，不把通用兼容接口当作具备此能力。

## 研发任务拆分

### 后端 B1：真实三版灵感与持久化

**负责文件**：`apps/api/src/db.ts`、`apps/api/src/server.ts`、`apps/api/src/config.ts`、`.env.example`、新增 `apps/api/src/prompt-ideas.ts`／OpenAI-compatible 模型适配器与测试、`packages/agent-core/src/index.ts` 中的共享 DTO（如需）。

- 实现账号级草案数据迁移、唯一请求 ID、三版生成接口、草案列表／详情／选择保存；所有读取和写入按账号隔离。
- 在 API 进程接入上述可配置的 OpenAI-compatible 文本模型。凭证仅在服务端环境；明确模型未配置、超时、限流、响应无效等错误。对输入、响应体和输出做上限控制，限制单账号调用频率和平台总调用量；不依赖可选结构化输出参数，解析后自行校验三条候选。
- 确保草案生成、查看、选择及超时重放不创建 `agent_runs`／`operations`，也不改变 `demo_reserved`／`demo_used`。保留现有视频审批、供应商任务幂等与失败恢复语义。
- 若接入模型服务的选择和凭证尚未确定，先完成 API 契约及模拟测试，并将**真实功能验收列为阻塞**；前端不得把模拟文案标为已上线 Agent 结果。

### 后端 B2：项目库摘要

**负责文件**：`apps/api/src/db.ts`、`apps/api/src/server.ts`、`apps/api/src/sync.ts`、生成／渲染结果写项目的路径及对应测试。由 B1 同一后端负责人顺序完成，避免同时编辑数据库和路由文件。

- 为项目补 `updated_at` 并迁移旧库；项目创建、资源命令、生成结果和渲染结果落盘时更新时间。`GET /projects` 按该字段降序返回 `updatedAt` 与最近分集摘要；旧项目有合理回填值。
- 不改变项目所有权规则、资源修订或桌面云关联协议。项目库不为本地未关联项目伪造云端记录。

### 前端 F1：共享灵感组件与流程状态

**负责文件**：新增 `packages/ui-web/src/PromptIdeas.tsx` 等组件与样式、必要的 `packages/ui-web/src/index.ts` 导出；必要时调整 `packages/components/src/ProjectHome.tsx`。

- 首页组件接收账号级输入、三张候选、选择／编辑、重新获取、加载／空／失败／恢复状态。候选标题、解释和完整提示词均可读；最终文本可修改。`GeneratePage` 目前强制依赖项目 `manifest`，不应直接用作无项目首页。
- 将“首页灵感”和“项目内生成”分成独立生命周期；页面切换、返回首页或刷新不能丢失已保存草案。重新修改原始想法时，旧三版提示已过期，明确要求新请求。
- 原型中的固定示例仅用于演示；正式组件显示真实 API 结果，模型不可用时保留手写继续入口。

### 前端 F2：网页首页、项目库与选择链路

**负责文件**：`apps/web/src/App.tsx`、`apps/web/src/api.ts`、`apps/web/src/styles.css` 及对应测试。

- 首页只保留一句话入口、最近项目和“全部项目”；移除首页内嵌的 `web-studio-projects` 项目按钮、行内新建表单和分集列表。项目内分集导航只在项目工作台出现。
- 独立项目库提供项目卡、搜索、空态、加载、失败重试、手动刷新及新建项目弹窗；进入项目库时重新读取 `/projects`。创建成功后才进入该项目；失败不生成假项目或重复提交。
- 选择灵感后可选择已有项目或明确新建项目，再选／建分集、选择／上传 JPG/PNG 照片，编辑最终提示词和 5/10 秒时长。最终检查后调用现有 `/projects/:id/runs`，在原审批界面明确确认后才调用 `/runs/:id/approve`。
- 不让 `App.tsx` 的单个 `ideaFlow` 布尔值决定所有入口；用明确的流程阶段和草案 ID 区分普通打开项目与携带灵感进入项目。

### 前端 F3：桌面入口与真实同步状态文案

**负责文件**：`apps/desktop/src/App.tsx`、`apps/desktop/src/features/projects/ProjectPicker.tsx`、`apps/desktop/src/features/studio/StudioWorkspace.tsx`、`apps/desktop/src-tauri/src/cloud.rs` 及对应测试。

- 桌面无项目首页也允许已登录用户从一句话获取三版灵感；本地项目的创建／选择仍需用户明确操作。选定结果后把最终提示词带入项目内生成，不自动生成视频。
- Rust `cloud.rs` 的请求路径白名单需加入 `/prompt-ideas`，保持 HTTPS／本机地址约束和现有会话隔离。不要在桌面环境保存模型密钥。
- 未登录本地项目显示“仅保存在本机”；已登录但未建立有效 `cloudSync` 绑定显示“尚未同步到云端”；同步中、失败／冲突、已完成按实际状态呈现。当前 `StudioWorkspace.tsx:591` 对任意非同步中／非冲突的登录状态都显示“已同步云端”，须改为受绑定与最近一次成功同步结果约束；**只改状态表达和入口，不改同步协议。**

### 测试 T1：接口、交互与真机截图

**负责文件**：`apps/api/src/*test.ts`、`apps/web/src/*test.tsx`、`apps/desktop/src/**/*test.tsx`、`docs/acceptance/` 下的截图与记录。待 B1/B2 契约确定后编写用例；F1/F2/F3 集成后做真实浏览器和桌面窗口验收。

1. 同一账号同一请求 ID 重放只得到原三版；改输入复用 ID 返回 409；两账号互不可见；模型异常、限流和空／重复候选均有真实错误状态。
2. 首页输入一句话后得到三张**同一镜头的不同提示词**；选择、修改、返回、刷新与换设备后内容一致。选择前后数据库无视频任务和操作，视频演示额度不变。
3. 项目库搜索、刷新、新建、创建失败重试可用；首页 DOM 不含整张项目／分集列表，新建成功进入工作台。项目列表按真实更新时间排序，旧云项目仍可打开。
4. 从所选提示词到项目、分集、照片和 5/10 秒确认的每个缺项均有提示；取消确认不提交视频；最终审批只产生一次视频操作。原有手写提示词路径仍可用。
5. 桌面未登录新建本地项目显示“仅保存在本机”，网页不出现该项目；桌面已登录但未关联时不显示“已同步”。这只是预期行为和文案验收，不列为同步缺陷。
6. 提供带时间与环境说明的网页截图（首页、三候选、项目库、新建弹窗、确认生成）和真实桌面窗口截图（无项目首页、本地项目状态、携带灵感进入生成）。记录 API 模型是否真实接通；不把 HTML 原型或模拟测试截图当作真实客户端截图。

## 执行顺序与代码审查门禁

1. 后端先冻结 DTO 和错误码；前端可并行按模拟响应制作 UI，但不得声称 Agent 已上线。B1 的真实模型、账号隔离与幂等通过后，前端接入。B2 的 `updatedAt` 摘要通过后，F2 打开项目库真实排序。
2. F1 共享组件先完成，再由 F2 网页、F3 桌面接入；两个客户端负责人不得同时改共享组件。T1 在接口与 UI 集成后进行真实浏览器／桌面验收，并交付截图。
3. 代码审查重点：无静默创建项目、无选择即生成、无三版变成三次视频调用；`clientRequestId`／`approvalId` 和账号归属正确；模型密钥只在服务端；项目旧数据迁移安全；桌面未登录状态诚实；用户数据与现有工作树改动不被覆盖。任何未完成的真实模型、桌面窗口或付费链路须在交付中明确标注。
