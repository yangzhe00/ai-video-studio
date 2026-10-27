# Model price baselines

Checked 2026-10-27. These are planning estimates only. Each paid submission must refresh/confirm its price before execution.

| Model ID | Current draft use | Baseline |
| --- | --- | ---: |
| `seedance-15-pro` | 720p image-to-video, audio disabled | US$0.025 / second |
| `kling-ai-avatar-v2-standard` | 720p audio-driven talking shot | US$0.0562 / second |
| `gen4_turbo` | Runway image-to-video fallback | 5 credits / second, with US$0.01 / credit = US$0.05 / second |

Sources: [Hedra Seedance 1.5 Pro](https://www.hedra.com/video-models/seedance-15-pro), [Hedra Kling AI Avatar v2](https://mkt.hedra.com/models/video/kling/ai-avatar-v2), [Runway pricing](https://docs.dev.runwayml.com/guides/pricing/).

Money is converted to integer micro-dollars for reservation arithmetic. The current UI only checks and displays a quote; it does not authorize or submit a paid request. `reserve_budget` will be called by the durable job submission flow, where it must persist the reservation before sending any request to a provider.
