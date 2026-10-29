# 三层项目 DSL 设计：基础 → 片段 → 资产

**状态：** 三层 schema 与旧格式转换已落地；API 目前只读投影，运行中的项目写入格式仍为旧版。

## 目标和现状

一个项目需要在桌面、网页和移动端表达同一组分集、镜头、时间线与媒体版本。桌面现在使用 `ProjectManifestV2`：素材、片段、字幕、任务与 `studio` 同处一份清单；画布图已逐步迁入 `extensions.canvas`。云端另用 `CloudProjectDocument` V1，其中分集的 `timeline: string[]` 正在扩展为带 ID、裁剪范围和音量的 `timelineClips`。两套格式不能直接视为同一个 DSL。现有视频微调配方和服务端运行账本也各有自己的版本与生命周期。

目标是形成**一个项目语义**、明确的三层依赖和可验证的迁移路径。一个画布对应一个分集；视频节点对应一个镜头意图；用户逐节点启动生成。原始照片、生成视频、编辑后视频都是可追溯的资产版本。片段固定引用一个资产 ID，生成或编辑出新版本时不悄悄替换现有时间线片段。

## 方案取舍

| 方案 | 优点 | 代价与结论 |
| --- | --- | --- |
| 继续分别扩展本地 V2 和云端 V1 | 改动少 | 字段和语义会继续分叉，不选 |
| **版本化 JSON 项目 DSL，加本地/云端适配器** | 可在当前 TypeScript workspace 中验证和迁移，三端共享语义 | 需要一次显式迁移与双读过渡，**推荐** |
| 从一开始设计独立文本语言或全部改为关系表 | 查询和语法扩展空间大 | 与当前项目规模不符，迁移和编辑成本过高，不选 |

DSL 的结构与跨层校验由独立 workspace 包 `@ai-video/project-schema`（Zod 3.25.76）定义；`project-core` 负责旧格式迁移和领域操作。DSL 是**逻辑模型**，不是要求云端把所有内容存成一份整体 JSON，也不要求桌面立刻改写 Rust 持久化格式。云端继续按分集、资产、人物和画布资源维护版本；服务器可组合或投影为该 DSL。过渡期间本地 V2 仍是本地磁盘唯一写入格式，由适配器转成共享 DSL；无法由旧 UI 编辑的音轨、场景版本和未知扩展必须作为版本化原始 DSL 快照保存在本地 V2 的 `extensions.projectDslSnapshot` 中，局部编辑仅修改对应字段，禁止从旧 V2 可见字段重建整份文档。该快照只存云端 DSL 原文，上传前从项目扩展中剔除 `projectDslSnapshot` 自身，避免递归。稳定后再单独决定是否切换磁盘格式。媒体二进制、对象存储位置、账号权限、运行事件与付费操作均在各自系统保存。

## 层级与引用方向

```text
基础层 VideoProjectV1
  ├─ ProjectMetadata / CanvasConfig / RenderConfig
  ├─ Character[] ───────────────────────────────┐
  ├─ Episode[]                                    │
  │   ├─ Scene[]（镜头意图和版本选择）─────────────┤
  │   └─ TimelineTrack[]                          │
  │        └─ TimelineClip[]（位置、裁剪、音量）─────┤
  ├─ extensions.canvas（逐集节点图，插件所有）──────┤
  └─ ProjectAssets ───────────────────────────────┘
       └─ Asset[]（照片、视频、配音、音乐、字幕、封面）
```

“基础 → 片段 → 资产”指**依赖方向**：项目/分集拥有片段；片段只通过稳定 ID 引用项目级资产；资产不反向拥有片段。资产目录与分集并列存于项目根，以便跨分集复用。截图里的 `Scene[]` 与 `TimelineTrack[]` 因“一画布一分集”而落在 `Episode` 内。截图里的 `AiRunMetadata` 改为场景和资产的最小运行引用；运行状态仍以服务端 `agent_runs`、`operations`、`run_events` 为准。

## 规范性数据契约

下列字段名和取值是 V1 契约。`schema` 与 `dslVersion` 用来区别当前本地 `version: 2` 和云端 `version: 1`，不能仅凭整数判断。

