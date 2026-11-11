# Tasks: 视频成片工作台一期

**Input**: plan.md + spec.md（specs/001-video-workbench/）

## Phase 1: Setup

- [ ] T001 pnpm workspace 根配置（package.json/pnpm-workspace.yaml/tsconfig base/.gitignore）
- [ ] T002 [P] packages/shared：类型定义（与后端契约对齐）、任务状态机枚举、常量（数值默认值集中此处可配置）
- [ ] T003 [P] packages/api-client：fetch 封装、鉴权拦截、401 跳登录保留当前页
- [ ] T004 [P] apps/web 脚手架：Vite+React19+TS+Tailwind+Router+Zustand，7 个一级页面空壳+登录页
- [ ] T005 [P] server 脚手架：FastAPI+SQLAlchemy+pydantic-settings，.env.example，health check
- [ ] T006 验证：web build/typecheck/lint 通过；server 启动 /api/health 200

## Phase 2: Foundational（阻塞所有用户故事）

- [ ] T007 数据库模型：users/sessions/quota_ledger/topics/scripts/assets/tasks/clips/templates/compositions（含状态机约束）
- [ ] T008 core：配置管理（环境变量）、JWT 鉴权依赖、行级隔离依赖（user_id 强制过滤）、统一异常处理
- [ ] T009 Provider 框架：基类接口 + provider 注册表 + Mock 实现（视频/生图/LLM/TTS/Sms/Storage 全量）
- [ ] T010 任务执行框架：asyncio 后台 worker、状态机流转函数（唯一入口，防非法流转）、失败分类写入、可灵真实 Provider 骨架（无 Key 时回退 Mock）
- [ ] T011 额度服务：扣减/预检/预警(20%)，与任务提交联动
- [ ] T012 ffmpeg 合成服务：片段+TTS+字幕+模板 → 9:16 mp4（本地文件输出）
- [ ] T013 验证：pytest 通过（状态机流转、额度扣减、Provider Mock 单测）

## Phase 3: US1 登录与隔离 (P1)

- [ ] T014 auth API：send-code（Mock 返回 code）/login/me，60s 防刷
- [ ] T015 [P] web 登录页：手机号+验证码、演示模式提示、登录后回跳
- [ ] T016 全局路由守卫：未登录跳登录；布局壳（左侧导航 7 页 + 右上用户信息/退出）
- [ ] T017 验证：双账号数据隔离冒烟（登录 A 看不到 B 的任务）

## Phase 4: US2 选题与讲稿 (P1)

- [ ] T018 topics/script API：generate(5条)/list/select/script 生成/编辑保存/prompts 生成/草稿恢复删除
- [ ] T019 [P] web 选题页：关键词输入→选题卡片列表→选定→讲稿分段编辑→提示词生成→保存草稿
- [ ] T020 验证：黄金任务流前半段（关键词→5 选题→讲稿 5 段→提示词）Mock 跑通

## Phase 5: US3 素材与生视频 (P1)

- [ ] T021 assets API：批量上传（jpg/png/webp ≤20MB 校验）/生图任务/列表
- [ ] T022 [P] web 素材库页：上传（拖拽）、AI 生图入口、素材网格
- [ ] T023 video-gen API：额度预检+任务创建（段↔图↔提示词关联）
- [ ] T024 [P] web 生成任务页：逐段关联图文、提交、片段预览/重新生成/删除；七类交互状态全覆盖
- [ ] T025 验证：上传→生图(Mock)→关联提交→片段生成(Mock)→预览

## Phase 6: US4 模板合成与配音字幕 (P1)

- [ ] T026 templates API + 内置「简约生活风」种子数据
- [ ] T027 TTS API：分段配音（试听）+ 句级字幕生成（可改字）
- [ ] T028 compose API：要素校验（缺什么列什么）→ 合成任务 → 成片入库+版本号
- [ ] T029 [P] web 合成工作台页：模板选择器、配音试听、字幕编辑、要素清单、提交
- [ ] T030 验证：片段+配音+模板 → ffmpeg 合成出 9:16 mp4（ffmpeg 真实跑通）

## Phase 7: US5 导出与版本 (P2)

- [ ] T031 output API：成片列表/版本历史(10 版上限)/下载（文件名含选题+日期）
- [ ] T032 [P] web 成片库页：预览播放器、下载、版本对比、删除
- [ ] T033 验证：预览+下载文件名正确；第 11 版触发清理

## Phase 8: US6 任务中心 (P2)

- [ ] T034 tasks API：筛选(type/state)、批量重试、跳回来源页参数
- [ ] T035 [P] web 任务中心页：看板+筛选器+失败分类标签+重试规则（审核不通过不自动重试/参数错误先改）
- [ ] T036 验证：Mock 失败注入→分类可见→改参重试成功

## Phase 9: US7 用量与额度 (P3)

- [ ] T037 quota API：余额+明细分页
- [ ] T038 [P] web 用量页：余额卡、预警条(20%)、明细表
- [ ] T039 验证：提交前预检拦截路径复现

## Phase 10: Polish

- [ ] T040 README（启动命令/环境要求/演示流程）+ quickstart
- [ ] T041 全量门禁：web build+typecheck+lint+test / server pytest 全绿
- [ ] T042 黄金任务流端到端演示走查（Mock 模式）

## Dependencies

Phase1→Phase2 阻塞；US1(Phase3)→US2→US3→US4→US5 顺序依赖（黄金任务流链）；US6/US7 依赖 Phase2 后可并行。

**执行策略**：单agent顺序执行，每 Phase 完成跑对应验证，全绿后进下一 Phase。
