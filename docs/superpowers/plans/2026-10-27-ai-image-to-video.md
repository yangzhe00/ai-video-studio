# AI Image-to-Video Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the offline editor so a user can turn a human or animal photo and any suitable action prompt into a video, optionally add synchronized speech, then edit and export the result with visible cost controls.

**Architecture:** The existing local project remains the source of truth. Native provider adapters submit asynchronous cloud jobs; every submission, remote ID, output version and known charge is persisted before the UI can regard work as complete. Generated videos enter the same media library and timeline as imported clips. The default cloud path uses Hedra's Seedance 1.5 Pro and Kling AI Avatar v2, with Runway available for image-to-video fallback.

**Tech Stack:** Tauri 2/Rust native commands, React/TypeScript, Hedra API, Runway API, optional DeepSeek API, an audio/TTS provider, macOS Keychain, FFmpeg from the local editor plan.

**Spec:** `docs/superpowers/specs/2026-10-27-ai-short-video-desktop-design.md`

**Prerequisite:** Complete `docs/superpowers/plans/2026-10-27-local-video-editor.md`; use its `ProjectManifestV1`, `MediaAsset`, `TimelineClip` and native project commands. Add optional AI fields through a backward-compatible project migration to manifest version 2.

## Global Constraints

- First release is macOS; image-to-video must accept freeform prompts for people and animals, not just the dog-cooking demonstration.
- A speaking shot is optional. If selected, its mouth movement must follow the accepted audio; a voiceover alone is not completion.
- User supplies API keys. Secrets must stay in macOS Keychain or equivalent native secure storage and out of project files, logs, and Git.
- Display estimated model cost and budget impact before every paid submission; never automatically retry a request whose remote outcome is unknown.
- Generated media versions remain in the project; retrying one shot cannot remove earlier successful media.
- Treat advertised animal support as a candidate, not proof of quality. Live dog and human outputs are separate acceptance gates.

## Review Focus

1. Blank or irrelevant dog-specific prompt entered for a human photo: validation rejects blank input and never injects dog/chef content into arbitrary prompts (Task 3).
2. Two jobs submitted while budget is nearly exhausted: both reservations count, and the second is blocked before payment (Task 4).
3. Network timeout after paid submission but before task ID receipt: mark outcome unknown and prevent automatic resubmission (Task 6).
4. App restart while a job runs: reopen the same project and poll its stored remote ID rather than creating a new job (Task 6).
5. Video succeeds but audio/lip-sync fails: preserve the video and allow only the failed speaking shot to be retried (Tasks 6 and 8).

---

## File Map

| Path | Responsibility |
| --- | --- |
| `src-tauri/src/ai/types.rs` | Versioned AI job, model and request types |
| `src-tauri/src/ai/provider.rs` | Shared provider operations and errors |
| `src-tauri/src/ai/hedra.rs` | Hedra media upload, Seedance and Kling task submission/status |
| `src-tauri/src/ai/image.rs` | Optional reference-frame editing from source photo |
| `src-tauri/src/ai/runway.rs` | Runway image-to-video fallback |
| `src-tauri/src/ai/text.rs` | Optional DeepSeek storyboard and publishing copy |
| `src-tauri/src/ai/jobs.rs` | Durable jobs, remote reconciliation, immutable output versions |
| `src-tauri/src/ai/pricing.rs` | Estimate, reservation and budget accounting |
| `src-tauri/src/ai/secrets.rs` | macOS secure API-key storage |
| `src-tauri/src/ai/voice.rs` | TTS and imported-audio validation |
| `src/types/ai.ts` | Frontend request and state types |
| `src/features/create/` | Freeform prompt, optional storyboard, reference frame |
| `src/features/generation/` | Key setup, quotes, job progress, output versions |
| `src/features/speech/` | Voice preview and optional lip-sync shot |
| `docs/acceptance/ai-demo.md` | Measured person and dog acceptance evidence |

### Task 1: AI Domain and Project Migration

**Files:** Create `src/types/ai.ts`, `src-tauri/src/ai/types.rs`, `src-tauri/src/ai/mod.rs`; modify `src/types/project.ts`, `src-tauri/src/project.rs`, `src-tauri/src/lib.rs`; test `src-tauri/src/project.rs` and `src/types/ai.test.ts`.