```ts
type Id = string; // 非空、项目范围内稳定；迁移时保留原 ID
type Millis = number; // 非负安全整数；区间采用 [start, end)

interface VideoProjectV1 {
  schema: "ai-video/project";
  dslVersion: 1;
  projectId: Id;
  metadata: { title: string; createdAt?: string };
  canvasConfig: { width: number; height: number }; // 当前默认 1080 x 1920
  renderConfig: { fps: number; format: "mp4" };      // 当前默认 30 fps
  characters: CharacterV1[];
  episodes: EpisodeV1[];
  assets: { items: AssetV1[] };
  extensions?: Record<string, unknown>;
}

interface CharacterV1 {
  id: Id;
  name: string;
  description: string;
  referenceAssetId: Id; // ImageAsset
}

interface EpisodeV1 {
  id: Id;
  title: string;
  scenes: SceneV1[];
  tracks: TimelineTrackV1[];
  publishingCopy: string;
  cover: { assetId: Id; sourceTimeMs: Millis } | null;
}

interface SceneV1 {
  id: Id; // 当前 MVP 的一个镜头意图；不是 runId
  prompt: string;
  sourceAssetId: Id; // 已确定参考照片时才创建 Scene；ImageAsset
  outputAssetIds: Id[]; // 所有成功保存的生成/编辑版本，按创建顺序
  selectedAssetId: Id | null; // 当前预览版本；必须属于 outputAssetIds
  runIds: Id[]; // 仅引用运行账本；状态/费用/供应商字段不写进 DSL
}

interface TimelineTrackV1 {
  id: Id;
  kind: "visual" | "voice" | "music" | "subtitle" | "audio";
  clips: TimelineClipV1[];
}

type TimelineClipV1 =
  | { kind: "video"; id: Id; startMs: Millis; assetId: Id; inMs: Millis; outMs: Millis; volume: number }
  | { kind: "image"; id: Id; startMs: Millis; assetId: Id; durationMs: Millis }
  | { kind: "voice" | "music" | "audio"; id: Id; startMs: Millis; assetId: Id; inMs: Millis; outMs: Millis; volume: number }
  | { kind: "subtitle"; id: Id; startMs: Millis; assetId: Id; durationMs: Millis };

interface AssetBaseV1 {
  id: Id;
  name: string;
  provenance?: { sourceAssetIds?: Id[]; runId?: Id; recipeId?: Id };
}

type AssetV1 =
  | (AssetBaseV1 & { kind: "image" | "thumbnail"; mimeType: string | null; width: number | null; height: number | null })
  | (AssetBaseV1 & { kind: "video"; mimeType: string | null; durationMs: Millis | null; width: number | null; height: number | null })
  | (AssetBaseV1 & { kind: "voice" | "music" | "audio"; mimeType: string | null; durationMs: Millis | null })
  | (AssetBaseV1 & { kind: "subtitle"; format: "plain"; text: string });
```

`audio` 仅用于无法可靠区分配音/音乐的旧素材；新导入时明确选择 `voice` 或 `music`。普通手工字幕的文本是 `subtitle` 资产，字幕出现的时间属于 `SubtitleClip`。将来导入 SRT/VTT 时新增带版本的字幕资产变体，不把 V1 `plain` 的解释悄悄改变。封面既可引用图像/缩略图资产，也可引用视频资产的有效帧；`sourceTimeMs` 对静态图像必须为 0。只有完整的镜头意图（已选参考照片、有效提示词）才生成 `Scene`；未填完的视频节点仅留在画布图。首次运行前先以独立的 `sceneId` 保存场景，再创建 `runId`。历史云镜头中 `shot.id === runId` 的值可以原样保留作 `Scene.id`，但新运行不得再依赖两者相等。

资产 ID 由云端对象台账或本地资产绑定表解析为实际媒体；DSL 不含 `objectId`、桌面绝对路径、短期签名 URL 或密钥。离线桌面的绑定表记录 `assetId → relativePath / cloudObjectId / uploadState`；上传成功后保持资产 ID，不要求改写所有片段。云端新增 `(projectId, assetId) → objectId` 绑定，服务器先核验对象所有权再登记。现有云资产的 ID 本来等于对象 ID，迁移时建立 `assetId = objectId` 的绑定；新上传的本地资产保持本地 ID，绑定到新对象 ID。已经关联云端、且本地 ID 与旧云端 ID 不同的项目继续保留现有 `assetMap` 别名，不重命名任何一端已有片段。生成、预览、编辑和渲染接口收到的是项目资产 ID，服务端统一解析对象 ID；预览通过受鉴权的 `/v2/projects/:projectId/assets/:assetId/content` 解析，不把裸对象 ID 发给客户端当项目身份。媒体类型、时长或尺寸暂时无法探测时使用 `null`，不可猜值；渲染/生成前必须由服务端或可信本地探测补全。若旧媒体暂缺，记录在本地绑定/同步状态，不把 `missing` 当作跨端媒体事实。

