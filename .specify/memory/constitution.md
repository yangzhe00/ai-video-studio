# Taskify（视频成片工作台）Constitution

## Core Principles

### I. 文档驱动（SDD）
规格先行：任何功能实现前必须有 spec → plan → tasks 三级产出并经确认。上游产品文档位于 `docs/product/`（01-业务界定 ~ 04-交互定义），实现与文档冲突时以文档为准，文档缺失时以 constitution 与澄清记录为准。

### II. Provider 抽象（NON-NEGOTIABLE）
所有外部能力——视频生成（可灵）、生图、LLM、TTS（火山引擎）、对象存储、短信——必须经 Provider 接口抽象，业务代码不得直接依赖具体供应商 SDK。每个 Provider 必须有 Mock 实现（演示/开发模式默认使用 Mock），真实实现可插拔切换。

### III. 可移植分层
一期 Web-only（端型矩阵已确认，移动端/小程序/桌面壳层暂不做）。但 `packages/*`（ui/hooks/api-client/shared）与平台无关，禁止引入 window/浏览器专有 API 而不抽象；保证后期加 Tauri/Capacitor 壳层零改造成本。

### IV. 编码纪律（来自 AGENTS.md）
- 前端：React 19 + TypeScript + Tailwind CSS + Vite + Zustand（禁 Redux、禁 any）
- 所有函数有 JSDoc；组件 PascalCase.tsx；业务逻辑抽 hooks，组件不写业务；API 调用统一走 api-client 层
- 后端：Python (FastAPI) + PostgreSQL + ffmpeg 合成；参数绑定防注入；密钥全部走环境变量

### V. 测试与质量门禁
每个功能模块交付前必须通过：`typecheck` / `lint` / `test` / `build`（适用哪个跑哪个）。禁止跳过测试直接提交。

## 安全与数据约束

- 行级数据隔离：用户仅可见自己的素材、任务、成片（服务端强制，前端过滤不可作为唯一手段）
- 已确认的登录方案：手机号 + 短信验证码；一期演示模式默认 Mock 验证码（固定码），真实短信 Provider 预留（腾讯云/阿里云，约 0.045~0.05 元/条，需签名报备）
- 额度模型（已确认）：每个用户独立额度，按任务扣减，提交前预检，低于阈值预警
- 内容量化参数（已确认）：选题每次生成 5 条；讲稿目标时长 5~10 秒/段（若指全片总时长需回改 spec）；超时阈值生视频 15 分钟 / 合成 30 分钟；额度预警阈值 20%；素材单文件上限 20MB（jpg/png/webp）；版本历史保留最近 10 版

## 暂不纳入（一期禁止实现）

多人协作/角色权限、平台分发、数字人口播、移动端/小程序、模板自定义编辑界面、自录音频上传、用户自建额度充值。

## Governance

Constitution 优先级高于所有开发习惯与个人偏好。修订需记录变更原因并在 spec/plan 中同步。实现过程中发现的文档缺口须回写 `docs/product/` 或本文件，不得口头约定。

**Version**: 1.0.0 | **Ratified**: 2026-11-11 | **Last Amended**: 2026-11-11