**Interfaces:** `ShotDraft = { id: string; sourceAssetId: string; prompt: string; durationSec: number; speaking: boolean; script: string | null; acceptedAudioAssetId: string | null; modelId: string }`; `GenerationJob = { id: string; shotId: string; provider: string; modelId: string; state: 'draft' | 'submitting' | 'queued' | 'running' | 'succeeded' | 'failed' | 'unknown'; remoteId: string | null; estimatedUsd: number; actualUsd: number | null; outputAssetId: string | null }`. `ProjectManifestV2` extends V1 with `shots`, `jobs` and `budgetUsd`; opening V1 migrates in memory and persists as V2 only on explicit save.

- [ ] **Step 1: Write failing tests.** Existing V1 project opens with empty shots/jobs; V2 round-trips prompt, shot-specific audio asset and job remote ID; unknown enum/state is rejected without dropping saved assets.
- [ ] **Step 2: Run `cargo test --manifest-path src-tauri/Cargo.toml project` and `pnpm test --run ai`; confirm failures.**
- [ ] **Step 3: Implement V2 types and migration while keeping V1 media/timeline compatibility.**
- [ ] **Step 4: Run targeted tests, `pnpm build` and `cargo check`; all pass.**
- [ ] **Step 5: Commit:** `git add src src-tauri && git commit -m "feat: persist AI shots and generation jobs"`.

### Task 2: API Keys and Service Readiness

**Files:** Create `src-tauri/src/ai/secrets.rs`, `src/features/generation/ServiceSettings.tsx`, `src/features/generation/ServiceSettings.test.tsx`; modify `src-tauri/src/lib.rs`, `src/lib/native.ts`.

**Interfaces:** Native `set_provider_key(provider: ProviderId, key: String) -> Result<(), SecretError>`, `remove_provider_key(provider)`, `provider_key_status() -> Vec<{provider, configured}>`; no command returns plaintext keys. Providers are `hedra`, `runway`, and `deepseek`; Hedra also hosts the selected TTS model.

- [ ] **Step 1: Write failing tests.** Save/remove/status works through a fake SecretStore; project JSON and application log contain no key; AI submit control stays disabled when its provider key is absent.
- [ ] **Step 2: Run `cargo test --manifest-path src-tauri/Cargo.toml secrets` and `pnpm test --run ServiceSettings`; confirm failures.**
- [ ] **Step 3: Implement macOS Keychain-backed SecretStore, safe Tauri commands and service setup UI.** Validate that selected Hedra/Runway accounts can actually create jobs before calling the integration complete.
- [ ] **Step 4: Run targeted tests and a local Keychain round-trip in the signed or development app; confirm no plaintext secret in saved project.**
- [ ] **Step 5: Commit:** `git add src src-tauri && git commit -m "feat: configure user-owned AI credentials"`.

### Task 3: Freeform Shot Creation

**Files:** Create `src/features/create/shotDraft.ts`, `src/features/create/shotDraft.test.ts`, `src/features/create/CreateVideo.tsx`, `src/features/create/CreateVideo.test.tsx`; modify `src/App.tsx`, `src/types/ai.ts`.

**Interfaces:** `createShotDraft(sourceAssetId: string, prompt: string, durationSec: number, script?: string): ShotDraft`. Default duration is 5 seconds; Seedance accepts 4–12 seconds per shot. A single-shot prompt goes directly to the selected image-to-video adapter; a multi-shot storyboard is an editable collection of `ShotDraft`. The optional “宠物小厨师” preset only pre-fills fields; removing it leaves a usable freeform form.

- [ ] **Step 1: Write failing tests.** A person photo plus “在雨中跳舞” creates a shot containing that prompt and no dog content; an animal photo plus “在森林奔跑” works without script; blank prompt and out-of-range duration are rejected; script enables a separate speaking shot; preset text can be fully replaced.
- [ ] **Step 2: Run `pnpm test --run CreateVideo`; confirm failures.**
- [ ] **Step 3: Implement freeform form, optional template prefill and editable shot board.** Keep the source photo selectable as the direct start frame; reference-image transformation remains optional.
- [ ] **Step 4: Run targeted tests and manually create one human and one animal draft without paid calls.**
- [ ] **Step 5: Commit:** `git add src && git commit -m "feat: draft videos from arbitrary photo prompts"`.

### Task 4: Pricing and Explicit Paid-Call Gate

**Files:** Create `src-tauri/src/ai/pricing.rs`, `src/features/generation/CostReview.tsx`, `src/features/generation/CostReview.test.tsx`; modify `src-tauri/src/ai/types.rs`, `src-tauri/src/project.rs`.

