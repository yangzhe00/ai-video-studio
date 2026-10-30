# “用 Codex CLI 做灵感服务”架构评估

初版：2026-10-29。复核：2026-10-30。对象：公网多人使用的“三版镜头灵感”文字服务。

## 结论

**当前不把站长的个人 Codex CLI 登录部署到服务器，供所有网页用户共用。** `codex exec` 可以非交互运行，但它是编码 agent 的执行入口，不是给公网用户共享模型额度的服务凭据。Codex 的开源执行框架与模型访问分开；安装 CLI 不会自动修复供应商认证或调用失败。[OpenAI CLI 与 Codex CLI 的官方区别](https://developers.openai.com/api/reference/cli)、[Codex 作为平台的集成方式](https://developers.openai.com/blog/codex-as-a-platform)。

如果用户希望采用 **Codex 的 agent 能力**，仓库已经有 `IDEA_PROVIDER=agents` 的服务端 Agents API 适配器：用项目专用 API 凭据创建无执行环境、无工具、关闭多 agent 的会话，校验恰好三版 JSON，靠已保存的会话 ID 查询结果。它比在 API 进程里启动个人登录的 CLI 更贴合现有持久任务模型。若目标只是生成三段文字，现有 `IDEA_PROVIDER=chat` 的 `/chat/completions` 适配器更简单；生产是否选择它，取决于模型服务、价格和实测质量。**更换供应商不是当前故障的已证实修复方法。** [Agents API 架构](https://developers.openai.com/api/docs/guides/agents-api/architecture)、[Agents API 计费](https://developers.openai.com/api/docs/guides/agents-api/overview)。

## 当前发布事实与代码边界

| 时间和证据 | 已确认事实 | 不能据此推断 |
| --- | --- | --- |
| 10 月 29 日旧发布，[发布核查](2026-10-29-web-deployment-checks.md) | 当时 API 的 `IDEA_MODEL_BASE_URL`、`IDEA_MODEL_API_KEY`、`IDEA_MODEL_ID` 缺失，接口报 `not_configured`。 | 不能用旧环境状态描述 10 月 30 日的生产站。 |
| 10 月 30 日发布包 `20261030-official-04` 与后续官网文案修订，[正式发布记录](../acceptance/2026-10-30-official-release.md) | 公网官网 `/`、创作应用 `/studio/`、PostgreSQL API `/api/` 已发布；官网将 Agent 三版标为“即将开放”。 | 健康检查通过不代表文字供应商调用成功。 |
| 10 月 30 日公网隔离账号一次真实调用，[脱敏记录](../acceptance/evidence/2026-10-30-official-website/qa-public-idea-flow.json) | `POST /prompt-ideas` 返回 201，最终 `failed/provider_error`、0 版；视频额度调用前后相同。 | 公开响应没给出供应商、上游 HTTP 状态或内部错误，不能断定是密钥、模型、额度、网络、输出格式中的哪一项。 |

当前 `apps/api/src/config.ts` 支持 `IDEA_PROVIDER=chat | agents | cursor`，默认 `chat`；三组凭据分别是 `IDEA_MODEL_*`、`OPENAI_API_KEY`/`IDEA_AGENT_MODEL`、`CURSOR_API_KEY`/`IDEA_CURSOR_MODEL`。`README.md` 描述线上三版采用 Cursor Cloud Agent，但上述公网脱敏记录不含运行时 `provider`，因此本评估不把 README 当成这次错误的供应商诊断。`apps/api/src/prompt-ideas.ts` 已有账号级 `clientRequestId` 幂等、持久任务、每日个人与平台次数限制；`idea-agents.ts`、`idea-cursor.ts`、`idea-model.ts` 都会把若干上游异常归并为 `provider_error`。与视频生成的 `packages/agent-core` 是否引入无关。

## Codex CLI 用于公网多人调用的边界

| 事项 | 评估 |
| --- | --- |
| 非交互调用 | 官方支持 `codex exec` 处理有界的后台任务，SDK/app-server 支持应用级生命周期。单次灵感文本无需代码工作区或命令执行；CLI 的子进程启动、取消、超时、结构化输出和升级维护会增加故障面。[集成层选择](https://developers.openai.com/blog/codex-as-a-platform)。 |
| 认证与条款 | 个人 CLI 登录关联个人身份，不能视为产品的共享服务凭据或已获授权的公网计费方式。官方 **Sign in with ChatGPT** 流程要求每个使用者单独授权；现有文档明确：面向本地开源/个人工具的 ChatGPT 计划用量方案，用于付费或远程托管应用时须先申请访问。这里不声称所有个人登录的服务器使用都被某条未核实条款禁止；是否允许本产品这种使用须由服务提供方确认。[使用范围说明](https://developers.openai.com/cookbook/articles/sign-in-with-chatgpt)、[申请范围](https://developers.openai.com/siwc/quickstart)。 |
| 配额与成本 | 共享个人订阅没有按本产品账号的独立预算与可审计账单。专用 API 项目支持额度和支出上限；OpenAI API 限额按组织/项目及模型计算，不按本站用户自动分摊，本站仍须自行限制每账号频率、平台并发、输出量、队列和预算。限额/超载可返回 429/503；超时及结果不明时不可盲目重试并重复计费。[API 限额](https://developers.openai.com/api/docs/guides/rate-limits)、[生产项目和密钥管理](https://developers.openai.com/api/docs/guides/production-best-practices)。 |
| 隔离与安全 | CLI/agent 运行环境中的文件、密钥和网络可能被 agent 访问。不能让不同站点用户共享一个有仓库、媒体目录或 API 密钥访问权的执行环境。若将来确实需要工具调用，要用每用户/任务隔离、最小权限、受限网络，应用密钥留在执行环境外。当前三版文字可采用无执行环境、无工具的调用。[环境安全](https://developers.openai.com/api/docs/guides/agents-api/environments/security)。 |
| 可用性 | 个人登录过期、交互认证、CLI 进程回收与全站共享额度会成为单点。对当前工作流，服务端 API 适配器配合持久会话 ID、状态查询和受控重试更容易恢复。现有每日次数限制不等于同时在途请求限制；当前请求体也未设置明确的输出 token 上限。 |

## 可执行方案

1. **先诊断当前 `provider_error`。** 在服务器只确认有效的 `IDEA_PROVIDER` 名称及该模式必需变量“存在/缺失”，不要打印值。按此次任务 ID 关联脱敏上游 HTTP 状态、上游错误类别、会话/运行状态、模型 ID 是否可用、耗时和请求 ID；不要记录用户提示词、访问令牌或供应商原始响应。若供应商返回 `ERROR`/`CANCELLED`/`EXPIRED`，区分认证、模型权限、额度、网络、超时与供应商内部错误。当前证据不足以选择一个作为根因。
2. **以现有服务端路径恢复三版。** 如坚持 Codex agent，优先验证 `IDEA_PROVIDER=agents` + 独立生产项目的服务账号 API 凭据、获准模型与预算；该适配器已提供 `tools: []`、`environment: { type: "none" }`。如只需三版短文本，则评估 `chat` 路径或当前 Cursor 路径的真实成本、质量、稳定性后选定一个。所有凭据仅放 API 进程的秘密管理中，不进入网页包、Git、日志。不要把个人 Codex CLI 的会话文件复制到生产服务器。[服务账号与项目边界](https://developers.openai.com/api/docs/guides/production-best-practices)。
3. **补生产门禁再对公网开放。** 在现有每日限制之外，增加平台及账号的在途并发/队列上限、明确的输出 token 或用量上限、预算熔断、超时与供应商错误监测；结果未知时按已记录的任务 ID 恢复，不自动再创建收费任务。用隔离账号在预发布环境及公网各做一次授权的真实文字调用，验收恰好三版、三版不同、失败可恢复、不会创建视频任务或扣视频额度。当前缺少成功的公网实测，所以“即将开放”的对外文案应保持。

若产品决策改成“每位用户用自己的 ChatGPT 计划”，应另立账号与授权设计：每人 OAuth 同意、令牌隔离与刷新、模型访问校验、会话隔离、额度和错误提示；现有站点的自有账号登录不具备这套流程。官方 app-server 示例明确使用**该用户的** OAuth access token，授权与续期由应用负责；远程托管产品还需先确认相应准入。[Codex app-server 与每用户令牌](https://developers.openai.com/siwc/token-sharing-open-source/codex-app-server)、[托管应用准入边界](https://developers.openai.com/cookbook/articles/sign-in-with-chatgpt)。

**阻断项：** 当前上游故障类别未被脱敏确认；尚无通过验收的生产文字调用；专用凭据、模型权限和费用/并发上限未经确认。不能据此发布“灵感已恢复”，也不应通过个人 Codex CLI 登录绕过这些门禁。
