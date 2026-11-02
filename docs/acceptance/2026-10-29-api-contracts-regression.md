# 共享 API 协议回归报告（2026-10-29）

## 结论与版本边界

在本地隔离环境中，A1–A5、A7 的 Web／桌面部分、A8 的受测链路通过；A6 有迁移前自动化覆盖，但缺少独立界面／接口复核。移动端仅通过类型构建，未在模拟器或真机运行。没有触发真实付费视频生成。

**当前工作树尚不能判为整体通过。** 测试进行时，API 数据层被并行改为 PostgreSQL。20:19 的 API 56/56 通过及下面的本地接口、界面截图对应迁移前已启动的 API 进程；21:12 对当前源码重跑为 27 通过、29 失败，失败集中在测试环境缺少 `TEST_DATABASE_URL`，见 [当前 API 日志](evidence/2026-10-29-api-contracts/api-test-current.log)。当前 `createApi` 还要求 `DATABASE_URL`，因此需要 PostgreSQL 测试库就绪后重新跑全量 API 和 Web／桌面端到端回归。此处不把环境阻塞记作业务断言失败。

线上 `39.108.55.176` 未确认部署本次共享协议和 PostgreSQL 迁移，本文所有截图均来自本地隔离环境，不构成线上验收。

## 环境与证据

- 仓库：`/Users/yangzhe/Documents/ChatGPT/剪辑`；2026-10-29 20:16–21:12（北京时间），未锁定提交号，期间有并行修改。
- API：`127.0.0.1:18879`，隔离数据目录；文字生成接本机模拟 Chat Completions 服务；可灵密钥未配置。桌面使用另一个隔离 API `127.0.0.1:8787`。Web 开发服务为 `127.0.0.1:11422`。
- 账号均为本地 `example.com` 测试账号；照片为测试 JPEG。证据 JSON 已去除 Cookie、密码、邮箱和原始对象 ID。截图未包含密钥或密码。
- [接口逐项结果](evidence/2026-10-29-api-contracts/api-probe.json)、[接口结果截图](evidence/2026-10-29-api-contracts/api-probe-full.png)、[运行幂等与事件结果](evidence/2026-10-29-api-contracts/run-sim.json)、[运行结果截图](evidence/2026-10-29-api-contracts/run-sim-screen.png)。

## 用例结果

| 编号 | 状态 | 实测结果与证据 | 限制 |
| --- | --- | --- | --- |
| A1 | 通过（受测快照） | 未登录项目／灵感均 `401 unauthorized`；注册 `201`、登录／账号信息 `200`。Web [登录](evidence/2026-10-29-api-contracts/web-login.png)、桌面 [登录](evidence/2026-10-29-api-contracts/desktop-login.png)。 | 当前 PostgreSQL 工作树待复测。 |
| A2 | 通过（模拟供应商） | 空白及 201 字输入均 `400 invalid_request`，记录数不变。输入“小狗做晚饭”获得三条方案；选择第二条、编辑提示词后，接口重读及 Web 刷新均保留。见 [三版方案](evidence/2026-10-29-api-contracts/web-three-ideas-full.png)、[刷新后状态](evidence/2026-10-29-api-contracts/web-idea-after-reload.png)、[接口响应](evidence/2026-10-29-api-contracts/api-probe-full.png)。 | 三条内容来自模拟模型；真实 Codex CLI 或线上模型尚未验收。5–10 秒单镜头约束有服务端提示词／自动化覆盖，模拟输出不能证明真实模型遵循。 |
| A3 | 通过（受测快照） | 创建、列表、详情、只读 DSL 均成功；其他账号查项目 `404 not_found`；同命令 ID 重放保持修订；旧修订 `409 conflict`，附最新快照且保留现有标题。见 [接口响应](evidence/2026-10-29-api-contracts/api-probe-full.png)、Web [项目准备](evidence/2026-10-29-api-contracts/web-project-prepare.png)、桌面 [云项目列表](evidence/2026-10-29-api-contracts/desktop-cloud-project.png)。 | 当前 PostgreSQL 工作树待复测。 |
| A4 | 通过（模拟运行） | 同请求 ID 得到同一运行；同确认 ID 得到同一操作，预留额度一次、已用额度零；事件序号 `[1,2]`，从序号 1 补发只收到 2。无可灵配置时确认返回 `503 service_unavailable`，重复确认仍 503 且额度未扣。Web 停在[等待显式确认](evidence/2026-10-29-api-contracts/web-run-waiting-approval.png)。见 [模拟日志](evidence/2026-10-29-api-contracts/run-sim.json)。 | `workerEnabled=false`，没有调用真实供应商；真实付费请求、回调与结算未测。 |
| A5 | 通过（测试照片） | 有效 JPEG 上传 `201` 并获 `image/jpeg` 对象元数据；错误 MIME `415 unsupported_media`、空文件 `400 invalid_request`、超限 `413 invalid_request`；其他账号读取 `404`。Web [照片选择与上传](evidence/2026-10-29-api-contracts/web-upload.png)，见[接口响应](evidence/2026-10-29-api-contracts/api-probe-full.png)。 | 只证明这张测试照片；原始失败照片未提供，不能确认其失败根因。 |
| A6 | 阻塞（当前工作树） | 20:19 的 [API 56/56 日志](evidence/2026-10-29-api-contracts/api-test-network.log) 包含微调创建、命令、渲染、版本、跨账号隔离及原始时间线不覆盖的自动化断言。 | 独立模拟脚本在并行 PostgreSQL 迁移后因缺少 `DATABASE_URL` 中断；没有当前版本的微调／版本截图或独立接口结果，因此当前实现待复测。 |
| A7 | 部分通过 | 迁移前 API／协议／Web／桌面／移动类型检查通过；Web 和桌面 Vite 构建通过。实际打开 Web 和桌面，完成登录、云项目读取；Web [错误登录提示](evidence/2026-10-29-api-contracts/web-auth-error.png)、桌面 [错误登录提示](evidence/2026-10-29-api-contracts/desktop-auth-error.png)均显示“邮箱或密码错误”。 | 移动无模拟器／真机运行，记为未测；当前 PostgreSQL 工作树的 API 构建及运行待复测。 |
| A8 | 通过（客户端测试） | 旧 `{error}` 401 和上传错误文案被 Web 保留；共享错误解析仍能映射 `unauthorized`。新 API 的 401／400／409／415／413／503 状态与 `code` 逐项见接口结果。见 [兼容测试日志](evidence/2026-10-29-api-contracts/legacy-error-test.log)及[测试代码](evidence/2026-10-29-api-contracts/legacy-error.test.ts)。 | 未连接实际旧线上服务。 |

