#!/usr/bin/env bash
# Read-only checks. Set paths and image references via exported environment variables.
set -euo pipefail
source "$(dirname "$0")/common.sh"

require_env API_UID API_GID API_DATA_DIR_HOST API_ENV_FILE OLD_API_ENV_FILE PG_MIGRATION_ENV_FILE PG_RUNTIME_PASSWORD_FILE PG_DATA_DIR_HOST PG_PASSWORD_FILE PG_IMAGE API_IMAGE \
  BACKUP_ROOT CANDIDATE_COMPOSE_FILE OLD_COMPOSE_FILE OLD_NGINX_CONFIG REHEARSAL_PG_DATA_DIR_HOST
for binary in docker python3 tar sha256sum; do command -v "$binary" >/dev/null || { echo "Missing command: $binary" >&2; exit 2; }; done
require_absolute_directory "$API_DATA_DIR_HOST"
if ! [[ "$API_UID" =~ ^[0-9]+$ && "$API_GID" =~ ^[0-9]+$ ]] ||
  [[ "$(stat -c '%u:%g' "$API_DATA_DIR_HOST")" != "$API_UID:$API_GID" ]]; then
  echo 'API_UID/API_GID must match the active media directory owner' >&2
  exit 2
fi
require_absolute_directory "$PG_DATA_DIR_HOST"
require_absolute_directory "$REHEARSAL_PG_DATA_DIR_HOST"
if [[ -n "$(find "$PG_DATA_DIR_HOST" -mindepth 1 -maxdepth 1 -print -quit)" ]]; then
  echo 'Formal PG_DATA_DIR_HOST must be empty before first cutover' >&2
  exit 2
fi
require_absolute_directory "$BACKUP_ROOT"
require_absolute_file "$OLD_COMPOSE_FILE"
require_absolute_file "$CANDIDATE_COMPOSE_FILE"
require_absolute_file "$OLD_NGINX_CONFIG"
if [[ "$(python3 -c 'import os,sys; print(os.path.realpath(sys.argv[1]))' "$OLD_COMPOSE_FILE")" == "$(python3 -c 'import os,sys; print(os.path.realpath(sys.argv[1]))' "$CANDIDATE_COMPOSE_FILE")" ]]; then
  echo 'Candidate Compose file must differ from the active old Compose file' >&2
  exit 2
fi
require_private_file "$API_ENV_FILE"
require_private_file "$OLD_API_ENV_FILE"
require_private_file "$PG_PASSWORD_FILE"
require_private_file "$PG_MIGRATION_ENV_FILE"
require_private_file "$PG_RUNTIME_PASSWORD_FILE"
if [[ "$(python3 -c 'import os,sys; print(os.path.realpath(sys.argv[1]))' "$API_ENV_FILE")" == "$(python3 -c 'import os,sys; print(os.path.realpath(sys.argv[1]))' "$OLD_API_ENV_FILE")" ]]; then
  echo 'Candidate API_ENV_FILE must differ from active OLD_API_ENV_FILE' >&2
  exit 2
fi
require_absolute_file "$API_DATA_DIR_HOST/studio.sqlite"
if ! [[ "$PG_IMAGE" =~ @sha256:[0-9a-f]{64}$ ]]; then
  echo 'PG_IMAGE must use an inspected immutable sha256 digest' >&2
  exit 2
fi
if ! grep -Eq '^DATABASE_URL=(postgresql|postgres)://ai_video_runtime:[^[:space:]]+@db(:5432)?/ai_video_studio([?]|$)' "$API_ENV_FILE"; then
  echo 'Candidate API DATABASE_URL must use ai_video_runtime on Compose host db; check it without printing credentials' >&2
  exit 2
fi
if ! grep -Eq '^DATABASE_URL=(postgresql|postgres)://ai_video_studio:[^[:space:]]+@db(:5432)?/ai_video_studio([?]|$)' "$PG_MIGRATION_ENV_FILE"; then
  echo 'Migration DATABASE_URL must use ai_video_studio on Compose host db; check it without printing credentials' >&2
  exit 2
fi
python3 - "$API_ENV_FILE" "$PG_MIGRATION_ENV_FILE" "$PG_PASSWORD_FILE" "$PG_RUNTIME_PASSWORD_FILE" "$OLD_API_ENV_FILE" <<'PY'
import hmac, pathlib, sys, urllib.parse
def values(path):
    return dict(line.split('=', 1) for line in pathlib.Path(path).read_text().splitlines()
                if line and not line.startswith('#') and '=' in line)