**Interfaces:** `estimate_usd(model_id, units, options) -> MoneyEstimate`; `reserve_budget(project, job_id, estimate) -> Result<ProjectManifestV2, BudgetError>`. `units` records seconds, images, characters or tokens as appropriate. Seedance 1.5 Pro 720p without audio baseline is US$0.025/sec; Kling AI Avatar v2 Standard 720p baseline is US$0.0562/sec; Runway Gen-4 Turbo baseline is US$0.05/sec; Seedream 5.0 Lite 2K image edit baseline is US$0.0357/image. TTS and DeepSeek get their own dated, provider-specific rates before integration. Prices are visibly labeled estimates; refresh provider metadata/config before production submission when available.

Seedream 5.0 Lite model and pricing reference: https://www.hedra.com/models/image/bytedance/seedream-50-lite

- [ ] **Step 1: Write failing tests.** 10s Seedance + 5s Kling estimates US$0.531; one Seedream 2K edit estimates US$0.0357; two pending reservations cannot exceed a US$0.60 project limit; cancellation releases a reservation; user must acknowledge a changed estimate before submit.
- [ ] **Step 2: Run `cargo test --manifest-path src-tauri/Cargo.toml pricing` and `pnpm test --run CostReview`; confirm failures.**
- [ ] **Step 3: Implement decimal-safe money arithmetic, reservation state and confirmation UI for every paid request type.** Never silently change duration, resolution, text length or paid model after confirmation.
- [ ] **Step 4: Run targeted tests and inspect cost display in the real app with a 10s/5s draft.**
- [ ] **Step 5: Commit:** `git add src src-tauri && git commit -m "feat: estimate and cap paid generation"`.

### Task 5: Hedra Image-to-Video Adapter

**Files:** Create `src-tauri/src/ai/provider.rs`, `src-tauri/src/ai/hedra.rs`; modify `src-tauri/src/ai/mod.rs`; test `src-tauri/src/ai/hedra.rs` with mocked HTTP responses.

**Interfaces:** `trait VideoProvider { submit_image_to_video(&self, request: ImageVideoRequest) -> Result<RemoteTask, ProviderError>; get_task(&self, remote_id: &str) -> Result<RemoteTaskStatus, ProviderError>; fetch_output(&self, remote_id: &str, dest: &Path) -> Result<(), ProviderError> }`. `ImageVideoRequest` contains source image bytes or uploaded URI, arbitrary prompt, 4–12s duration, 9:16, 720p, audio disabled and model `seedance-15-pro`. Refer to the current Hedra live API schema for upload and task fields at implementation time; preserve response IDs and errors verbatim in structured job data.

- [ ] **Step 1: Write failing HTTP-contract tests.** Human/animal prompt passes unchanged; request disables model audio; queued/running/succeeded/failed responses map correctly; download outside project directory is rejected; HTTP failure never creates a success asset.
- [ ] **Step 2: Run `cargo test --manifest-path src-tauri/Cargo.toml hedra`; confirm failures.**
- [ ] **Step 3: Implement Hedra media upload, Seedance submission, status and output download behind `VideoProvider`.** Use native HTTPS and bounded timeouts; no API key reaches the frontend.
- [ ] **Step 4: Run contract tests and compare request fields against the current Hedra API schema.** Defer paid calls until durable jobs are in place in Task 6.
- [ ] **Step 5: Commit:** `git add src-tauri && git commit -m "feat: generate prompted video with Seedance"`.

### Task 6: Durable Generation Orchestration

**Files:** Create `src-tauri/src/ai/jobs.rs`, `src/features/generation/GenerationQueue.tsx`, `src/features/generation/GenerationQueue.test.tsx`; modify `src-tauri/src/project.rs`, `src-tauri/src/lib.rs`, `src/lib/native.ts`.

**Interfaces:** Native `submit_shot(project_root, shot_id, accepted_estimate_id) -> GenerationJob`, `refresh_job(project_root, job_id) -> GenerationJob`, `import_completed_output(project_root, job_id) -> MediaAsset`. Output versions are stored under `media/generated/<shot-id>/<job-id>/`; a succeeded output is appended to media library and can be added to timeline. `unknown` is terminal for automatic submission and requires explicit user review.

