# 灵感生成接入 Codex Agents API

## 目标

登录用户输入 1–200 字关键词，服务端通过独立的 OpenAI 项目密钥创建无执行环境的 Agent session，得到三条不同的 5–10 秒单镜头中文视频脚本。草案属于账号，不消耗视频额度；选中脚本后仍由用户明确启动视频生成。

## 方案

- 保留现有 Chat Completions 兼容适配器；以 `IDEA_PROVIDER=agents` 显式启用新适配器。默认仍为 `chat`，避免无意切换既有环境。
- Agents API 使用 `environment.type=none`、无工具、结构化 JSON 输出约束。模型 ID 和密钥仅由 API 进程读取。前端接口和三版校验契约保持不变。
- 本地先持久化 `pending` 和请求 ID，再创建 session；收到 session ID 后立即持久化。生成结果通过后台轮询 session、turn 和最终消息读取，进程重启后继续按已有 session ID 查询，不重新提交。
- 如果创建 session 的响应丢失且没有 session ID，标记 `unknown`，同一请求 ID 不自动重试，避免重复计费。API 错误、格式错误和超时应清楚区分。
- 服务器密钥存入 systemd 的受限 EnvironmentFile，不进入仓库、前端构建或聊天。生产切换在代码部署和模拟验收后进行。

## 验收

- 合法输入最终返回恰好三条不同脚本，账号隔离、重放和选择行为不变。
- 已记录 session ID 的 pending 草案在服务重启后可恢复，且 OpenAI 创建请求只发生一次。
- 无密钥、权限失败、Agent 失败、输出不合格和连接中断分别落入可解释的状态；不静默生成固定内容。
- 真实线上调用需使用用户在服务器自行配置的密钥验收。
