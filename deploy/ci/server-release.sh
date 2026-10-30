#!/usr/bin/env bash
# Install root-owned at /usr/local/sbin/avs-release. Called by a restricted GitHub environment.
set -euo pipefail
umask 077

if [[ $# -ne 4 ]]; then echo 'Usage: avs-release <prepare|cutover|activate|publish> <commit-sha> <bundle-sha256> <script-sha256>' >&2; exit 2; fi
phase="$1"
release_sha="$2"
bundle_sha="$3"
script_sha="$4"
[[ "$EUID" -eq 0 ]] || { echo 'Release operator must run as root' >&2; exit 2; }
[[ "$phase" =~ ^(prepare|cutover|activate|publish)$ && "$release_sha" =~ ^[0-9a-f]{40}$ && "$bundle_sha" =~ ^[0-9a-f]{64}$ && "$script_sha" =~ ^[0-9a-f]{64}$ ]] || {
  echo 'Invalid release phase or digest' >&2; exit 2;
}
[[ "$(sha256sum "$0" | awk '{print $1}')" == "$script_sha" ]] || { echo 'Installed release script differs from reviewed commit' >&2; exit 2; }

config='/etc/ai-video-studio/release.env'
[[ -f "$config" && ! -L "$config" && "$(stat -c '%u:%a' "$config")" == '0:600' ]] || {
  echo 'Release configuration must be a root-owned 0600 regular file' >&2; exit 2;
}
set -a
# shellcheck source=/dev/null
source "$config"
set +a
for key in API_DATA_DIR_HOST OLD_API_ENV_FILE API_ENV_FILE PG_MIGRATION_ENV_FILE PG_RUNTIME_PASSWORD_FILE PG_DATA_DIR_HOST REHEARSAL_PG_DATA_DIR_HOST PG_PASSWORD_FILE PG_IMAGE NODE_IMAGE BACKUP_ROOT OLD_COMPOSE_FILE ACTIVE_NGINX_CONFIG STATIC_ROOT_HOST PUBLIC_BASE_URL API_BIND_IP API_HOST_PORT; do
  [[ -n "${!key:-}" ]] || { echo "Missing release configuration: $key" >&2; exit 2; }
done
[[ "$PG_IMAGE" =~ @sha256:[0-9a-f]{64}$ ]] || { echo 'PG_IMAGE must be pinned to a digest' >&2; exit 2; }
[[ "$NODE_IMAGE" =~ @sha256:[0-9a-f]{64}$ ]] || { echo 'NODE_IMAGE must be pinned to a digest' >&2; exit 2; }
[[ "$PUBLIC_BASE_URL" == 'https://39.108.55.176/' ]] || { echo 'Public release URL differs from reviewed IP site' >&2; exit 2; }
for dir in "$API_DATA_DIR_HOST" "$PG_DATA_DIR_HOST" "$REHEARSAL_PG_DATA_DIR_HOST" "$BACKUP_ROOT" "$STATIC_ROOT_HOST"; do
  [[ "$dir" = /* && -d "$dir" && ! -L "$dir" ]] || { echo "Invalid release directory: $dir" >&2; exit 2; }
done
[[ "$PG_DATA_DIR_HOST" != "$REHEARSAL_PG_DATA_DIR_HOST" ]] || { echo 'Formal and rehearsal PG paths must differ' >&2; exit 2; }
for file in "$OLD_API_ENV_FILE" "$API_ENV_FILE" "$PG_MIGRATION_ENV_FILE" "$PG_RUNTIME_PASSWORD_FILE" "$PG_PASSWORD_FILE" "$OLD_COMPOSE_FILE" "$ACTIVE_NGINX_CONFIG"; do
  [[ "$file" = /* && -f "$file" && ! -L "$file" ]] || { echo "Invalid release file: $file" >&2; exit 2; }
done

release_dir="/srv/ai-video-studio/releases/$release_sha"
incoming="/srv/ai-video-studio/incoming/$release_sha.tar.gz"
API_IMAGE="ai-video-studio-api:$release_sha"
CANDIDATE_COMPOSE_FILE="$release_dir/deploy/docker/compose.yaml"
OLD_NGINX_CONFIG="$ACTIVE_NGINX_CONFIG"
RELEASE_ID="$release_sha"
export API_IMAGE CANDIDATE_COMPOSE_FILE OLD_NGINX_CONFIG RELEASE_ID

require_marker() {
  [[ -f "$release_dir/.$1" ]] && grep -Fxq "release=$release_sha" "$release_dir/.$1" || {
    echo "Required release stage missing: $1" >&2; exit 2;
  }
}
write_marker() {
  local stage="$1" temp="$release_dir/.$1.$$.tmp"
  printf 'release=%s\n' "$release_sha" > "$temp"
  chmod 0600 "$temp"
  mv -f "$temp" "$release_dir/.$stage"
}
check_candidate_image() {
  [[ -f "$release_dir/.api-image-id" ]] &&
    [[ "$(docker image inspect "$API_IMAGE" --format '{{.Id}}')" == "$(cat "$release_dir/.api-image-id")" ]] || {
    echo 'Candidate API image differs from prepared image ID' >&2; exit 2;
  }
}
check_maintenance() {
  local headers
  headers="$(curl --silent --show-error --head --max-time 15 "$PUBLIC_BASE_URL"'api/health')"
  printf '%s\n' "$headers" | grep -Eqi '^HTTP/[0-9.]+ 503|^HTTP/2 503' || { echo 'Public API is not gated with HTTP 503' >&2; exit 2; }
  printf '%s\n' "$headers" | grep -Eqi '^x-avs-maintenance: 1\r?$' || { echo 'Public API maintenance marker missing' >&2; exit 2; }
}
candidate_compose() { docker compose -f "$CANDIDATE_COMPOSE_FILE" "$@"; }

case "$phase" in
  prepare)
    [[ ! -e "$release_dir" && -f "$incoming" && ! -L "$incoming" ]] || { echo 'Release exists or uploaded bundle missing' >&2; exit 2; }
    [[ "$(sha256sum "$incoming" | awk '{print $1}')" == "$bundle_sha" ]] || { echo 'Uploaded bundle checksum mismatch' >&2; exit 2; }
    python3 - "$incoming" <<'PY'
import pathlib, sys, tarfile
with tarfile.open(sys.argv[1], 'r:gz') as archive:
    for member in archive:
        parts = pathlib.PurePosixPath(member.name).parts
        if member.name.startswith('/') or '..' in parts or not (member.isfile() or member.isdir()):
            raise SystemExit('Unsafe release archive member')
PY
    mkdir -m 0700 "$release_dir"
    tar --no-same-owner -xzf "$incoming" -C "$release_dir"
    [[ -f "$release_dir/.release-commit" ]] && grep -Fxq "$release_sha" "$release_dir/.release-commit" || {
      echo 'Bundle commit marker does not match requested release' >&2; exit 2;
    }
    [[ -f "$CANDIDATE_COMPOSE_FILE" && -f "$release_dir/apps/website/dist/index.html" && -f "$release_dir/apps/web/dist/index.html" ]] || {
      echo 'Candidate source or static builds missing' >&2; exit 2;
    }
    docker build --build-arg "NODE_IMAGE=$NODE_IMAGE" -f "$release_dir/deploy/docker/Dockerfile.api" -t "$API_IMAGE" "$release_dir"
    docker image inspect "$API_IMAGE" --format '{{.Id}}' > "$release_dir/.api-image-id"
    docker pull "$PG_IMAGE"
    "$release_dir/deploy/postgres/preflight.sh"
    bash "$release_dir/deploy/postgres/rehearsal.sh"
    "$release_dir/deploy/postgres/preflight.sh"
    write_marker prepared
    printf 'Candidate built and schema 9->10->PG rehearsal passed: %s\n' "$release_sha"
    ;;
  cutover)
    require_marker prepared
    check_candidate_image
    [[ ! -e "$release_dir/.cutover" ]] || { echo 'Cutover already recorded' >&2; exit 2; }
    check_maintenance
    MAINTENANCE_GATE_CONFIRMED=1 "$release_dir/deploy/postgres/cutover.sh" --execute
    backup_dir="$(cat "$BACKUP_ROOT/latest-prepared-path")"
    "$release_dir/deploy/postgres/verify.sh" "$backup_dir"
    write_marker cutover
    printf 'Formal data imported and verified; public API remains gated: %s\n' "$release_sha"
    ;;
  activate)
    require_marker cutover
    check_candidate_image
    [[ ! -e "$release_dir/.activated" ]] || { echo 'API already activated' >&2; exit 2; }
    check_maintenance
    candidate_compose up -d --no-deps --wait api
    [[ "$(docker inspect ai-video-studio-api --format '{{.State.Health.Status}}')" == healthy ]] || { echo 'Candidate API is not healthy' >&2; exit 1; }
    curl --fail --silent --show-error --max-time 15 "http://$API_BIND_IP:$API_HOST_PORT/health" | grep -q '"ok":true' || {
      echo 'Private candidate API health failed' >&2; exit 1;
    }
    write_marker activated
    printf 'Private API healthy; keep public maintenance gate for business checks: %s\n' "$release_sha"
    ;;
  publish)
    require_marker activated
    check_candidate_image
    [[ ! -e "$release_dir/.published" ]] || { echo 'Site already published' >&2; exit 2; }
    check_maintenance
    acceptance="/etc/ai-video-studio/release-acceptance/$release_sha.ok"
    [[ -f "$acceptance" && ! -L "$acceptance" && "$(stat -c '%u:%a' "$acceptance")" == '0:600' ]] || {
      echo 'Root-owned 0600 business acceptance marker missing' >&2; exit 2;
    }
    grep -Fxq "release=$release_sha" "$acceptance" &&
      grep -Fxq 'accounts=passed' "$acceptance" &&
      grep -Fxq 'projects=passed' "$acceptance" &&
      grep -Fxq 'objects=passed' "$acceptance" &&
      grep -Fxq 'pending_tasks=passed' "$acceptance" &&
      grep -Fxq 'ideas=passed' "$acceptance" || {
      echo 'Business acceptance does not match candidate' >&2; exit 2;
    }
    [[ "$(docker inspect ai-video-studio-api --format '{{.State.Health.Status}}')" == healthy ]] || { echo 'Candidate API is not healthy' >&2; exit 1; }
    if [[ -f "$STATIC_ROOT_HOST/downloads/latest.json" ]]; then
      grep -Fxq 'dmg_install=passed' "$acceptance" || { echo 'DMG installation acceptance missing' >&2; exit 2; }
    else
      grep -Fxq 'dmg_install=not_published' "$acceptance" || { echo 'Disabled download acceptance missing' >&2; exit 2; }
    fi
    python3 - "$STATIC_ROOT_HOST/downloads" <<'PY'
import hashlib, json, pathlib, re, sys
folder = pathlib.Path(sys.argv[1]); manifest_path = folder / 'latest.json'
if not manifest_path.exists():
    print('No DMG manifest; website must keep download CTA disabled')
    raise SystemExit(0)
manifest = json.loads(manifest_path.read_text())
name = manifest.get('filename', '')
if not re.fullmatch(r'AI-Video-Studio-[0-9A-Za-z.-]+-macos-arm64\.dmg', name): raise SystemExit('Invalid DMG filename')
file = folder / name
if not file.is_file() or file.stat().st_size != manifest.get('bytes'): raise SystemExit('DMG missing or size differs')
digest = hashlib.sha256()
with file.open('rb') as stream:
    for chunk in iter(lambda: stream.read(1024 * 1024), b''): digest.update(chunk)
if digest.hexdigest() != manifest.get('sha256'): raise SystemExit('DMG checksum differs from manifest')
print('DMG manifest and bytes verified')
PY
    site_backup="$BACKUP_ROOT/$release_sha-site-before-$(date -u +%Y%m%dT%H%M%SZ)"
    mkdir -m 0700 "$site_backup"
    cp -p "$ACTIVE_NGINX_CONFIG" "$site_backup/nginx.conf"
    [[ ! -f "$STATIC_ROOT_HOST/index.html" ]] || cp -p "$STATIC_ROOT_HOST/index.html" "$site_backup/home-index.html"
    [[ ! -f "$STATIC_ROOT_HOST/studio/index.html" ]] || cp -p "$STATIC_ROOT_HOST/studio/index.html" "$site_backup/studio-index.html"
    published=0
    rollback_site() {
      if [[ "$published" != 1 ]]; then
        set +e
        cp "$site_backup/nginx.conf" "$ACTIVE_NGINX_CONFIG"
        if [[ -f "$site_backup/home-index.html" ]]; then cp "$site_backup/home-index.html" "$STATIC_ROOT_HOST/index.html"; else rm -f "$STATIC_ROOT_HOST/index.html"; fi
        if [[ -f "$site_backup/studio-index.html" ]]; then cp "$site_backup/studio-index.html" "$STATIC_ROOT_HOST/studio/index.html"; else rm -f "$STATIC_ROOT_HOST/studio/index.html"; fi
        docker exec sr-nginx nginx -t >/dev/null 2>&1 && docker exec sr-nginx nginx -s reload >/dev/null 2>&1
        echo 'Static indexes/Nginx restored; PostgreSQL data retained. Check maintenance gate.' >&2
      fi
    }
    trap rollback_site EXIT
    mkdir -p "$STATIC_ROOT_HOST/studio"
    tar -C "$release_dir/apps/website/dist" --exclude='./index.html' -cf - . | tar -C "$STATIC_ROOT_HOST" -xf -
    tar -C "$release_dir/apps/web/dist" --exclude='./index.html' -cf - . | tar -C "$STATIC_ROOT_HOST/studio" -xf -
    cp "$release_dir/apps/website/dist/index.html" "$STATIC_ROOT_HOST/.index-$release_sha.tmp"
    cp "$release_dir/apps/web/dist/index.html" "$STATIC_ROOT_HOST/studio/.index-$release_sha.tmp"
    cp "$release_dir/deploy/nginx/ai-video-ip.conf" "$ACTIVE_NGINX_CONFIG"
    docker exec sr-nginx nginx -t
    mv -f "$STATIC_ROOT_HOST/studio/.index-$release_sha.tmp" "$STATIC_ROOT_HOST/studio/index.html"
    mv -f "$STATIC_ROOT_HOST/.index-$release_sha.tmp" "$STATIC_ROOT_HOST/index.html"
    docker exec sr-nginx nginx -s reload
    docker run --rm --network host "$API_IMAGE" node /app/deploy/ci/verify-public.mjs "$PUBLIC_BASE_URL"
    write_marker published
    published=1
    trap - EXIT
    printf 'Published %s; static/Nginx backup: %s\n' "$release_sha" "$site_backup"
    ;;
esac
