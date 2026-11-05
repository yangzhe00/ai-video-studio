# 整集文字旁白：后端预检与测试交接

日期：2026-11-02（北京时间）。范围：仓库候选后端与本机、服务器**只读**配置审计；没有改动线上服务，也没有发起真实 TTS 付费请求。
本报告基于 `257b1bb` 加当前未提交改动；前后端并行工作仍在继续，须在合并后另行冻结完整候选 SHA，不能把此基线提交号当作最终候选版本。

## 官方接口与费用边界

- [可灵 TTS API](https://kling.ai/document-api/api/video/avatar/text-to-speech) 使用新加坡区域 `POST /v1/audio/tts`，文本最多 1000 字符，`voice_language` 为 `zh`/`en`，语速 0.8–2.0；音色 ID 与语种须按官方 Voice Guide 和账号实测核对。文档示例 `oversea_male1` 是英文音色，不能据此假定中文音色或本账号权限。
- [可灵账号资源查询](https://kling.ai/document-api/api/assets/account-usage) 的 `GET /account/costs` 免费，限制 QPS≤1。成功仅能证明当前区域的密钥通过账号认证，**不能证明 TTS 模型和某个中文音色有权限**。后端将查询合并并缓存一分钟。
- [可灵公开 API 价格页](https://kling.ai/dev/pricing) 未给出本独立 TTS 接口可核实的固定单价；因此当前报价继续返回 `estimatedCost=null`、`billingPolicy=actual-usage`，不得向用户承诺确定金额。真实任务完成后记录供应商返回的扣费字段。
- 若可灵账号无法开通此接口，可评估[腾讯云语音合成 API](https://cloud.tencent.com/document/api/1073/127845)及其[在线版计费](https://cloud.tencent.com/document/product/1073/34112)：支持中文音色，按字符和音色档位计费。切换前还需新账号/密钥、音色与试听、商用授权、数据处理区域及费用规则确认；目前**未接入**该供应商。

## 脱敏配置审计

| 环境 | TTS 密钥 | 中文音色列表 | TTS 区域 | 其他观察 |
| --- | --- | --- | --- | --- |
| `/private/tmp/avs-web-test-20261102/api.env` | 缺失/空 | 缺失/空 | 未显式配置，代码默认新加坡 | 本机测试环境。 |
| `/private/tmp/avs-web-test-20261102/api-cursor.env` | 缺失/空 | 缺失/空 | 未显式配置，代码默认新加坡 | 本机测试环境。 |
| 服务器 `/etc/ai-video-studio/api.pg.env` | 缺失/空 | 缺失/空 | 未显式配置，代码默认新加坡 | 视频密钥存在，**未**复用为 TTS 密钥。 |

服务器只读查询显示当前容器镜像为 `ai-video-studio-api:257b1bb-schema4`，PostgreSQL `api_schema_version=4`。这比旧部署文档中的 schema 1 快照更新；本次未读取或输出任何密钥值，也未修改服务器配置。由于 TTS 密钥和中文音色均缺失，当前线上/本机均不能宣称真实中文旁白可用。

## 本轮后端改动

1. 未配置 `KLING_TTS_VOICES_JSON` 时不再默认展示官方英文示例音色；`GET /tts/voices` 增加 `availability` 和安全的 `message`。配置存在但区域账号认证失败时仍返回空音色。账号查询通过时状态为 `account_verified`，名称刻意不表示 TTS 模型权限已验证。
2. 报价和创建新任务前执行同一账号可用性门禁；未配置/认证失败/权限被拒/查询暂不可用返回 503，不生成报价或付费任务。原有任务仍可按 `clientRequestId` 或任务 ID 查询。
3. 供应商明确拒绝时区分密钥/区域、TTS 权限、余额/额度与输入/音色问题；HTTP 408、网络异常、5xx 保留 `unknown`，不得盲目重复 POST。成功 MP3 仍按原有链路探测并登记为 `voice` 资产，不自动进入音乐轨或自动导出。

## 验证与剩余门禁

- 隔离 PostgreSQL API 全量测试：`TEST_DATABASE_URL=... pnpm --filter @ai-video/api exec vitest run --maxWorkers=1`，26 个文件、119 项通过。共享契约 `build` 与 9 项测试通过；`pnpm build`（API、Web、桌面、移动工作区）、`pnpm check:boundaries`、`git diff --check` 通过。TTS 定向测试覆盖 401/1002、403/1103、余额、未知提交、同一请求 ID、成功资产与跨账号边界。
- 真实中文 TTS 任务、音频和整集 MP4：**阻塞**，原因是没有可用的独立 TTS 凭据、经账号验证的中文音色和可核实的实际费用。模拟音频测试只验证管线，不代表真实生成。
- 配置具备后：先免费查账号认证及额度，再用测试账号确认费用与一次真实短文案提交；保存 `clientRequestId`、供应商任务 ID、成本状态、voice 对象 ID 和 `ffprobe` 结果。响应未知先查原任务；完成后由测试会话验证 Web/桌面配音轨、刷新恢复、精准预览与整集导出的可听中文旁白。

测试会话应将 E10/V02–V04 保持“阻塞”，直到真实供应商音频、双端截图和成片证据齐备。
