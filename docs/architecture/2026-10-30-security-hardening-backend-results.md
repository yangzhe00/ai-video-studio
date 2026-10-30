# Backend security hardening: repository result (2026-10-30)

This is a source and local rehearsal result. The active public API remains the older SQLite release. No formal PostgreSQL cutover or Nginx deployment was performed.

## Implemented

| Area | Repository change | Negative evidence |
| --- | --- | --- |
| CSRF and origin | `request-security.ts` requires `X-AVS-Request: 1` for every state-changing method before authentication/business work; strict configured Origin, cross-site Fetch Metadata and CORS preflight; JSON endpoints require JSON content type. Shared constants are in `@ai-video/api-contracts`. | Missing header on register/login/logout/project/upload/approval, wrong Origin, cross-site metadata and form content type rejected; no account/project/object/operation created. Production origin/cookie misconfiguration rejects startup. |
| Abuse limits | `rate-limit.ts` uses normalized client IP only from explicitly trusted proxy peers; Nginx candidate overwrites `X-Real-IP` and `X-Forwarded-For`. Login/register have IP and account buckets; uploads, ideas, render and approval have IP and account buckets. 429 has Retry-After. | Two accounts behind one proxy remain independent; forwarded headers from an untrusted peer are ignored; repeated login reaches 429; 11th approval is rejected before additional quota work; limiter map is bounded. |
| Upload | Upload bytes stream into a 0600 temporary file with a 20,000,000-byte default limit, 30-second total timeout, and three concurrent upload/probe slots. ffprobe uses the staged file with the existing 10-second and 1 MB output bounds. The staged file is removed after success or error; download filename is generated from the object ID. | Declared/actual over-limit, stalled/aborted upload, and concurrent-slot rejection leave no staged files. Existing MIME, object quota and deduplication tests remain green. |
| PostgreSQL candidate | `createDb` only checks schema version. Explicit migration/import uses the privileged migration credential; the API container uses `ai_video_runtime` with business-table DML and no schema-version write/DDL/TEMP privilege. Compose separates one-off migration job and runtime credentials. | Local PG 14.18 isolated rehearsal: role provisioning and verification exit 0; transactional business INSERT/SELECT succeeded; CREATE/ALTER/DROP denied. Schema mismatch rejects API startup; quoted question marks, comments and JSON operators survive SQL conversion. PG 17 and password/TLS behavior still require target-environment proof. |
| Current SQLite | Added a read-only live-file permissions and online backup/restore rehearsal script. | Synthetic schema-9 database: backup, isolated restore, integrity and counts check exit 0. The active server's file modes and restore have not been inspected. |
| Nginx/deployment | Candidate config sets `nosniff`, Referrer-Policy, X-Frame-Options and CSP Report-Only, disables API response caching, streams request bodies, and overwrites forwarding headers. Added route checker and tracked-secret/private-file checker. | Candidate shell/JS syntax and repository credential-path scan pass. Running Nginx headers, `nginx -t`, container user/ports, image scan and secret/backup modes remain unverified. |

## Commands and results

- `TEST_DATABASE_URL=... pnpm test`: exit 0 after lowering the login-limit test threshold; API 81/81, shared contract 6/6, desktop 37/37, Web 40/40, workspace boundaries OK. The connection URL used a disposable local PG 14.18 cluster; no credential is recorded here.
- `pnpm build`: exit 0 for all 25 buildable workspace projects.
- `pnpm check:boundaries`, `git diff --check`, `bash -n` on deployment scripts, `node --check` on role/header scripts, and a no-bytecode Python compile: exit 0.
- `bash deploy/security/check-candidate.sh`: exit 0; no tracked credential-like files or private-key markers found. This checks Git-tracked files, not all runtime volumes.
- Local PG role provisioning and `verify-runtime-role.mjs`: exit 0. Synthetic SQLite backup/restore script: exit 0.
- `pnpm audit --audit-level high`: unavailable because `registry.npmmirror.com` DNS lookup failed; command was stopped after retries. Docker daemon and local Nginx binary are unavailable, so image scan, Compose runtime checks and `nginx -t` were not run.

## Release gates

1. Publish and verify Web, desktop Rust and Expo clients carrying the request marker before deploying the strict API. Older installed desktop/mobile builds will receive 403 on state-changing calls; define the upgrade prompt/compatibility window and test login, upload and generation approval with the actual released clients.
2. On the current SQLite server, run `deploy/security/verify-live-sqlite.py` with the active paths, record private modes and retain the restricted restored copy. Do not treat the synthetic rehearsal as production recovery proof.
3. Before PG cutover, run the existing maintenance-window preflight/import/verify sequence against the pinned PostgreSQL 17 image and the split credentials. Reconfirm runtime DML and DDL denial, connection security, backup restoration and rollback conditions. Keep public writes closed until verification passes.
4. Install both Nginx candidate files, run `nginx -t`, then `verify-security-headers.mjs` against the deployed HTTPS site for `/`, `/studio/`, API JSON, object download and error page. Review CSP reports before enforcement; HSTS remains pending certificate/origin review.
5. Run dependency and image scans in a networked CI/deployment environment, record exact tool/image versions and actionable findings without exposing secrets. The in-memory limiter remains single-instance; introduce shared rate-limit state before horizontal API scaling.
