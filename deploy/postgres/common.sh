#!/usr/bin/env bash
set -euo pipefail

require_env() {
  local name
  for name in "$@"; do
    if [[ -z "${!name:-}" ]]; then
      printf 'Missing required environment variable: %s\n' "$name" >&2
      exit 2
    fi
  done
}

require_absolute_directory() {
  [[ "$1" = /* && -d "$1" ]] || { printf 'Expected existing absolute directory: %s\n' "$1" >&2; exit 2; }
}

require_absolute_file() {
  [[ "$1" = /* && -f "$1" ]] || { printf 'Expected existing absolute file: %s\n' "$1" >&2; exit 2; }
}

require_private_file() {
  require_absolute_file "$1"
  python3 - "$1" <<'PY'
import os, stat, sys
mode = stat.S_IMODE(os.stat(sys.argv[1]).st_mode)
if mode & 0o077:
    raise SystemExit(f"Private file is accessible to group or others: {sys.argv[1]}")
PY
}

candidate_compose() {
  docker compose -f "$CANDIDATE_COMPOSE_FILE" "$@"
}
