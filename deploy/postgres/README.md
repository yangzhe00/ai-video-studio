# PostgreSQL cutover scripts

> **Historical SQLite cutover only.** The production API was moved to PostgreSQL in release `20261030-official-04`. Its observed database is schema 1. Do **not** run `preflight.sh`, `rehearsal.sh`, `cutover.sh`, `verify.sh`, or the SQLite importer against that PostgreSQL production database. For the current schema 1→3 upgrade, use [schema1-to3.md](schema1-to3.md).

These scripts are for a supervised maintenance window. They do not alter the active SQLite database. `cutover.sh` stops the old API, creates a complete archive, takes a SQLite backup including committed WAL rows, upgrades only that backup to schema 10, imports into an empty PostgreSQL database, then **leaves the public API stopped**. `verify.sh` checks all imported table counts and object paths from a one-off container without opening a public port.

Export absolute paths and pinned image references before running `preflight.sh`:

| Variable | Meaning |
| --- | --- |
| `RELEASE_ID` | Unique release ID for `cutover.sh` backup naming. |
| `API_IMAGE` | Built and tested candidate API image tag or digest. |
| `PG_IMAGE` | Tested PostgreSQL 17 image with `@sha256:` digest. |
| `API_DATA_DIR_HOST` | Current complete API data directory, including `studio.sqlite` and objects. |
| `API_ENV_FILE` | Candidate 0600 API environment file with `DATABASE_URL` for the DML-only `ai_video_runtime` role. |
| `PG_MIGRATION_ENV_FILE` | Separate 0600 environment file with the database owner `ai_video_studio` URL, used only by one-off migration jobs. |
| `PG_RUNTIME_PASSWORD_FILE` | 0600 file containing the runtime role password; must match the password in `API_ENV_FILE`. |
| `OLD_API_ENV_FILE` | Active old 0600 API environment file; must differ from the candidate file. |
| `PG_DATA_DIR_HOST` | Dedicated existing PostgreSQL data directory; never share it with API data. |
| `REHEARSAL_PG_DATA_DIR_HOST` | Separate existing rehearsal PostgreSQL data directory; the formal directory must differ and be empty. |
| `PG_PASSWORD_FILE` | 0600 PostgreSQL password file, outside Git and release tree. |
| `BACKUP_ROOT` | Existing directory on a filesystem with room for two full data copies plus 1 GiB. |
| `CANDIDATE_COMPOSE_FILE` | Absolute path to this release's `deploy/docker/compose.yaml`. |
| `OLD_COMPOSE_FILE` | Absolute path to the currently running API Compose file. |
| `OLD_NGINX_CONFIG` | Absolute path to a copy of the active Nginx route config for backup. |

Run `preflight.sh` while the old API is live. Establish and verify a public `/api` maintenance gate **before** setting `MAINTENANCE_GATE_CONFIRMED=1` and running `cutover.sh --execute`; the script cannot inspect an external Nginx gate. Keep the gate until `verify.sh <backup directory>` passes and private business checks cover login, projects, assets, unfinished tasks, and the three idea drafts. The operator then starts exactly one new API instance with the candidate Compose file and checks `/health`; the script does not automatically publish it. If a step fails, the old API stays stopped and the backup is retained. Only consider returning to SQLite before PostgreSQL has accepted any public writes. Once it has, keep maintenance mode and repair or plan a reverse migration.

## Operator sequence

In a root shell on the server, use the actual reviewed release ID and paths. Build and smoke-test `API_IMAGE` from the frozen candidate source first. Run `rehearsal.sh` against `REHEARSAL_PG_DATA_DIR_HOST`; it takes an online SQLite backup while the old API stays live, upgrades only the copy, imports it, provisions the restricted runtime role, verifies counts and object paths, then stops and removes the rehearsal container. Retain the rehearsal data and evidence; do not reuse its directory for the formal database.

```bash
export RELEASE_ID='REPLACE_WITH_REVIEWED_RELEASE_ID'
export API_IMAGE='REPLACE_WITH_BUILT_CANDIDATE_IMAGE'
export PG_IMAGE='REPLACE_WITH_TESTED_POSTGRES_17_IMAGE_AT_SHA256_DIGEST'
export API_DATA_DIR_HOST='/var/lib/ai-video-studio'
export OLD_API_ENV_FILE='/etc/ai-video-studio/api.env'
export API_ENV_FILE='/etc/ai-video-studio/api.pg.env'
export PG_MIGRATION_ENV_FILE='/etc/ai-video-studio/api.pg-migrate.env'
export PG_RUNTIME_PASSWORD_FILE='/etc/ai-video-studio/postgres-runtime.password'
export PG_PASSWORD_FILE='/etc/ai-video-studio/postgres.password'
export PG_DATA_DIR_HOST='/var/lib/ai-video-studio-postgres-formal'
export REHEARSAL_PG_DATA_DIR_HOST='/var/lib/ai-video-studio-postgres-rehearsal'
export BACKUP_ROOT='/var/backups/ai-video-studio'
export OLD_COMPOSE_FILE='/srv/ai-video-studio/docker/compose.yaml'
export CANDIDATE_COMPOSE_FILE="/srv/ai-video-studio/releases/$RELEASE_ID/deploy/docker/compose.yaml"
export OLD_NGINX_CONFIG='/srv/ai-video-studio/backup/active-nginx.conf'
```