- [ ] **Step 1: Write failing tests.** Restart resumes polling stored remote ID; submit timeout before remote ID records `unknown` and never resubmits; failed speaking task preserves prior video; retry writes a new job/output directory; offline refresh leaves state intact.
- [ ] **Step 2: Run `cargo test --manifest-path src-tauri/Cargo.toml jobs` and `pnpm test --run GenerationQueue`; confirm failures.**
- [ ] **Step 3: Implement durable transitions and UI queue; save state before and after each remote boundary.** Do not overwrite an earlier successful asset when a later retry fails.
- [ ] **Step 4: Run targeted tests and manually close/reopen the desktop app during a mocked running job.** With a user-supplied key, make one minimal paid image-to-video call only after the app displays its estimate and the user accepts; save request ID, output and charge evidence.
- [ ] **Step 5: Commit:** `git add src src-tauri && git commit -m "feat: resume and version generation jobs"`.

### Task 7: Optional Reference-Frame Editing

**Files:** Create `src-tauri/src/ai/image.rs`, `src/features/create/ReferenceFrame.tsx`, `src/features/create/ReferenceFrame.test.tsx`; modify `src-tauri/src/ai/hedra.rs`, `src-tauri/src/ai/pricing.rs`, `src-tauri/src/ai/jobs.rs`, `src/features/create/CreateVideo.tsx`.

**Interfaces:** `edit_reference_frame(project_root, source_asset_id, prompt, accepted_estimate_id) -> GenerationJob` calls Hedra's Seedream 5.0 Lite with the uploaded source as image reference; output is a new image `MediaAsset` under `media/generated`, never a replacement for the source photo. The user can choose original photo or any approved edited frame as the start frame for each video/speaking shot. This path is optional for arbitrary prompts but enables costume and setting changes such as the dog-chef demo.

- [ ] **Step 1: Write failing tests.** Direct image-to-video remains available without editing; edited reference preserves original asset bytes; a paid edit requires accepted quote; rejecting an edited frame leaves the shot pointed at the original photo.
- [ ] **Step 2: Run `cargo test --manifest-path src-tauri/Cargo.toml image` and `pnpm test --run ReferenceFrame`; confirm failures.**
- [ ] **Step 3: Implement Hedra Seedream image edit, side-by-side approval and versioned frame selection via the durable job service.** Use the current provider schema for uploads and image edit parameters.
- [ ] **Step 4: Run targeted tests; with a user-approved paid call, verify one dog-to-chef and one human-scene edit retain a recognizable source subject.** If identity fails, keep source-based video generation available.
- [ ] **Step 5: Commit:** `git add src src-tauri && git commit -m "feat: prepare optional scene reference frames"`.

### Task 8: Optional Speech and Animal/Human Lip-Sync

**Files:** Create `src-tauri/src/ai/voice.rs`, `src/features/speech/SpeechPanel.tsx`, `src/features/speech/SpeechPanel.test.tsx`; modify `src-tauri/src/ai/hedra.rs`, `src-tauri/src/ai/jobs.rs`, `src/types/ai.ts`.

**Interfaces:** `prepare_speech(project_root, source_audio_asset_id, script) -> AcceptedSpeech` validates audio and stores the exact accepted file; `submit_lipsync(project_root, shot_id, accepted_audio_asset_id, estimate_id) -> GenerationJob` sends a start frame plus audio to Kling AI Avatar v2 Standard. Offer user-imported audio immediately. Add Hedra's ElevenLabs Flash Multilingual V2 model behind `synthesize_speech(script, voice_id, accepted_estimate_id) -> MediaAsset`; its Chinese voice must be auditioned for the dog-demo childlike tone. User must hear and accept the exact result before lip-sync submission. TTS and lip-sync have separate cost confirmations.

- [ ] **Step 1: Write failing tests.** No script means no speech job; imported audio is used byte-for-byte; changed script invalidates earlier accepted TTS; TTS and lip-sync each require their own accepted estimate; animal and human source images are accepted; a video with unrelated voiceover cannot be marked lip-sync success; failed speaking job preserves existing clips.
- [ ] **Step 2: Run `cargo test --manifest-path src-tauri/Cargo.toml voice` and `pnpm test --run SpeechPanel`; confirm failures.**
- [ ] **Step 3: Implement audio import/preview, Chinese TTS selection, user acceptance and Kling animal/human avatar task through the Hedra adapter.** Bind the lip-sync job to the exact accepted audio asset and the user-confirmed start frame.
- [ ] **Step 4: Run targeted tests; with supplied keys, compare one dog and one human output against their respective photos and accepted Mandarin audio.** Record lip-sync and identity observations separately; do not infer animal quality from human output.
- [ ] **Step 5: Commit:** `git add src src-tauri && git commit -m "feat: add optional synchronized speech shots"`.

