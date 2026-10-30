#!/usr/bin/env bash
# Rehearse schema 9 -> schema 10 -> PostgreSQL using a live SQLite backup.
# The active SQLite database and old API keep serving throughout this script.
set -euo pipefail
source "$(dirname "$0")/common.sh"
require_env RELEASE_ID API_IMAGE PG_IMAGE API_GID API_DATA_DIR_HOST API_ENV_FILE PG_MIGRATION_ENV_FILE \
  PG_PASSWORD_FILE PG_RUNTIME_PASSWORD_FILE \
  REHEARSAL_PG_DATA_DIR_HOST BACKUP_ROOT CANDIDATE_COMPOSE_FILE
require_absolute_directory "$API_DATA_DIR_HOST"
require_absolute_directory "$REHEARSAL_PG_DATA_DIR_HOST"
require_absolute_directory "$BACKUP_ROOT"
require_private_file "$API_ENV_FILE"
require_private_file "$PG_MIGRATION_ENV_FILE"
require_private_file "$PG_PASSWORD_FILE"
require_private_file "$PG_RUNTIME_PASSWORD_FILE"
if [[ -n "$(find "$REHEARSAL_PG_DATA_DIR_HOST" -mindepth 1 -maxdepth 1 -print -quit)" ]]; then
  echo 'Rehearsal PostgreSQL directory must be empty' >&2
  exit 2
fi
if docker inspect ai-video-studio-db >/dev/null 2>&1; then
  echo 'PostgreSQL container name already in use' >&2
  exit 2
fi
if [[ "$(docker inspect -f '{{.State.Running}}' ai-video-studio-api 2>/dev/null || true)" != 'true' ]]; then
  echo 'Old API must still be running for an online rehearsal' >&2
  exit 2
fi
"$(dirname "$0")/preflight.sh"

rehearsal_dir="$BACKUP_ROOT/rehearsal-${RELEASE_ID}-$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -m 0700 "$rehearsal_dir"
export PG_DATA_DIR_HOST="$REHEARSAL_PG_DATA_DIR_HOST"
cleanup() {
  candidate_compose stop db >/dev/null 2>&1 || true
  candidate_compose rm -f db >/dev/null 2>&1 || true
}
trap cleanup EXIT

python3 - "$API_DATA_DIR_HOST/studio.sqlite" "$rehearsal_dir/studio.sqlite" "$rehearsal_dir/source-counts.json" <<'PY'
import json, sqlite3, sys, urllib.parse
source, target, counts_path = sys.argv[1:]
uri = 'file:' + urllib.parse.quote(source) + '?mode=ro'
src = sqlite3.connect(uri, uri=True)
dst = sqlite3.connect(target)
try:
    if src.execute('PRAGMA user_version').fetchone()[0] != 9:
        raise SystemExit('Expected active SQLite schema 9')
    if src.execute('PRAGMA quick_check').fetchone()[0] != 'ok':
        raise SystemExit('Active SQLite quick_check failed')
    src.backup(dst)
    if dst.execute('PRAGMA integrity_check').fetchone()[0] != 'ok':
        raise SystemExit('Rehearsal SQLite backup integrity check failed')
    tables = [row[0] for row in dst.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")]
    counts = {name: dst.execute('SELECT COUNT(*) FROM "' + name.replace('"', '""') + '"').fetchone()[0] for name in tables}
    with open(counts_path, 'w') as out: json.dump(counts, out, sort_keys=True)
finally:
    dst.close(); src.close()
PY

docker run --rm --network none --mount "type=bind,src=$rehearsal_dir,dst=/backup" "$API_IMAGE" \
  node --experimental-transform-types apps/api/scripts/upgrade-sqlite-copy.mjs \
  --source /backup/studio.sqlite --destination /backup/upgraded/studio.sqlite > "$rehearsal_dir/upgrade.json"
chgrp "$API_GID" "$rehearsal_dir" "$rehearsal_dir/upgraded" "$rehearsal_dir/upgraded/studio.sqlite" "$rehearsal_dir/source-counts.json"
chmod 0750 "$rehearsal_dir" "$rehearsal_dir/upgraded"
chmod 0640 "$rehearsal_dir/upgraded/studio.sqlite" "$rehearsal_dir/source-counts.json"

candidate_compose up -d --wait db
candidate_compose run -T --rm --no-deps -v "$rehearsal_dir:/backup:ro" api-migrate \
  node --experimental-transform-types apps/api/scripts/migrate-sqlite-to-postgres.mjs \
  /backup/upgraded/studio.sqlite > "$rehearsal_dir/import.json"
candidate_compose run -T --rm --no-deps -u 0 api-migrate \
  node apps/api/scripts/provision-runtime-role.mjs > "$rehearsal_dir/provision.log"
candidate_compose run -T --rm --no-deps -v "$rehearsal_dir:/backup:ro" api \
  node apps/api/scripts/verify-postgres-migration.mjs /backup/source-counts.json > "$rehearsal_dir/verify.json"
candidate_compose run -T --rm --no-deps api \
  node apps/api/scripts/verify-runtime-role.mjs > "$rehearsal_dir/runtime-role.log"

python3 - "$rehearsal_dir/source-counts.json" "$rehearsal_dir/upgrade.json" "$rehearsal_dir/import.json" <<'PY'
import json, sys
source, upgrade, imported = (json.load(open(path)) for path in sys.argv[1:])
if upgrade.get('sourceVersion') != 9 or upgrade.get('targetVersion') != 10 or upgrade.get('counts') != source:
    raise SystemExit('Rehearsal SQLite upgrade counts did not match source')
if imported.get('status') != 'imported' or imported.get('missingObjectFiles') != 0 or imported.get('counts') != source:
    raise SystemExit('Rehearsal PostgreSQL import counts or object files did not match')
print(json.dumps({'status': 'rehearsal_passed', 'counts': source, 'missingObjectFiles': 0}))
PY
printf 'Rehearsal evidence: %s\n' "$rehearsal_dir"