The image placeholders above must be replaced with the exact local candidate tag and PostgreSQL digest. Copy the active Nginx route config to `OLD_NGINX_CONFIG`; create the formal PostgreSQL directory empty and keep the rehearsal directory separate. All environment/password files must be mode `0600`. The API `DATABASE_URL` must use `ai_video_runtime` on Compose host `db`; the migration file must use database owner `ai_video_studio`. Preflight checks targets without printing passwords. The API process now checks schema version at startup and never runs DDL. The one-off import job creates schema; a separate one-off job provisions the runtime role before verification and activation.

```bash
bash "/srv/ai-video-studio/releases/$RELEASE_ID/deploy/postgres/rehearsal.sh"
```

Review the printed `rehearsal_passed` counts and the retained `source-counts.json`, `upgrade.json`, `import.json`, `verify.json`, `provision.log`, and `runtime-role.log`. The upgraded SQLite copy is checkpointed and switched from WAL to DELETE journaling so the importer can use a read-only mount.

Set `API_ALLOWED_ORIGIN` to the exact HTTPS site origin, keep `API_SECURE_COOKIES=true`, and set `API_TRUSTED_PROXY_IPS` to the actual peer IP seen by the API from the Nginx container. Nginx overwrites `X-Real-IP` and `X-Forwarded-For` with `$remote_addr`; verify that route before enabling trusted-proxy parsing. The rate limiter is process-local, so the candidate remains a single API instance until a shared limiter is introduced.

After each future schema migration, rerun the one-off runtime role provisioning and privilege verification before starting API traffic. New tables do not receive automatic DML grants.

```bash
bash "/srv/ai-video-studio/releases/$RELEASE_ID/deploy/postgres/preflight.sh"
```

Next, activate and independently verify a public `/api` maintenance response. Keep the old API container running until that gate is effective. Only then run:

```bash
MAINTENANCE_GATE_CONFIRMED=1 bash "/srv/ai-video-studio/releases/$RELEASE_ID/deploy/postgres/cutover.sh" --execute
backup_dir="$(cat "$BACKUP_ROOT/latest-prepared-path")"
bash "/srv/ai-video-studio/releases/$RELEASE_ID/deploy/postgres/verify.sh" "$backup_dir"
```

`cutover.sh` leaves the old API stopped and the new database running. The following activation is **manual**, under the same maintenance gate, after reviewing `import.json`, `upgrade.json`, the backup archive, and `verify.sh` output:

`verify.sh` also checks that the API role can perform business DML and is rejected for `CREATE`, `ALTER`, and `DROP`. It is a candidate PG check; it does not inspect the active SQLite deployment.

If cutover fails after PostgreSQL initialization, `preflight.sh` will reject a rerun because the formal data directory is no longer empty. Keep the old API stopped and the maintenance gate active. Inspect the retained backup and database state before a supervised retry; never delete or replace the formal directory just to make the check pass.

```bash
docker compose -f "$CANDIDATE_COMPOSE_FILE" up -d --no-deps --wait api
docker inspect ai-video-studio-api --format '{{.State.Health.Status}}'
```

Test account login, old projects/episodes/assets, unfinished task lookup by existing operation ID, and the three idea drafts against the new private API before removing the Nginx maintenance gate. Do not submit a paid video request just to validate migration. After opening public writes on PostgreSQL, a raw return to the old SQLite snapshot would discard those writes; keep maintenance mode and repair or plan a reverse migration instead.

The backup directory contains credentials and user data. Keep it restricted, record its path and the image digests in the release evidence, and never upload it to the repository.

## Current SQLite deployment checks

Until PostgreSQL cutover, check the active `studio.sqlite`, adjacent `-wal`/`-shm` files when present, API data directory, `/etc/ai-video-studio/api.env`, and backup directory with `stat`/`namei`. The API user should be the only service account with write access; env files and backup archives should be owner-readable only (`0600` files, `0700` backup directories). Take a SQLite online backup with `sqlite3 .backup` or Python `Connection.backup`, then restore that copy to an isolated location and run `PRAGMA integrity_check` and representative row counts. Do not run a raw `cp` of a live SQLite file without its WAL. Record permission modes and checks, never file contents or credentials. These steps require server access and are not claimed as complete by this repository change.

The candidate `python3 deploy/security/verify-live-sqlite.py /var/lib/ai-video-studio/studio.sqlite /var/backups/ai-video-studio /etc/ai-video-studio/api.env` performs those checks and leaves a restricted online backup plus restored copy for review. Run it on the active server with an account authorized to read the files; it does not modify the active database. A permission failure should be investigated and corrected before repeating the rehearsal.