## 最小示例

照片生成视频、加入时间线时，项目文档的关键部分如下。省略的数组在真实文档中仍须存在。

```json
{
  "schema": "ai-video/project",
  "dslVersion": 1,
  "projectId": "project-1",
  "metadata": { "title": "短片" },
  "canvasConfig": { "width": 1080, "height": 1920 },
  "renderConfig": { "fps": 30, "format": "mp4" },
  "characters": [],
  "episodes": [{
    "id": "episode-1", "title": "第 1 集", "publishingCopy": "", "cover": null,
    "scenes": [{
      "id": "scene-1", "prompt": "小狗走进厨房", "sourceAssetId": "photo-1",
      "outputAssetIds": ["video-1"], "selectedAssetId": "video-1", "runIds": ["run-1"]
    }],
    "tracks": [{
      "id": "visual-1", "kind": "visual",
      "clips": [{ "kind": "video", "id": "clip-1", "startMs": 0,
        "assetId": "video-1", "inMs": 1000, "outMs": 5000, "volume": 1 }]
    }]
  }],
  "assets": { "items": [
    { "id": "photo-1", "kind": "image", "name": "参考照片",
      "mimeType": "image/jpeg", "width": 1080, "height": 1920 },
    { "id": "video-1", "kind": "video", "name": "生成视频",
      "mimeType": "video/mp4", "durationMs": 5000, "width": 1080, "height": 1920,
      "provenance": { "sourceAssetIds": ["photo-1"], "runId": "run-1" } }
  ] }
}
```

第二次生成或微调只新增资产并更新 `Scene.outputAssetIds`、`selectedAssetId`。示例的 `clip-1.assetId` 仍为 `video-1`，直到用户显式选择把新版本用于时间线。

## 校验、版本与扩展规则

1. 所有 ID 在其项目内唯一；`episode`、`scene`、`track`、`clip`、`asset`、`character` 的 ID 不随排序、同步或导出改变。跨对象引用必须存在，类型必须匹配。人物和场景的参考素材必须是 `image`；视频片段引用 `video`；字幕片段引用 `subtitle`；轨道只接收本类型片段（`visual` 接收 `video`/`image`，`audio` 只接收旧 `audio`）。
2. 时间使用非负安全整数毫秒。`startMs >= 0`、`durationMs > 0`、`0 <= inMs < outMs`；资产时长已知时还须 `outMs <= asset.durationMs`，未知时标记“待探测”，禁止渲染。`volume` 在 `[0, 2]`，以保留当前云端允许的增益。时间线片段占用 `[startMs, startMs + durationMs)`，视频/音频 `durationMs = outMs - inMs`。同一视觉轨道的片段不能重叠；不同轨道可以重叠。序列化数组顺序用于 UI 展示，不代替明确的 `startMs`。
3. `Scene.selectedAssetId` 为 `null` 或属于该场景 `outputAssetIds`；所有输出必须是项目内视频资产。来源链不能成环。生成任务失败、未知或尚未落盘时不能伪造输出资产。
4. `extensions.canvas` 沿用版本化 `CanvasDocumentV1` 的逐集图；现有视频节点的 `shotId` 映射 `Scene.id`，不在 V1 迁移中擅自改成新字段；其他节点继续用 `assetId` 等稳定引用，边的端点必须存在。插件关闭或移动端读取时保留未知扩展原文。画布坐标和视口不是渲染画幅，也不是时间线事实；用户当前打开哪一集属于本机 UI 状态，不放进跨端 DSL。
5. V1 只读写 `dslVersion: 1`。遇到更高主版本时提示升级并以只读方式保护原文，禁止旧客户端静默回写。新增可选字段必须有稳定默认行为；改动已有字段语义则升版本并提供迁移。未知命名空间扩展必须保留；核心未知字段不得靠类型断言绕过校验。
6. 资产内容不可变：对象替换意味着新资产 ID。删除资产前检查引用；云端删除走版本化资源命令。同步冲突继续按资源修订号处理，不能以“最新整份 JSON”覆盖另一端对同一集或同一资产的修改。

## 和现有格式的迁移映射

