#!/usr/bin/env bash
# Stops the old API, archives the complete data directory, upgrades a backup copy,
# and imports to an empty PostgreSQL database. Intentionally leaves the API stopped.
set -euo pipefail
umask 077
source "$(dirname "$0")/common.sh"
if [[ "${1:-}" != '--execute' ]]; then
  echo 'Usage: RELEASE_ID=<id> ... cutover.sh --execute' >&2
  echo 'Requires a maintenance gate on public /api before execution; leaves API stopped.' >&2
  exit 2
fi
if [[ "${MAINTENANCE_GATE_CONFIRMED:-}" != '1' ]]; then
  echo 'Set MAINTENANCE_GATE_CONFIRMED=1 only after verifying the public /api maintenance gate' >&2
  exit 2
fi
require_env RELEASE_ID API_UID API_GID API_DATA_DIR_HOST API_ENV_FILE OLD_API_ENV_FILE PG_MIGRATION_ENV_FILE PG_RUNTIME_PASSWORD_FILE PG_DATA_DIR_HOST PG_PASSWORD_FILE PG_IMAGE API_IMAGE \
  BACKUP_ROOT CANDIDATE_COMPOSE_FILE OLD_COMPOSE_FILE OLD_NGINX_CONFIG REHEARSAL_PG_DATA_DIR_HOST
[[ "$RELEASE_ID" =~ ^[A-Za-z0-9._-]+$ ]] || { echo 'Invalid RELEASE_ID' >&2; exit 2; }
"$(dirname "$0")/preflight.sh"

backup_dir="$BACKUP_ROOT/${RELEASE_ID}-$(date -u +%Y%m%dT%H%M%SZ)"
if [[ -e "$backup_dir" ]]; then echo 'Backup directory already exists' >&2; exit 2; fi
mkdir -m 0700 "$backup_dir"
stopped=0
on_exit() {
  if [[ "$stopped" == 1 ]]; then
    printf 'Old API remains stopped. Preserve backup: %s\n' "$backup_dir" >&2
    echo 'Do not restore SQLite after PostgreSQL has accepted public writes.' >&2
  fi
}
trap on_exit EXIT

# A manual Nginx maintenance gate must already block public writes. Stop old worker too.
docker stop --time 30 ai-video-studio-api >/dev/null
stopped=1
if [[ "$(docker inspect -f '{{.State.Running}}' ai-video-studio-api)" != 'false' ]]; then
  echo 'Old API did not stop' >&2; exit 1
fi

tar --xattrs --acls --numeric-owner -C "$(dirname "$API_DATA_DIR_HOST")" -cpf "$backup_dir/api-data.tar" "$(basename "$API_DATA_DIR_HOST")"
cp -p "$OLD_COMPOSE_FILE" "$backup_dir/old-compose.yaml"
cp -p "$OLD_API_ENV_FILE" "$backup_dir/old-api.env"
chmod 0600 "$backup_dir/old-api.env"
cp -p "$OLD_NGINX_CONFIG" "$backup_dir/old-nginx.conf"
docker inspect ai-video-studio-api --format '{{.Image}}' > "$backup_dir/old-image-id.txt"
docker image save "$(cat "$backup_dir/old-image-id.txt")" -o "$backup_dir/old-api-image.tar"

python3 - "$API_DATA_DIR_HOST/studio.sqlite" "$backup_dir/studio.sqlite" "$backup_dir/source-counts.json" <<'PY'
import json, sqlite3, sys, urllib.parse
source, target, counts_path = sys.argv[1:]
uri = 'file:' + urllib.parse.quote(source) + '?mode=ro'
src = sqlite3.connect(uri, uri=True)
dst = sqlite3.connect(target)
try:
    if src.execute('PRAGMA user_version').fetchone()[0] != 9:
        raise SystemExit('Active SQLite is not schema 9')
    if src.execute('PRAGMA integrity_check').fetchone()[0] != 'ok':
        raise SystemExit('Active SQLite integrity check failed')
    src.backup(dst)
    if dst.execute('PRAGMA integrity_check').fetchone()[0] != 'ok':
        raise SystemExit('SQLite backup integrity check failed')
    tables = [row[0] for row in dst.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")]
    counts = {name: dst.execute('SELECT COUNT(*) FROM "' + name.replace('"', '""') + '"').fetchone()[0] for name in tables}
    with open(counts_path, 'w') as out: json.dump(counts, out, sort_keys=True)
finally:
    dst.close(); src.close()
PY
sha256sum "$API_DATA_DIR_HOST/studio.sqlite" "$backup_dir/studio.sqlite" > "$backup_dir/sqlite-sha256.txt"

docker run --rm --network none --mount "type=bind,src=$backup_dir,dst=/backup" "$API_IMAGE" \
  node --experimental-transform-types apps/api/scripts/upgrade-sqlite-copy.mjs \
  --source /backup/studio.sqlite --destination /backup/upgraded/studio.sqlite > "$backup_dir/upgrade.json"

python3 - "$backup_dir/source-counts.json" "$backup_dir/upgrade.json" <<'PY'
import json, sys
source, upgraded = (json.load(open(path)) for path in sys.argv[1:])
if upgraded.get('sourceVersion') != 9 or upgraded.get('targetVersion') != 10 or upgraded.get('counts') != source:
    raise SystemExit('SQLite upgrade count or version mismatch')
PY
sha256sum --check --status "$backup_dir/sqlite-sha256.txt" || {
  echo 'Active SQLite or backup snapshot changed after copy upgrade; keep API stopped' >&2
  exit 1
}
chgrp "$API_GID" "$backup_dir" "$backup_dir/upgraded" "$backup_dir/upgraded/studio.sqlite" "$backup_dir/source-counts.json"
chmod 0750 "$backup_dir" "$backup_dir/upgraded"
chmod 0640 "$backup_dir/upgraded/studio.sqlite" "$backup_dir/source-counts.json"

candidate_compose up -d --wait db
candidate_compose run -T --rm --no-deps -v "$backup_dir:/backup:ro" api-migrate \
  node --experimental-transform-types apps/api/scripts/migrate-sqlite-to-postgres.mjs \
  /backup/upgraded/studio.sqlite > "$backup_dir/import.json"
candidate_compose run -T --rm --no-deps -u 0 api-migrate \
  node apps/api/scripts/provision-runtime-role.mjs

python3 - "$backup_dir/source-counts.json" "$backup_dir/import.json" <<'PY'
import json, sys
source, imported = (json.load(open(path)) for path in sys.argv[1:])
if imported.get('status') != 'imported' or imported.get('sqliteVersion') != 10:
    raise SystemExit('PostgreSQL import did not report success')
if imported.get('missingObjectFiles') != 0:
    raise SystemExit('PostgreSQL import found missing object files; keep API stopped')
if imported.get('counts') != source:
    raise SystemExit('PostgreSQL import table counts differ from SQLite backup')
PY
echo "$backup_dir" > "$BACKUP_ROOT/latest-prepared-path"
printf 'Import prepared and count-checked. Backup: %s\n' "$backup_dir"
echo 'API remains stopped. Run verify.sh, then manually activate only after the public maintenance gate and business checks are ready.'
