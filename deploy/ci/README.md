# GitHub Actions CI/CD operator guide

> **Historical SQLite cutover workflow.** Production has used PostgreSQL since `20261030-official-04`, so `deploy/ci/server-release.sh` and this guide's `prepare/cutover/activate/publish` stages must not be used for the current schema 1→3 release. Follow [the PostgreSQL schema upgrade runbook](../postgres/schema1-to3.md) and review a new production workflow before enabling automation.

This historical release path publishes a **committed default-branch revision**. It does not package the developer's dirty working tree. It was designed for the 2026-10-29 online SQLite schema 9 and a candidate PostgreSQL API; do not reuse it after the online schema or topology changes without revising the checks.

## Workflows and release phases

- `.github/workflows/ci.yml`: on push/PR/manual, run `pnpm test` and `pnpm build` with an isolated PostgreSQL 17 service, plus macOS Rust tests. No production secrets.
- `.github/workflows/deploy.yml`: manual `release_sha` (full SHA) and one phase. Each run first verifies the same commit is on the repository default branch, repeats the API/Web/website tests and build, and packages only `git archive HEAD` plus those two verified `dist` folders. The production job is serialized and uses the protected `production` environment.
- `prepare`: build the immutable candidate API image, copy a live SQLite snapshot and rehearse schema 9→10→isolated PG; compare all table counts and object paths; run formal cutover preflight. No old service is stopped.
- `cutover`: independently observe public `/api/health` returning HTTP 503 with `X-AVS-Maintenance: 1`, then stop old API, take the final backup including committed WAL rows, migrate to formal PG, and verify. Public API stays gated.
- `activate`: start exactly the candidate Compose API after the formal DB is healthy and verify its private `/health`; keep public maintenance gate for real account/project/object/task/idea checks.
- `publish`: require root-owned acceptance evidence, stage static assets, switch `/` and `/studio/` indexes, install/test/reload the Nginx config, and validate public routes. If a DMG manifest exists, verify its bytes/hash and real installation acceptance. If it does not, require the download CTA to remain disabled. On failure restore Nginx and previous indexes; leave PostgreSQL data untouched.

Never use `deploy/docker/cutover.sh` for this release. It belongs to the old SQLite containerization.

## GitHub setup