| 来源 | 目标 | 迁移要求 |
| --- | --- | --- |
| 本地 `ProjectManifestV2.id/title` | `projectId/metadata.title` | 原 ID 保留 |
| 本地 `studio.episodes`；无 studio 时根 `clips/captions` | `episodes` | 一画布一分集；活动集仅记在本机偏好；发布文案保留；旧全局 `coverTimeMs` 映射到对应片段源时间，无法定位时保存在迁移扩展并报告待修复 |
| 本地 `shots/jobs` 与 studio 视频节点 | `Scene` 与本地任务附属记录 | 用既有 shot ID；旧 `GenerationJob.id` 不是云端 `runId`，不得冒充；未知任务仍留原任务账本，不发新请求 |
| 本地 `assets.relativePath/missing` | `Asset` + 本地绑定表 | 原 asset ID 保留；缺媒体或未知元数据允许结构迁移并报告 warning，涉及该素材的生成、预览或渲染在修复前受阻 |
| 本地 `clips`、`captions` | `TimelineTrack`/`TimelineClip`、`SubtitleAsset` | 原 clip/caption ID 保留；入点、出点、音量、字幕时间和文本不丢失 |
| 云端 V1 `episodes[].shots`、`timelineClips` | `Scene`、视觉轨片段 | 原 shot/clip/asset ID 保留；按顺序累计 `startMs`；不得退回仅有 `timeline: string[]` 的信息量 |
| 云端 `video_edits`、成功的 `render_operations` | `Scene.outputAssetIds`、资产 provenance | 依创建时间补齐当前文档无法表达的历史视频版本；视频与封面输出分别加入 `video`、`thumbnail` 资产及对象绑定，不能只保留当前版本 |
| 云端旧 `timeline: string[]` | 视觉轨片段 | 仅无 `timelineClips` 时使用已存在的确定性补全规则；记录迁移来源，不重复造 clip |
| `extensions.canvas`、`VideoEditRecipeV1` | 版本化画布扩展、资产 provenance 的 `recipeId` | 图保留原数据；编辑配方仍由插件独立拥有 |

### 云端协议升级

现有 `/projects/:id` 的云端 V1 文档只能表达视频镜头和视频片段，不能完整保存 V1 DSL 的配音、音乐、字幕及多轨位置。因此新协议应以 `VideoProjectV1` 为**云端项目文档格式**：`projects.document_json` 保存该格式，资源命令仍按 `episode`、`asset`、`character`、`canvas` 及 `baseRevision` 更新子资源；`episode` payload 含 `scenes` 和 `tracks`，不再把 `timeline: string[]` 作为写入依据。媒体 `asset` 命令在 DSL payload 之外携带 `objectId`，服务端验证归属后写入绑定表；`subtitle/plain` 无对象绑定。项目标题在数据库索引列与 `metadata.title` 之间由同一事务同步。生成和微调 worker 也必须按新文档结构写新资产与场景版本，不能继续把旧 `shots`/`timeline` 塞入 V2 文档。V2 生成请求提供预先保存的 `sceneId`；旧生成请求不能向已迁移项目写入旧格式镜头。

通过显式 `/v2/projects` 读写新格式。首次由新客户端打开旧项目时，服务端在事务中保存旧 JSON 的可恢复副本、迁移并校验，然后返回 V2 API 响应；失败则原项目保持 V1。旧 `/projects` 客户端访问已经迁移的项目时返回明确的“需要升级客户端”响应，禁止把旧 V1 写命令应用到新文档。服务器先支持两版协议，再逐端切换；同一项目在某一时刻只有一个可写文档格式。原有资源修订号与命令 ID 在迁移事务中保留，不能通过版本升级重放付费操作。

迁移先读并校验旧文件，制作可恢复备份，再构造 DSL 投影和绑定表，校验引用完整性；本地 V2 磁盘原件在本阶段不切换。失败时仍打开原件或提示修复，不写半份新文档。已有云项目在服务端事务内迁移，并保留每资源的修订号语义。过渡期允许读取旧格式和新 DSL，但每端只保留原有一个权威写入路径；桌面离线队列的命令 ID 与 `baseRevision` 不因转换而重发成新操作。

## 实施边界和验收

首期只建立契约、校验器、迁移器与兼容适配器；不改生成供应商、不自动执行整个画布、不增设动态插件市场、不把模型选择/成本估算暴露给编辑器，也不新增裁画面/比例控制。基础画幅沿用当前 1080×1920、30 fps，未来可按项目版本引入更多预设。

验收至少覆盖：旧本地项目重开；云端旧项目迁移；一集多镜头、一资产多集复用；照片/视频/字幕/音频的引用验证；片段排序、裁剪和音量往返不丢；画布扩展及未知扩展往返不丢；编辑新版本后旧时间线片段不变；损坏引用与新版本文档被安全拒绝；断线重试不触发第二次付费提交。
