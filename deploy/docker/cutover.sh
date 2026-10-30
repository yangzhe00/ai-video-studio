#!/usr/bin/env bash
set -euo pipefail

# Run as root on the current Ubuntu host after building and smoke testing API_IMAGE.
release=/srv/ai-video-studio/releases/20261029-cursor-01
compose_dir=/srv/ai-video-studio/docker
data_dir=/var/lib/ai-video-studio
env_file=/etc/ai-video-studio/api.env
backup_dir=/var/backups/ai-video-studio
stamp=$(date -u +%Y%m%dT%H%M%SZ)
stopped=0
started=0

rollback_on_error() {
  code=$?
  trap - EXIT
  if (( code != 0 && stopped == 1 )); then
    if (( started == 1 )); then (cd "$compose_dir" && docker compose down) || true; fi
    systemctl enable ai-video-studio >/dev/null 2>&1 || true
    systemctl start ai-video-studio || true
    printf 'cutover=failed rollback=systemd-attempted\n' >&2
  fi
  exit "$code"
}
trap rollback_on_error EXIT

test "$(id -u)" -eq 0
test "$(readlink -f /srv/ai-video-studio/current)" = "$release"
test -f "$data_dir/studio.sqlite"
test -f "$env_file"
test -f "$compose_dir/compose.yaml"
grep -q '^API_IMAGE=ai-video-studio-api:20261029-cursor-01-docker2$' "$compose_dir/.env"
(cd "$compose_dir" && docker compose config --quiet)
docker image inspect ai-video-studio-api:20261029-cursor-01-docker2 >/dev/null
curl -fsS --max-time 5 http://127.0.0.1:8787/health >/dev/null

umask 077
mkdir -p -m 700 "$backup_dir"
cp -a "$env_file" "$backup_dir/api-env-before-docker-$stamp"
systemctl cat ai-video-studio > "$backup_dir/systemd-before-docker-$stamp.txt"

systemctl stop ai-video-studio
stopped=1
tar --numeric-owner -C /var/lib -czf "$backup_dir/data-before-docker-$stamp.tar.gz" ai-video-studio
python3 - "$data_dir/studio.sqlite" "$backup_dir/studio-before-docker-$stamp.sqlite" <<'PY'
import sqlite3
import sys

source = sqlite3.connect(sys.argv[1])
target = sqlite3.connect(sys.argv[2])
source.backup(target)
assert target.execute('PRAGMA integrity_check').fetchone()[0] == 'ok'
assert target.execute('PRAGMA user_version').fetchone()[0] == 9
target.close()
source.close()
PY

(cd "$compose_dir" && docker compose up -d --no-build api)
started=1
healthy=0
for _ in $(seq 1 18); do
  if [ "$(docker inspect ai-video-studio-api --format '{{.State.Health.Status}}' 2>/dev/null || true)" = healthy ]; then
    healthy=1
    break
  fi
  sleep 5
done
test "$healthy" -eq 1
curl -fsS --max-time 5 http://172.23.0.1:8787/health >/dev/null
curl -kfsS --max-time 8 https://39.108.55.176/api/health >/dev/null
curl -kfsS --max-time 8 https://39.108.55.176/ | grep -q '/assets/'
systemctl disable ai-video-studio >/dev/null
test "$(systemctl is-active ai-video-studio || true)" = inactive

trap - EXIT
printf 'cutover=ok image=%s backup=%s\n' 'ai-video-studio-api:20261029-cursor-01-docker2' "$backup_dir/data-before-docker-$stamp.tar.gz"
