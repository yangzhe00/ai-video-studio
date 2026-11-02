# Docker 切换后线上浏览器回归（2026-10-30）

## 范围与结论

目标：`https://39.108.55.176/`。本次发布仅切换 API 运行方式；网页仍由原 Nginx 容器提供，线上仍为 SQLite schema 9。使用浏览器和隔离测试账号回归，停在视频生成前，没有点击任何消耗可灵额度的生成或确认按钮。

**结论：主要页面与账号、项目、照片链路通过；灵感生成未通过。** 灵感页面出现明确的重试和手写入口。已持久化的测试灵感为 `failed`、`errorCode=provider_error`；它是产品功能故障，现有证据不能确定由本次 Docker 切换引起。此前线上灵感就未恢复；本次错误码由先前缺配置情形变化为供应商错误，需读取容器内安全日志继续定位。

## 逐项结果

| 项目 | 结果 | 实际观察 |
| --- | --- | --- |
| 首页可打开 | 通过 | 浏览器加载登录页；已登录后工作台可见。“今天想拍什么？”仍是原网页版本，符合本次只切换 API 的范围。首页 HTTPS `200`，`/api/health` `200`。 |
| 注册／登录 | 通过 | 新建隔离测试账号后进入工作台；退出后以同一账号重新登录成功，测试项目和灵感失败记录仍可读取。API 登录独立复核 `200`。 |
| 创作／项目列表 | 通过 | 空项目列表显示新建入口；创建测试项目后进入创作页，重新登录后可继续创作。 |
| 灵感生成 | **未通过** | 输入“小狗在厨房做晚饭”后，页面显示“灵感服务暂时不可用，请稍后再试或手写提示词”，提供“重新获取灵感 / 手写提示词继续”。`GET /api/prompt-ideas` 为 `200`，记录 `state=failed`、`errorCode=provider_error`、三版数 0；同请求 ID 重放 `POST /api/prompt-ideas` 为 `200`，返回相同失败记录，没有再发起新一轮供应商请求。浏览器首次提交的 HTTP 状态未被捕获，不将重放状态冒充首次状态。 |
| 照片上传 | 通过 | 浏览器上传有效 64×64、249 字节 JPEG，创作页显示 `photo.jpg`；资产页显示 1 个素材。架构侧另用公网 HTTPS 测试账号确认 `/api/objects` `201`。本测试没有用用户原始失败照片。 |
| 页面导航 | 通过 | 首页、创作、项目列表、画布、结果、资产均可进入；画布展示第 1 集空节点，结果页展示空状态，资产页显示测试照片。 |
| 浏览器控制台 | 通过（本次覆盖） | 本次标签页收集到的 `error/warn/warning` 条目为 0，见[原始记录](/Users/yangzhe/Documents/ChatGPT/剪辑/docs/acceptance/evidence/2026-10-30-docker/browser-console-errors.json)。这不替代容器服务端日志。 |

## HTTP／API 异常

- 首页 `200`，`/api/health` `200`，测试账号登录 `200`。
- 灵感列表 `200`，但业务记录为 `failed/provider_error`，见[脱敏接口记录](/Users/yangzhe/Documents/ChatGPT/剪辑/docs/acceptance/evidence/2026-10-30-docker/idea-api-status.json)。相同请求 ID 的安全重放为 HTTP `200`，仍为 `failed/provider_error`，见[重放记录](/Users/yangzhe/Documents/ChatGPT/剪辑/docs/acceptance/evidence/2026-10-30-docker/idea-replay-status.json)。接口没有在顶层返回 HTTP 错误码；错误在 `ideaSet.errorCode`。
- 浏览器上传成功并在资产中可见。架构侧独立上传响应为 `201`；本浏览器回归没有记录该次上传的原始 HTTP 状态。
- 架构侧确认 Docker 容器带凭据访问 Cursor Agents 接口为 `200`，宿主机无凭据访问为 `401`。这证明基础出站及凭据生效，但不足以证明创建灵感运行、轮询和三版解析均正常。服务端原始日志读取受审批阻塞，根因尚未确认。

## 截图（绝对路径）

- [登录页](/Users/yangzhe/Documents/ChatGPT/剪辑/docs/acceptance/evidence/2026-10-30-docker/online-login.png)
- [已登录首页](/Users/yangzhe/Documents/ChatGPT/剪辑/docs/acceptance/evidence/2026-10-30-docker/online-home.png)
- [灵感失败及恢复入口](/Users/yangzhe/Documents/ChatGPT/剪辑/docs/acceptance/evidence/2026-10-30-docker/online-idea-failure.png)
- [创作页](/Users/yangzhe/Documents/ChatGPT/剪辑/docs/acceptance/evidence/2026-10-30-docker/online-creation.png)
- [测试照片已上传](/Users/yangzhe/Documents/ChatGPT/剪辑/docs/acceptance/evidence/2026-10-30-docker/online-upload.png)
- [资产页可读取照片](/Users/yangzhe/Documents/ChatGPT/剪辑/docs/acceptance/evidence/2026-10-30-docker/online-assets.png)

## 发布回归与既有问题的边界

本次 API Docker 切换没有在已覆盖的账号、项目、上传和页面读取流程中出现新回归。灵感功能在切换前已是待修复项，本次仍不可用；当前 `provider_error` 与之前的缺配置提示不同，需要后端依据同一测试请求的容器日志定位供应商请求、轮询或解析阶段。测试账号的正常 UI 不能证明真实视频生成可用；按约束未执行付费视频链路。
