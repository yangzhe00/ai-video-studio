# Desktop Release API Base Implementation Plan

> **For agentic workers:** Implement each task with its stated checks; preserve unrelated working tree changes.

**Goal:** Ship a macOS DMG whose native cloud requests use the verified public API while local development keeps its loopback default.

**Architecture:** Resolve one validated API base in Tauri Rust. Debug builds use loopback unless explicitly overridden; release builds embed the public URL at compile time and reject missing configuration. The DMG build script supplies the reviewed non-secret URL and records source and package hashes.

**Tech Stack:** Tauri 2, Rust, pnpm, Vite, macOS DMG tooling.

**Spec:** `docs/acceptance/2026-11-04-desktop-cloud-endpoint-incident.md`

## Global Constraints

- Production API base is `https://39.108.55.176/api`; HTTP is allowed only for loopback development.
- Web API, object media and SSE URLs remain same-origin `/api`; the Vite 8787 proxy remains development-only.
- Do not modify or overwrite the current installed app or published immutable 0.1.0 DMG during verification.
- Do not log credentials, session cookies or provider keys.

## Review Focus

- Release build with no API URL: fail packaging with an actionable error.
- Debug build with no API URL: use loopback 8787.
- Invalid remote URL or URL with credentials/query: reject before any request.
- All native request types, including upload/download, share the same resolved base.
- Public endpoint and package source must be proven against the actual installed bundle.

---

### Task 1: Native endpoint selection

**Files:** `apps/desktop/src-tauri/src/cloud.rs`, `apps/desktop/src-tauri/build.rs`.

**Interfaces:** `select_base_url(runtime: Option<&str>, bundled: Option<&str>, debug: bool) -> Result<String, String>`; `base_url()` calls it, and `endpoint()` remains the sole path join for JSON and media.

- [ ] Add Rust tests for release, debug, missing and invalid URL cases; verify current behavior fails.
- [ ] Implement endpoint selection and a build-time release configuration gate.
- [ ] Run `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml` and `cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml`.

### Task 2: Reproducible release configuration

**Files:** `deploy/dmg/release-config.json`, `deploy/dmg/build-and-verify.sh`, `apps/desktop/src-tauri/tauri.conf.json`, `apps/desktop/src-tauri/Cargo.toml`, release script tests and deployment documentation.

**Interfaces:** The script validates the public API URL, exports `AI_VIDEO_RELEASE_API_BASE_URL` for Cargo, and prints source SHA, API base, DMG SHA and path. New package version is 0.1.1.

- [ ] Add script validation tests for missing/invalid API base and clean source provenance.
- [ ] Implement config resolution, version bump and packaging output.
- [ ] Run targeted tests and desktop build; inspect staged diff and commit only owned files.

### Task 3: Real installed package regression

**Files:** new DMG, isolated macOS installation, `docs/acceptance/2026-11-04-desktop-cloud-endpoint-incident.md`.

- [ ] Build and verify the DMG, record the exact source SHA and package SHA.
- [ ] Install a separate QA copy, cold-start without API environment variables and exercise register/login, project read, object upload/download and preview.
- [ ] Capture native screenshots and actual request targets; report any untested path precisely.
- [ ] Coordinate a new immutable download and manifest publication after the release gate; compare public bytes with the tested DMG before independent regression.
