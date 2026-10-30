#!/usr/bin/env bash
# Reads the imported PostgreSQL database from an isolated one-off container.
# It never starts the public API service or changes database data.
set -euo pipefail
source "$(dirname "$0")/common.sh"
if [[ $# -ne 1 ]]; then echo 'Usage: verify.sh /absolute/backup-directory' >&2; exit 2; fi
backup_dir="$1"
require_absolute_directory "$backup_dir"
require_absolute_file "$backup_dir/source-counts.json"
require_absolute_file "$backup_dir/import.json"
require_env API_IMAGE PG_IMAGE API_UID API_GID API_ENV_FILE PG_MIGRATION_ENV_FILE PG_RUNTIME_PASSWORD_FILE PG_PASSWORD_FILE API_DATA_DIR_HOST PG_DATA_DIR_HOST CANDIDATE_COMPOSE_FILE
require_private_file "$API_ENV_FILE"
require_private_file "$PG_PASSWORD_FILE"
require_private_file "$PG_MIGRATION_ENV_FILE"
require_private_file "$PG_RUNTIME_PASSWORD_FILE"

python3 - "$backup_dir/source-counts.json" "$backup_dir/import.json" <<'PY'
import json, sys
source, imported = (json.load(open(path)) for path in sys.argv[1:])
if imported.get('status') != 'imported' or imported.get('sqliteVersion') != 10:
    raise SystemExit('Import result is not successful schema 10')
if imported.get('missingObjectFiles') != 0 or imported.get('counts') != source:
    raise SystemExit('Import result has missing objects or count mismatch')
PY

if [[ "$(docker inspect -f '{{.State.Running}}' ai-video-studio-api 2>/dev/null || true)" == 'true' ]]; then
  echo 'Public API is already running; this pre-activation verifier expects it stopped' >&2
  exit 1
fi
if [[ "$(docker inspect -f '{{.State.Running}}' ai-video-studio-db 2>/dev/null || true)" != 'true' ]]; then
  echo 'PostgreSQL container is not running' >&2
  exit 1
fi
if [[ "$(docker inspect -f '{{.State.Health.Status}}' ai-video-studio-db 2>/dev/null || true)" != 'healthy' ]]; then
  echo 'PostgreSQL container is not healthy' >&2
  exit 1
fi
candidate_compose run -T --rm --no-deps -v "$backup_dir:/backup:ro" api \
  node apps/api/scripts/verify-postgres-migration.mjs /backup/source-counts.json
candidate_compose run -T --rm --no-deps api node apps/api/scripts/verify-runtime-role.mjs
echo 'Database counts and materialized object paths verified. Public API remains stopped.'
