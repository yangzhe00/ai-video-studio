# Model price baselines

Checked 2026-10-27. These are planning estimates only. Each paid submission must refresh/confirm its price before execution.

| Model ID | Current draft use | Baseline |
| --- | --- | ---: |
| `seedance-15-pro` | 720p image-to-video, audio disabled | US$0.025 / second |
| `kling-ai-avatar-v2-standard` | 720p audio-driven talking shot | US$0.0562 / second |
| `gen4_turbo` | Runway image-to-video fallback | 5 credits / second, with US$0.01 / credit = US$0.05 / second |

Sources: [Hedra Seedance 1.5 Pro](https://www.hedra.com/video-models/seedance-15-pro), [Hedra Kling AI Avatar v2](https://mkt.hedra.com/models/video/kling/ai-avatar-v2), [Runway pricing](https://docs.dev.runwayml.com/guides/pricing/).

Money is converted to integer micro-dollars for the legacy quote and reservation helpers. Those helpers are not used by the current Kling generation workflow; their USD baselines must not be shown as Kling prices.

The separate Kling image-to-video integration can submit a paid `kling-v2-5-turbo` task after an explicit confirmation. The old USD baselines above do not price this model and are not displayed as a Kling quote. Its task record currently stores `estimatedUsd: 0` as an unknown placeholder; this is not a zero-cost claim. The accurate charge must be checked in the Kling console. Numeric Kling price review and budget enforcement remain future work.