1. Merge the candidate into the repository default branch. The current branch and untracked files are not deployable by Actions. Confirm CI for that **exact SHA** is green. The server release script checks its own SHA-256 against the commit and must be installed from that same reviewed revision.
2. In repository Settings → Environments, create `production`, restrict it to the default branch, and configure required reviewer(s). If the repository plan does not support environment protection, do not enable the production job until equivalent access control exists. [GitHub environment rules](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments).
3. In that environment, set variables `PROD_SSH_HOST=39.108.55.176` and `PROD_SSH_USER=<deploy-user>`. Set secrets `PROD_SSH_KEY` (dedicated deploy private key) and `PROD_SSH_KNOWN_HOSTS` (the server's verified SSH host-key line). Compare the host key fingerprint through the server console; do not blindly trust a fresh `ssh-keyscan` result. Never paste API/PG/provider credentials into GitHub or this repo.
4. The SSH user must be able to upload to `/srv/ai-video-studio/incoming` and run only the **root-owned, preinstalled** `/usr/local/sbin/avs-release` through `sudo -n`; a root SSH account can also satisfy this temporarily. Do not grant sudo access to a script under `/tmp` or to the uploaded archive.

## One-time server setup

Install the reviewed script as root and make the incoming directory writable only by the deployment account/group. Example for a dedicated `deploy` account:

```sh
sudo install -d -m 0770 -o root -g deploy /srv/ai-video-studio/incoming
sudo install -m 0750 -o root -g root deploy/ci/server-release.sh /usr/local/sbin/avs-release
sudo install -d -m 0700 -o root -g root /etc/ai-video-studio/release-acceptance
sudo visudo -f /etc/sudoers.d/ai-video-studio-deploy
```

The sudoers file should grant that account only `/usr/local/sbin/avs-release` as root, with no password. Review the exact command restriction and verify `sudo -n /usr/local/sbin/avs-release ...` rejects bad phases. A workflow script update requires reinstalling the reviewed root-owned version before the next release; hash mismatch blocks otherwise.

Create `/etc/ai-video-studio/release.env` as a root-owned **0600** shell environment file. Example keys (replace placeholders with paths verified on the server; the PG digest must be a tested PostgreSQL 17 digest):

```sh
API_DATA_DIR_HOST=/var/lib/ai-video-studio
OLD_API_ENV_FILE=/etc/ai-video-studio/api.env
API_ENV_FILE=/etc/ai-video-studio/api.pg.env
PG_MIGRATION_ENV_FILE=/etc/ai-video-studio/api.pg-migrate.env
PG_RUNTIME_PASSWORD_FILE=/etc/ai-video-studio/postgres-runtime.password
OLD_COMPOSE_FILE=/srv/ai-video-studio/docker/compose.yaml
ACTIVE_NGINX_CONFIG=/absolute/host/path/of/current/ai-video.conf
STATIC_ROOT_HOST=/usr/local/soft/docker/nginx/html/ai-video-studio
PG_DATA_DIR_HOST=/var/lib/ai-video-studio-postgres-formal
REHEARSAL_PG_DATA_DIR_HOST=/var/lib/ai-video-studio-postgres-rehearsal
PG_PASSWORD_FILE=/etc/ai-video-studio/postgres.password
PG_IMAGE=postgres:17@sha256:REPLACE_WITH_TESTED_64_HEX_DIGEST
NODE_IMAGE=node:24-bookworm-slim@sha256:REPLACE_WITH_TESTED_64_HEX_DIGEST
BACKUP_ROOT=/var/backups/ai-video-studio
PUBLIC_BASE_URL=https://39.108.55.176/
API_BIND_IP=172.23.0.1
API_HOST_PORT=8787
API_UID=999
API_GID=987
```

Find `ACTIVE_NGINX_CONFIG` from the actual `sr-nginx` bind mounts; do not guess the host path. Pin `PG_IMAGE` and `NODE_IMAGE` to inspected digests, including any domestic registry mirror. The candidate API env must contain a **DML-only `ai_video_runtime`** `DATABASE_URL` for Compose host `db`, the existing session/provider keys, and production origin/cookie settings. The separate `PG_MIGRATION_ENV_FILE` holds the database-owner URL for one-off schema/import jobs; `PG_RUNTIME_PASSWORD_FILE` matches the runtime URL password. All password and environment files must be 0600; formal and rehearsal PG directories must be distinct, existing, and empty before the first `prepare`. Keep backups outside API data. The release script reuses `deploy/postgres/rehearsal.sh`, `cutover.sh`, and `verify.sh`, which provision and verify the runtime role before API startup.

The website may publish before a desktop download is ready: without `/downloads/latest.json`, the public validator requires a disabled download CTA and a real 404 for missing DMGs. To enable downloads, place a validated Apple Silicon DMG and matching `/downloads/latest.json` under the mounted static root before `publish`. Its app must have passed the installation/launch gate; `publish` independently checks filename, byte count, and SHA-256. This workflow does not build or notarize the desktop app.

## Runbook

1. Complete cross-client `X-AVS-Request` adaptation and the security regression. A green API-only suite is insufficient. Confirm the exact candidate commit includes `apps/web`, `apps/mobile`, and Tauri Rust request updates before production.
2. Trigger `Production release` → `prepare` for the full default-branch SHA. Preserve the workflow URL and the timestamped `/var/backups/ai-video-studio/rehearsal-<sha>-<UTC>/{upgrade,import,verify}.json` plus runtime-role log. Do not proceed if the rehearsal or preflight fails.
3. In the **active** Nginx config, replace only `/api/` with a maintenance response that includes `add_header X-AVS-Maintenance 1 always; return 503;`. Run `nginx -t`, reload, and verify from an external network that `https://39.108.55.176/api/health` is 503 with that header. This gate must block writes before `cutover`. Keep a copy of the old config; `cutover.sh` also archives it.
4. Trigger `cutover` for the same SHA. The script rechecks the live public gate, stops the old container, makes final backups, upgrades only the backup copy, imports to the empty formal PG directory, verifies counts and object paths, and leaves public `/api` gated. On failure, preserve data and investigate; do not delete formal PG data to force a retry.
5. Trigger `activate` for the same SHA. While the public gate remains, verify a real existing account login, old projects/episodes/assets, pending paid-task lookup by original ID, and three idea drafts against the private candidate API. Avoid a new paid generation POST. Record a redacted acceptance report outside Git.
6. Only after all private business checks pass, create `/etc/ai-video-studio/release-acceptance/<sha>.ok` as root-owned 0600, containing exactly the following evidence flags. Set `dmg_install=passed` only after a real DMG installation check; if no download is published, set `dmg_install=not_published` and verify the CTA stays disabled. Do not write `passed` for an untested check:

```text
release=<40-character-sha>
accounts=passed
projects=passed
objects=passed
pending_tasks=passed
ideas=passed
dmg_install=passed
```

7. Trigger `publish` for the same SHA. Save the run URL, candidate image digest, formal backup path, Nginx/site backup path, public route validation output, and a browser screenshot of `/` and `/studio/`. If a DMG is published, the validator downloads the complete file and checks its hash.

### Failed `prepare` retry for the same SHA

`prepare` intentionally refuses an existing release directory. A failed Docker pull or rehearsal can leave that directory and an incomplete rehearsal PG data directory. Do not delete them or choose a fake new SHA. Keep their evidence, then, as root, confirm that no formal cutover marker exists and that the `ai-video-studio-db` rehearsal container is stopped/removed. Move `/srv/ai-video-studio/releases/<sha>` and the matching timestamped `/var/backups/ai-video-studio/rehearsal-<sha>-<UTC>` to timestamped `.failed-<UTC>` names, move the configured rehearsal PG data directory to a separate timestamped failed path, and recreate an empty rehearsal directory with the same approved ownership and permissions. Do not touch the formal PG directory, active SQLite, or old API. Rerun `prepare` for the same SHA; it will reverify the uploaded bundle and rebuild/rehearse. If a formal `cutover` has begun, this recovery path does not apply; keep maintenance mode and investigate the retained backup.

If `publish` fails, it restores static indexes and prior Nginx config and leaves PG intact; verify the public maintenance marker. Once PostgreSQL has accepted **any public write**, never restart the old SQLite API against the old snapshot as a casual rollback. Keep maintenance mode and repair PostgreSQL or plan a data-preserving reverse migration.
