# @ai-video/project-schema

项目 DSL 的唯一结构定义。`foundation.ts` 管理项目、分集与镜头；`clips.ts` 管理时间线轨道和片段；`assets.ts` 管理照片、视频、音频、字幕和封面资产。`validate.ts` 负责跨层 ID、类型、时间范围与来源链校验。

```ts
import { createVideoProject, parseProjectDsl } from "@ai-video/project-schema";

const project = createVideoProject({ projectId: "project-1", title: "短片", initialEpisodeId: "episode-1" });
const result = parseProjectDsl(project);
if (!result.ok) console.error(result.issues);
```

`VideoProjectSchema.safeParse(input)` 也可直接使用。旧本地 V2 和云端 V1 文档须先通过 `@ai-video/project-core` 的迁移函数转换。DSL 不保存媒体路径、对象 ID、密钥或运行状态。

目前 API 的 `GET /projects/:id/dsl` 只读输出该格式；旧项目写入、生成和微调仍使用原有协议。完整的 DSL 写入切换须同时升级这些服务端路径及桌面/网页/移动端适配器。