runtime, migration = values(sys.argv[1]), values(sys.argv[2])
owner_password = pathlib.Path(sys.argv[3]).read_text().rstrip('\n')
runtime_password = pathlib.Path(sys.argv[4]).read_text().rstrip('\n')
old = values(sys.argv[5])
if not runtime.get('API_SESSION_SECRET') or not old.get('API_SESSION_SECRET') or not hmac.compare_digest(
    runtime['API_SESSION_SECRET'], old['API_SESSION_SECRET']
):
    raise SystemExit('Candidate API session secret must match the old API to preserve existing sessions')
if urllib.parse.unquote(urllib.parse.urlsplit(runtime['DATABASE_URL']).password or '') != runtime_password:
    raise SystemExit('Runtime database password file and API environment do not match')
if urllib.parse.unquote(urllib.parse.urlsplit(migration['DATABASE_URL']).password or '') != owner_password:
    raise SystemExit('Migration database password file and environment do not match')
if runtime.get('API_SECURE_COOKIES') == 'false' or not runtime.get('API_ALLOWED_ORIGIN', '').startswith('https://'):
    raise SystemExit('Production API requires Secure cookies and an HTTPS allowed origin')
if not runtime.get('API_TRUSTED_PROXY_IPS'):
    raise SystemExit('Set API_TRUSTED_PROXY_IPS to the verified Nginx peer IP')
print('Candidate role credentials and HTTPS/Origin settings validated without disclosure')
PY

docker image inspect "$API_IMAGE" >/dev/null
docker image inspect "$PG_IMAGE" >/dev/null
if ! docker image inspect "$PG_IMAGE" --format '{{range .Config.Env}}{{println .}}{{end}}' | grep -qx 'PG_MAJOR=17'; then
  echo 'PG_IMAGE must be a tested PostgreSQL 17 image' >&2
  exit 2
fi
old_image_id="$(docker inspect ai-video-studio-api --format '{{.Image}}')"
docker image inspect "$old_image_id" >/dev/null
old_image_bytes="$(docker image inspect "$old_image_id" --format '{{.Size}}')"
candidate_compose config --quiet
if docker inspect ai-video-studio-db >/dev/null 2>&1; then
  echo 'A PostgreSQL container already has the formal service name; remove the rehearsal container before cutover' >&2
  exit 2
fi
if [[ "$(docker inspect -f '{{.State.Running}}' ai-video-studio-api 2>/dev/null || true)" != 'true' ]]; then
  echo 'Expected the old API container to be running before cutover' >&2
  exit 2
fi

python3 - "$API_DATA_DIR_HOST/studio.sqlite" <<'PY'
import sqlite3, sys, urllib.parse
path = sys.argv[1]
uri = 'file:' + urllib.parse.quote(path) + '?mode=ro'
db = sqlite3.connect(uri, uri=True)
try:
    version = db.execute('PRAGMA user_version').fetchone()[0]
    integrity = db.execute('PRAGMA quick_check').fetchone()[0]
    if version != 9 or integrity != 'ok':
        raise SystemExit(f'Active SQLite preflight failed: schema={version}, quick_check={integrity}')
    print(f'Active SQLite schema={version}, quick_check=ok')
finally:
    db.close()
PY

python3 - "$API_DATA_DIR_HOST" "$BACKUP_ROOT" "$PG_DATA_DIR_HOST" "$REHEARSAL_PG_DATA_DIR_HOST" "$old_image_bytes" <<'PY'
import os, shutil, sys
source, backup_root, pg_data, rehearsal_pg_data = (os.path.realpath(path) for path in sys.argv[1:5])
old_image_bytes = int(sys.argv[5])
if backup_root == source or backup_root.startswith(source + os.sep):
    raise SystemExit('BACKUP_ROOT must be outside API_DATA_DIR_HOST')
if pg_data == source or pg_data.startswith(source + os.sep):
    raise SystemExit('PG_DATA_DIR_HOST must be outside API_DATA_DIR_HOST')
if pg_data == rehearsal_pg_data:
    raise SystemExit('Formal PG_DATA_DIR_HOST must differ from rehearsal PostgreSQL data directory')
size = sum(os.path.getsize(os.path.join(root, name)) for root, _, files in os.walk(source) for name in files)
free = shutil.disk_usage(backup_root).free
required = size * 2 + old_image_bytes + 1024**3
if free < required:
    raise SystemExit(f'Insufficient backup space: need at least {required} bytes, available {free} bytes')
pg_free = shutil.disk_usage(pg_data).free
pg_required = os.path.getsize(os.path.join(source, 'studio.sqlite')) * 2 + 1024**3
if pg_free < pg_required:
    raise SystemExit(f'Insufficient PostgreSQL filesystem space: need at least {pg_required} bytes, available {pg_free} bytes')
print(f'Data bytes={size}; backup filesystem free bytes={free}; PostgreSQL filesystem free bytes={pg_free}')
PY

echo 'Preflight passed. No service or data was modified.'