### Task 9: Runway Fallback and Model Switching

**Files:** Create `src-tauri/src/ai/runway.rs`, `src/features/generation/ModelPicker.tsx`, `src/features/generation/ModelPicker.test.tsx`; modify `src-tauri/src/ai/provider.rs`, `src-tauri/src/ai/pricing.rs`, `src-tauri/src/ai/jobs.rs`.

**Interfaces:** Runway implements `VideoProvider` for `gen4_turbo` image-to-video; picker defaults to Seedance but allows Runway per shot. Switching changes estimate and requires fresh confirmation; prior Hedra results remain in media library.

- [ ] **Step 1: Write failing tests.** Model switch updates a 10s quote from US$0.25 to US$0.50 for image-to-video; previously accepted quote is invalidated; a Runway failure leaves Hedra output unchanged.
- [ ] **Step 2: Run `cargo test --manifest-path src-tauri/Cargo.toml runway` and `pnpm test --run ModelPicker`; confirm failures.**
- [ ] **Step 3: Implement Runway image-to-video upload/submit/status/download via current official API and wire the model picker.** Retain the common provider and job interfaces.
- [ ] **Step 4: Run contract tests; use a live key only after the displayed quote is accepted.**
- [ ] **Step 5: Commit:** `git add src src-tauri && git commit -m "feat: switch image-to-video provider per shot"`.

### Task 10: Storyboard and Publishing Copy Assistance

**Files:** Create `src-tauri/src/ai/text.rs`, `src/features/create/StoryAssistant.tsx`, `src/features/create/StoryAssistant.test.tsx`; modify `src-tauri/src/ai/pricing.rs`, `src/features/export/PublishingCopy.tsx`.

**Interfaces:** `propose_storyboard(project_root, brief, accepted_estimate_id) -> Vec<ShotDraft>` and `propose_publishing_copy(project_root, context, accepted_estimate_id) -> String` use a configured DeepSeek text/vision model. Both return editable drafts; they never overwrite existing prompts, captions or publishing copy without user action. A single direct freeform shot works without DeepSeek configured.

- [ ] **Step 1: Write failing tests.** Arbitrary human/animal briefs produce editable shot suggestions in a mocked response; model output that omits required fields is rejected; existing user-edited publishing copy remains unchanged until an explicit replace action; missing DeepSeek key leaves direct single-shot creation available.
- [ ] **Step 2: Run `cargo test --manifest-path src-tauri/Cargo.toml text` and `pnpm test --run StoryAssistant`; confirm failures.**
- [ ] **Step 3: Implement schema-validated DeepSeek requests for multi-shot planning and short publishing copy, with a visible text-cost estimate before submission.** Keep the user's original brief and each accepted edit in the project.
- [ ] **Step 4: Run targeted tests and try one non-chef animal story and one human story using editable suggestions.**
- [ ] **Step 5: Commit:** `git add src src-tauri && git commit -m "feat: suggest editable stories and publishing copy"`.

### Task 11: End-to-End Demo and Release Evidence

**Files:** Create `docs/acceptance/ai-demo.md`, `docs/architecture/providers.md`; modify `src/features/create/`, `src/features/generation/`, `src/features/speech/` only for acceptance defects.

**Interfaces:** A generated `MediaAsset` can be trimmed, captioned and exported through the offline editor without a special AI-only export path. DeepSeek suggestions may fill the existing publishing-copy field only after explicit user action.

- [ ] **Step 1: Add one end-to-end test with mocked providers.** An arbitrary human prompt without speech and an arbitrary animal prompt with accepted audio both yield reusable timeline assets; neither path injects dog-chef text unless preset chosen.
- [ ] **Step 2: Run the new test and confirm it fails before final wiring.**
- [ ] **Step 3: Wire creation, cost approval, generation, timeline and export; document provider IDs, data flow and paid-call boundaries.** Keep single-shot creation independent of the text adapter.
- [ ] **Step 4: Run `pnpm test --run`, `pnpm build`, `cargo test --manifest-path src-tauri/Cargo.toml`, and package/launch the macOS app.** Complete live acceptance with a real animal photo, a real person photo and the dog-chef story when credentials and permitted test assets are available. Record input, output, model, duration, attempts and billed amount; mark any unrun live check explicitly pending.
- [ ] **Step 5: Commit:** `git add src src-tauri docs && git commit -m "feat: deliver AI image-to-video desktop workflow"`.
