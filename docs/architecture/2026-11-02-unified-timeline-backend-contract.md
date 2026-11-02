# 整集时间线后端契约（候选）

日期：2026-11-02。实现范围：共享音轨数据、分集命令、精准预览、整集导出。`CloudEpisode.audio` 是分集配音与音乐的唯一写入来源；`timeline/timelineClips` 是画面顺序与原声音量的写入来源。三层 DSL 的 voice/music tracks 由这些字段只读投影，不再反向写回。单镜头已混音 MP4 的声音作为该视觉片段的原声播放，不自动复制成分集 voice clip。

## 版本与读取

旧分集的 `audio` 没有 `version`，片段也没有 `id`/`anchor`。读取时 `projectEpisodeAudio(episode)` 为每段旧 voice/music 生成确定性展示 ID 和 `{ "kind": "absolute" }` 锚点，保留原 `startMs`；此操作不改数据库。旧 5/10 秒镜头按原长度读取。新数据使用 `audio.version=2`，每段必须有稳定 `id`、`anchor`、`startMs`、`inMs`、`outMs`、`volume`。时间为整数毫秒；v2 截取长度至少 300 毫秒。`anchor.kind="visual-clip"` 以视觉片段 ID 加 `offsetMs` 定位，服务端在保存和渲染时重新计算 `startMs`；`anchor.kind="absolute"` 保持绝对起点。

空分集：

```json
{"id":"episode-0001","title":"第 1 集","shots":[],"timeline":[],"timelineClips":[],"audio":{"version":2,"originalVolume":1,"voiceClips":[],"musicClips":[]}}
```

三段各 5 秒镜头、两段语音和一段音乐的示例（素材 ID 和片段 ID 在真实请求中应使用各自的稳定 ID）：

```json
{
  "id":"episode-0001","title":"第 1 集","shots":[],
  "timeline":["video-0001","video-0002","video-0003"],
  "timelineClips":[
    {"id":"visual-0001","assetId":"video-0001","inMs":0,"outMs":5000,"volume":1},
    {"id":"visual-0002","assetId":"video-0002","inMs":0,"outMs":5000,"volume":0},
    {"id":"visual-0003","assetId":"video-0003","inMs":0,"outMs":5000,"volume":0.5}
  ],
  "audio":{"version":2,"originalVolume":1,"voiceClips":[
    {"id":"voice-clip-0001","assetId":"voice-asset-0001","startMs":4200,"inMs":0,"outMs":3000,"volume":1,"anchor":{"kind":"visual-clip","clipId":"visual-0001","offsetMs":4200}},
    {"id":"voice-clip-0002","assetId":"voice-asset-0002","startMs":10000,"inMs":500,"outMs":4000,"volume":0.8,"anchor":{"kind":"absolute"}}
  ],"musicClips":[
    {"id":"music-clip-0001","assetId":"music-asset-0001","startMs":0,"inMs":0,"outMs":15000,"volume":0.25,"anchor":{"kind":"absolute"}}
  ]}
}
```

第一段语音跨 5 秒镜头切点。`timelineClips[].volume` 仅控制该视觉片段的原声，`audio.originalVolume` 是整集原声总音量；旧单镜头混音语音不会再自动叠加。移除音轨片段只移除 `audio` 中的引用，不删除素材对象。

## 写入、冲突和素材

1. `GET /projects/:id` 取得完整 `document` 与 `resourceRevisions`；页面使用 `projectEpisodeAudio` 获取可显示的全部音轨片段。编辑时保留完整分集字段，不用 DSL tracks 覆写源文档。
2. 有效 MP3/WAV/M4A 先 `POST /objects`，服务端 `ffprobe` 校验真实内容和时长；再以 `resourceType="asset"` 的项目命令登记为 `voice` 或 `music`。TTS 成功资产也须先可见，再由用户加入时间线；费用确认和原任务查询仍沿用现有 TTS API。
3. 松手或字段提交后一次 `POST /projects/:id/commands`：`{"id":"稳定命令 ID","resourceType":"episode","resourceId":"分集 ID","baseRevision":当前分集资源修订,"payload":完整分集}`。重复同一命令返回 `replayed=true` 和原 `resourceRevision`；同 ID 不同内容返回 409。两个客户端争用旧修订返回 409，并附当前资源快照，前端保留本地草稿。
4. 新音轨引用的素材必须已登记到当前项目且由当前账号拥有；失效文件返回 410，跨账号或不存在返回 404，非法截取与超出分集返回 400。已有 v2 音轨的分集拒绝旧格式或缺失音轨的覆盖写入，返回 409 并提示使用新版编辑器。

## 精准预览与导出

`POST /projects/:id/episodes/:episodeId/previews` 接收 `previewOperationId` 和 `expectedEpisodeRevision`；`GET /previews/:id` 查询结果。新编辑将分集资源修订加一，旧预览查询返回 409。`POST /projects/:id/episodes/:episodeId/render` 接收 `renderOperationId` 和相同的 `expectedEpisodeRevision`；v2 音轨须先有该修订的成功、未过期精准预览。预览与导出均冻结同一分集快照并调用同一媒体渲染函数；重复请求沿用原 operation。输出是新 MP4，原始素材、旧镜头编辑版和旧成片保留。

预览或导出失败时，`operation.error` 只返回可展示的固定文案，例如“画面素材丢失或无法读取，请恢复原素材或重新上传后重试”；ffprobe/FFmpeg 命令、对象存储绝对路径与堆栈仅写服务端日志。读取历史失败任务也会过滤旧版原始错误。素材恢复后，同一分集修订重复提交会沿用原 operation ID，将失败任务重置为 `pending`；已成功的旧成片仍保留。

## 数据迁移与回退

本改动不增加 PostgreSQL 表或 DDL，不运行 schema 升级。发布前只读统计旧分集音轨数量、素材引用、预览/导出任务和媒体路径，并备份项目 JSON 与对象目录；对样本执行旧版投影和新版读取对比。旧记录保持原格式，首次使用新版编辑器保存时写入 v2，生成的片段 ID 随后持久保存。旧客户端可以读取共享项目，但无法写回已有 v2 音轨的分集；需要提示升级，避免丢失锚点和隐藏音轨。若需回退服务端，应先冻结写入并核对是否已有 v2 分集；有新写入时先制定向前修复或数据对账，不能盲目恢复旧备份。
