# Node.js 与 Python 服务端方案评估

日期：2026-10-30。依据本仓库提交 `5649d1b` 的代码；这是架构评估，**本次目录迁移不更换服务端语言，也不修改线上服务**。

## 当前实现

Web、桌面和移动端都用 TypeScript；`@ai-video/api-contracts` 与 `@ai-video/project-schema` 使用 Zod 定义 HTTP 请求／响应和项目 DSL。`apps/api` 是 Node.js/TypeScript HTTP 服务：59 个 `src/*.ts` 文件中有 23 个测试文件，非测试源码约 4,089 行。`server.ts` 集中处理鉴权、项目、素材、灵感、视频生成、配音、预览、剪辑与 SSE。业务模块约有 226 处参数化 `db.prepare` 调用，使用 PostgreSQL 事务、advisory lock 和版本化 schema。后台任务负责可灵／Cursor 调用、任务恢复、FFmpeg 预览与导出。桌面端本地媒体与文件系统能力是 Tauri/Rust，不会因为 HTTP 服务换语言而自动替换。

代码仓库目前**没有** `@langchain/langgraph` 依赖；`packages/agent-core` 是生成计划类型与纯规则。因此“Agent 一定要改 Python 才能做”与当前代码不符。[LangGraph JavaScript 文档](https://docs.langchain.com/oss/javascript/langgraph/thinking-in-langgraph)也提供 JavaScript 节点与状态图。

## 方案比较

| 维度 | 保留 Node.js/TypeScript | 改为 Python/FastAPI |
| --- | --- | --- |
| 与现有客户端／协议 | 直接使用 Zod 共享契约和项目 DSL，改动小 | 不能直接导入 TS 包；需建立语言中立的 OpenAPI/JSON Schema 与双端生成／一致性测试 |
| 现有功能 | 可复用鉴权、上传、PostgreSQL、幂等付费任务、SSE、FFmpeg 和已有测试 | 必须重写这些语义并逐项证明旧用户数据、任务和媒体兼容 |
| AI 与模型生态 | 调用远程 Cursor／可灵 API 足够；LangGraph 有 JS 版本 | 对未来需要 PyTorch、音视频研究模型、本地推理的功能更便利；Python 版 LangGraph 也可用 |
| 媒体处理 | 当前 FFmpeg 在子进程执行，Node 可异步启动进程；改语言不会让 FFmpeg 编码自动变快 | 仍调用同一 FFmpeg；Python 生态适合额外的模型前／后处理 |
| 长任务可靠性 | 已有数据库任务状态、幂等 ID、worker 与恢复逻辑，需要继续完善进程隔离 | FastAPI 自带的进程内 `BackgroundTasks` 不是重型持久任务队列；仍需独立 worker 和持久化任务机制 |
| 部署运维 | 保持现有 Node 24、pnpm、Docker 镜像与监控路径 | 新增 Python 镜像、依赖锁定和安全更新；全替换还要设计数据库、路由和 worker 切换 |

媒体与任务结论依据：[Node.js `child_process` 文档](https://nodejs.org/api/child_process.html)说明异步子进程；[FastAPI 后台任务文档](https://fastapi.tiangolo.com/tutorial/background-tasks/)建议重型计算考虑独立工具；[FastAPI 特性文档](https://fastapi.tiangolo.com/features/)说明 Pydantic 与 OpenAPI 能力。

## 建议

**现阶段保留 Node API。** 项目当前的付费调用主要是外部 HTTP API，混音／转码由 FFmpeg 完成；全面改 Python 的收益不足以覆盖协议、数据库与付费任务的重写风险。优先修复现有 API 的服务可用性、供应商权限、worker 隔离和部署问题。

当出现需要 Python 原生模型的功能（例如本地语音识别、口型模型、视觉分析或复杂音频处理）时，新增一个**内部 Python worker**，Node 继续拥有用户鉴权、业务数据库、任务 ID、费用确认与对外 HTTP 协议。Node 持久化任务并只向 Python 传受控任务 ID、素材引用和配方版本；Python 只产生结果文件／元数据，Node 验证后入库。不要让两个服务同时拥有同一付费任务的提交权。第一版可先用隔离进程做技术验证；确定吞吐与恢复需求后再选独立容器／任务队列。

## 如果决定全面替换为 Python

1. **冻结协议与数据语义**：将现有 Zod 请求／响应、错误码、Cookie/CSRF、项目 DSL、SSE 事件和任务状态转成语言中立的版本化契约；给 TS/Python 两端提供同一组黄金样例。保留 PostgreSQL 当前数据和资产 ID，不以重建库代替迁移。
2. **只读平行验证**：用 FastAPI/Pydantic 实现健康、项目、资产和任务查询，在隔离环境对同一数据库快照与 Node 输出做差异比较；不得让 Python worker 领取现有任务。
3. **逐块迁移写入**：先鉴权与项目命令，再上传、媒体渲染，最后付费供应商任务。每块保留相同的权限、额度、事务、幂等、未知提交状态与失败恢复；真实付费 POST 必须只有一个执行者。
4. **受控切流**：在恢复库和预发环境完成旧账号、旧项目、素材、镜头／整集成片、跨账号隔离、CSRF、SSE 续传与重复确认回归；Nginx 小流量切换时保证同一任务不会被 Node/Python 双 worker 处理。记录新写入的回退边界，保留 Node 镜像直到 Python 数据兼容得到验证。

此路线是独立项目，不能作为本次本地目录迁移的附带改动。是否启动全面替换，应在 Python 专有模型需求和运行成本有具体证据后决定。
