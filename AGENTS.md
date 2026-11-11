# 项目 AI 开发规则

## 技术栈
- 前端: React 19 + TypeScript + Tailwind CSS（Web / 桌面 / 移动三端共用）
- 后端: Python (FastAPI) + PostgreSQL
- 构建: Vite（pnpm monorepo）

## 编码规范
- 禁止使用 any 类型
- 所有函数必须有 JSDoc 注释
- 组件文件命名: PascalCase.tsx
- 工具函数命名: camelCase.ts

## 架构约束
- 前端状态管理用 Zustand，禁止用 Redux
- API 调用统一走 src/api/ 目录
- 禁止在组件中直接写业务逻辑，必须抽离到 hooks

## 验证方式
- 单元测试: npm run test
- 类型检查: npm run typecheck
- Lint: npm run lint
- 构建: npm run build

## 禁止事项
- 禁止修改 src/types/ 下的类型定义
- 禁止引入新的 npm 包 (需先确认)
- 禁止跳过测试直接提交
