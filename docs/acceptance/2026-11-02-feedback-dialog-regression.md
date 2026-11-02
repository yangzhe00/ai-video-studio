# 共享提示弹框回归（2026-11-02）

## 改动范围

- `packages/components/src/feedback.ts` 集中管理警示、失败、信息、成功四类弹框文案；后续新增弹框在此登记。
- `packages/components/src/FeedbackDialog.tsx` 提供 Web/桌面共用确认、单行输入和通知弹框。支持取消、Escape、遮罩取消、焦点管理及输入校验。
- 画布删除节点、云端原文覆盖、已有视频再次生成、新建分集（Web 和桌面）已从浏览器原生确认或输入框迁移。复制分享地址失败改为共享失败弹框。
- React Native 原生 `Alert.alert` 保持平台原生交互；页面内的加载、校验和任务状态仍在对应位置展示。

## 自动化验证

| 范围 | 结果 |
| --- | --- |
| components TypeScript | 通过 |
| Web TypeScript | 通过 |
| Desktop TypeScript | 通过 |
| components Vitest | 8/8 通过 |
| Web Vitest 完整套件 | 41/44 通过；3 条灵感/账号流程测试失败，见下方说明 |
| Web 定向：画布交互 | 4/4 通过 |
| Web 定向：云端原文冲突确认 | 1/1 通过 |
| Desktop Vitest | 38/38 通过 |
| Web Vite 生产构建 | 通过 |
| Desktop Vite 生产构建 | 通过 |
| `node scripts/check-boundaries.mjs` | 通过 |
| `git diff --check` | 通过 |
| `rg` 搜索 Web/桌面/画布中的 `window.confirm/prompt/alert` | 无剩余调用 |

行为测试覆盖删除的取消与确认、Escape 安全取消、新建分集空白输入禁用及首尾空格处理、失败弹框关闭。未调用真实付费生成服务。

**完整套件当前缺口：** 08:16 复跑 Web 时，`App.test.tsx` 的“后台轮询时灵感按钮稳定”、“选灵感后先检查镜头计划”、“切换账号后屏蔽旧账号列表”3 条测试失败，均未进入共享弹框断言。其余 41 条通过；这 3 条属于当前并行修改中的灵感/账号流程，需由对应功能回归后复测。此次弹框相关定向测试通过，不能以此代替 Web 完整套件通过。

## 视觉回归

使用 `apps/web/feedback-preview.html` 载入真实画布和共享弹框，模拟项目数据；截图来自浏览器实际渲染。弹框位于视口中央，按钮、标题和正文在浅色、深色、390px 和 320px 视口中均可见，没有裁切、覆盖或错位。移动宽度下背景画布会按既有布局缩放；本次验收聚焦弹框。

| 场景 | 截图 |
| --- | --- |
| 桌面 1280×720，浅色删除警示 | [01-desktop-cream-warning.jpg](./evidence/2026-11-02-feedback-dialog/01-desktop-cream-warning.jpg) |
| 桌面 1280×720，深色删除警示 | [02-desktop-dark-warning.jpg](./evidence/2026-11-02-feedback-dialog/02-desktop-dark-warning.jpg) |
| H5 390×844，深色删除警示 | [03-h5-390-dark-warning.jpg](./evidence/2026-11-02-feedback-dialog/03-h5-390-dark-warning.jpg) |
| H5 390×844，新建分集输入 | [04-h5-390-dark-input.jpg](./evidence/2026-11-02-feedback-dialog/04-h5-390-dark-input.jpg) |
| H5 390×844，复制失败 | [05-h5-390-dark-failure.jpg](./evidence/2026-11-02-feedback-dialog/05-h5-390-dark-failure.jpg) |
| H5 320×568，复制失败 | [06-h5-320-dark-failure.jpg](./evidence/2026-11-02-feedback-dialog/06-h5-320-dark-failure.jpg) |

## 测试交接

1. 在画布选中有连线的文本或视频节点，点击“删除节点”；取消后节点与连接保持，确认后节点及其关联连接移除。
2. 画布原文冲突出现时，验证“确认覆盖”仅在二次确认后提交，取消保留当前云端版本。
3. 已有视频节点再次生成时，确认先显示警示；取消不发起新任务。
4. Web/桌面新建分集时验证默认名称、空白名称禁用、取消不创建、提交后名称去除首尾空格。
5. 分享地址复制失败时验证失败提示可关闭；正常复制应关闭分享弹框。
6. 两套主题与 320px、390px、桌面宽度检查弹框位置、焦点、Tab 循环、Escape 和遮罩取消。

原生移动端的系统弹框、真实付费生成、安装包与生产部署不在此次可视化回归范围内。