## 执行命令与复现

在仓库根目录执行：

```bash
pnpm --filter @ai-video/api-contracts test
pnpm --filter @ai-video/project-core test
pnpm --filter @ai-video/api test
pnpm --filter @ai-video/web test
pnpm --filter @ai-video/desktop test
pnpm --filter @ai-video/api-contracts build
pnpm --filter @ai-video/api build
pnpm --filter @ai-video/web build
pnpm --filter @ai-video/desktop build
pnpm --filter @ai-video/mobile build
./apps/web/node_modules/.bin/vitest run docs/acceptance/evidence/2026-10-29-api-contracts/legacy-error.test.ts --environment jsdom
```

迁移前日志：[协议 4/4](evidence/2026-10-29-api-contracts/contracts-test.log)、[项目内核 31/31](evidence/2026-10-29-api-contracts/project-core-test.log)、[API 56/56](evidence/2026-10-29-api-contracts/api-test-network.log)、[Web 27/27](evidence/2026-10-29-api-contracts/web-test-final.log)、[桌面 28/28](evidence/2026-10-29-api-contracts/desktop-test.log)、[Web 构建](evidence/2026-10-29-api-contracts/web-vite-build.log)、[桌面构建](evidence/2026-10-29-api-contracts/desktop-vite-build.log)、[旧错误兼容 3/3](evidence/2026-10-29-api-contracts/legacy-error-test.log)。五项类型构建对应 `*-build.log`，空日志表示当时 `tsc --noEmit` 以退出码 0 结束。首轮 Web 26 条中 2 条因客户端发送前 ID 校验而失败；该校验撤回后，最终重跑 27/27，结论采用最终日志。

手动复现：启动隔离 API 与模拟文字服务；在 Web 注册测试账号，输入“小狗做晚饭”生成三版，选择第二版并修改提示词，刷新确认保留；继续创建项目，选用测试 JPEG 并检查镜头计划，在“等待确认”停止；用另一测试账号访问项目和照片确认隔离；在桌面登录、打开云项目列表并验证错误登录提示。接口边界和幂等步骤可按 [逐项结果](evidence/2026-10-29-api-contracts/api-probe.json) 中的顺序，对 `/auth/*`、`/prompt-ideas`、`/projects`、`/objects`、`/runs` 和事件流执行。所有账号与数据位于本地隔离目录。

## 待回归项

1. 提供可用的 PostgreSQL 测试库配置后，对当前源码重跑 API 全量测试、A1–A6 接口流程及 Web／桌面联动，特别核验 A6 渲染版本和原片／时间线不覆盖。
2. 接入实际灵感服务后验证三条内容确为 5–10 秒单镜头脚本，并检查失败恢复；当前只验证了模拟文字服务。
3. 部署目标版本后，在 `39.108.55.176` 核对构建指纹、健康检查、上传与灵感流程，再出线上验收结论。
