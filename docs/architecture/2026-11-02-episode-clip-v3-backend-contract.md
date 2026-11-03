# 整集剪辑 v3 后端契约

日期：2026-11-02。状态：仓库候选；尚未发布或完成 Web／原生验收。与 TTS 和 PostgreSQL 线上版本分别验收。

## 读写接口

- `GET /api/projects/:projectId/episodes/:episodeId/timeline` 返回 `{episodeId, episodeRevision, timelineClips, audio, projectedFromLegacy}`。`audio.version` 恒为 `3`；旧项目只在响应中投影，数据库不改。服务器用 ffprobe 检查每个视频源是否有音轨；无声视频不生成原声片段。源文件缺失时返回 410，不猜测音轨。
- 写入仍使用 `POST /api/projects/:projectId/commands`，`resourceType: "episode"`、稳定命令 `id`、`baseRevision` 和完整分集 `payload`。v3 的 `payload.timeline` 必须与 `timelineClips` 逐项对应，可重复引用同一个视频资产；`payload.audio` 必须为 v3。分割、裁剪、删除既有画面时若缺少 v3 音轨，返回 409。相同命令 ID、相同内容只返回重放结果；旧修订返回 409。
- `audio.version=3` 含 `originalVolume`、`originalClips`、`voiceClips`、`musicClips`，可选 `locks`。每条原声为 `{id,visualClipId,assetId,inMs,outMs,volume,muted}`，不另存整集起点。时间都是整数毫秒、左闭右开。画面整集起点为 `S`、源入点为 `I` 时，原声源区间 `[a,b)` 映射到整集 `[S+a-I,S+b-I)`。

## 校验与播放

- 画面与原声段最短 300 ms；同一画面上的原声段不能重叠，且必须位于所属画面的同源范围。V3 最多 100 个视觉片段，时长最多 20 分钟。原声源必须真实有音轨。原声删除可从 `originalClips` 移除，静音可保留片段并设 `muted=true`。
- 旧项目的虚拟原声片段取旧 `timelineClips[].volume` 作为 `originalClips[].volume`。V3 渲染只乘每段 `volume` 与全局 `originalVolume` 各一次，不再乘旧视觉 `volume`。旧已混音语音仅属于源视频音轨。
- 画面删除后按剩余片段顺序自动合拢。保留画面上的锚定配音随所属画面新起点移动；被删画面的锚点必须移除或改为绝对时间。固定时间的配音／音乐保持原秒数。若有音频越过新片尾，保存返回 409 和响应 `conflict.affectedAudioClips`，由界面逐条提供返回调整或明确裁剪／移除；服务端不会静默截断。已锁定轨道须先单独解锁。
- 精准预览和最终导出共用 `renderEpisodeSnapshot` 与 `renderEpisodeMedia`，以同一已保存分集修订构建媒体。每次成功保存会提高分集资源修订，旧精准预览无法满足新修订的导出门禁。原始素材文件、旧导出与历史资产不会随时间线引用删除。

## 前端接入与验收边界

Web 和桌面打开旧项目时间线时应使用上述 GET 投影初始化 v3 草稿，保存时把 `sourceAudio` 写到 `audio.originalClips`；不要在客户端只凭视觉片段推断视频有原声。画面删除/裁剪的影响确认须在提交前列出每条越界配音/音乐。后端根据最终快照校验结果，无法从快照证明用户已读确认面板。

当前媒体级回归覆盖分段静音、3×5 秒源视频在 7.3 秒分割及删除后 12.3 秒成片。Web、macOS 原生、真实项目读取与用户确认操作仍须按 `docs/acceptance/2026-11-02-episode-clip-editing-v3-test-scope.md` 独立验收。
