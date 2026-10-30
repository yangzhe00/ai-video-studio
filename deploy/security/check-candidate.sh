#!/usr/bin/env bash
# Checks repository tracking and private-file modes without displaying secret contents.
set -euo pipefail
cd "$(dirname "$0")/../.."
python3 - <<'PY'
import subprocess
tracked = subprocess.check_output(['git', 'ls-files', '-z']).decode().split('\0')
bad = [path for path in tracked if path and (path.endswith(('.env', '.env.local', '.pem', '.key', '.p12')) or '/.env.' in path and not path.endswith('.env.example'))]
if bad:
    raise SystemExit('Tracked credential-like files: ' + ', '.join(bad))
print('Tracked credential-like files: none')
PY
set +e
git grep -l -E -e '-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----' -- ':!pnpm-lock.yaml' >/dev/null
scan_status=$?
set -e
if [[ "$scan_status" == 0 ]]; then
  echo 'Tracked private-key marker found; inspect locally without printing contents' >&2
  exit 1
fi
if [[ "$scan_status" != 1 ]]; then echo 'Tracked-file scan failed' >&2; exit "$scan_status"; fi
echo 'Tracked private-key markers: none'
for variable in API_ENV_FILE PG_MIGRATION_ENV_FILE PG_PASSWORD_FILE PG_RUNTIME_PASSWORD_FILE; do
  file="${!variable:-}"
  if [[ -z "$file" ]]; then continue; fi
  python3 - "$variable" "$file" <<'PY'
import os, stat, sys
name, path = sys.argv[1:]
mode = stat.S_IMODE(os.stat(path).st_mode)
if mode & 0o077: raise SystemExit(f'{name}: permissions too broad ({mode:04o})')
print(f'{name}: private ({mode:04o})')
PY
done
