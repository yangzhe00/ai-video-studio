# Mobile MVP and Native Packaging Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the existing Expo mobile client usable against the current cloud API and prepare installable Android and iOS builds.

**Architecture:** Keep React Native/Expo and share TypeScript contracts with web and desktop. Mobile remains a cloud client for project viewing, photo upload, five-second generation, result preview, task recovery, and light video editing; media generation and rendering stay on the API. Packaging uses platform IDs and explicit EAS preview profiles, with no provider secrets in the app.

**Tech Stack:** Expo 57, React Native 0.86, TypeScript, pnpm workspace, `expo-video`, EAS Build.

**Spec:** `docs/superpowers/specs/2026-10-27-multiplatform-plugin-architecture-design.md` (mobile stage and shared contract boundaries).

## Global Constraints

- Do not copy web DOM UI into React Native or embed server provider keys in the bundle.
- Keep paid generation behind the existing approval endpoint; reconnect by querying persisted runs, never by submitting a new paid request.
- Require HTTPS for remote API addresses; allow local HTTP only in a development build.
- iOS device IPA requires Apple signing; iOS Simulator output is a separate artifact.

## Review Focus

- A production API mounted at `/api` must be accepted and used for all requests and media URLs.
- A saved HTTP remote address must not restore a session into a release build.
- Reopening a project must show the existing run and its result, without a second paid submission.
- Original and edited video preview must switch to the selected asset, preserving authenticated headers.
- Android and iOS JS bundles must both export; native packages require a successful native build and signing evidence.

---

### Task 1: Mobile API location and session safety

**Files:** `apps/mobile/src/session.ts`, `apps/mobile/src/session.test.ts`, `apps/mobile/src/App.tsx`

**Interfaces:** `normalizeApiUrl(raw, allowInsecureLocal)` accepts an optional `/api` base path and rejects unsafe remote HTTP and URL credentials. `createMobileSession(storage, options)` restores a safe default URL and isolates the saved cookie to its API base URL.

- [x] Add tests for the production `/api` URL, private-LAN development HTTP, remote HTTP rejection, and cookie isolation after server changes.
- [x] Implement URL normalization and configure the current HTTPS API as the initial server address.
- [x] Run mobile session tests and TypeScript build.

### Task 2: Mobile result preview and task recovery

**Files:** `apps/mobile/src/App.tsx`, `apps/mobile/src/ShotPreview.tsx`, `plugins/video-edit/src/native/VideoEditor.tsx`

**Interfaces:** Show the selected shot's authenticated video result. Reopen an existing run by reading the project run list; do not replay generation approval. The edit player must follow the selected original or edited source.

- [x] Add the result preview and explicit loading/empty/error states.
- [x] Fix the native edit player source switch and project reopening state.
- [x] Export both iOS and Android Metro bundles.

### Task 3: Native build configuration and packaging

**Files:** `apps/mobile/app.json`, `apps/mobile/eas.json`, `apps/mobile/README.md`

**Interfaces:** Android preview profile produces APK, iOS preview profile produces a signed device IPA when credentials exist, and iOS simulator profile produces a simulator app. Bundle IDs must be stable and unique.

- [x] Set Android/iOS application IDs, version counters, native permission descriptions, and build profiles.
- [x] Run Expo config validation and Expo Doctor (21/21 passed).
- [x] Build the Android APK and iOS Simulator app through EAS under `@yy12222/ai-video-studio` after local archive inspection. The Mac has neither full Xcode nor Android SDK/JDK, so runtime installation remains unverified.
- [x] Record both Metro exports, completed native build IDs, and the separate iOS device-signing limitation; do not label the Simulator archive as a device IPA.
