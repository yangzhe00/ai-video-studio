#!/usr/bin/env bash
set -euo pipefail

repo_root=$(cd "$(dirname "$0")/../.." && pwd)
config="$repo_root/apps/desktop/src-tauri/tauri.conf.json"
version=$(node -e 'const fs=require("node:fs"); process.stdout.write(JSON.parse(fs.readFileSync(process.argv[1],"utf8")).version)' "$config")
dmg="$repo_root/apps/desktop/src-tauri/target/release/bundle/dmg/AI Video Studio_${version}_aarch64.dmg"

cd "$repo_root"
pnpm tauri build --bundles dmg
test -f "$dmg"
hdiutil verify "$dmg" >/dev/null

mount_dir=$(mktemp -d /private/tmp/avs-dmg-verify.XXXXXX)
mounted=0
cleanup() {
  if (( mounted == 1 )); then hdiutil detach "$mount_dir" >/dev/null || true; fi
  rmdir "$mount_dir" 2>/dev/null || true
}
trap cleanup EXIT
hdiutil attach -readonly -nobrowse -mountpoint "$mount_dir" "$dmg" >/dev/null
mounted=1
app="$mount_dir/AI Video Studio.app"
test -d "$app"
test -L "$mount_dir/Applications"
codesign --verify --deep --strict --verbose=2 "$app" >/dev/null
actual_version=$(plutil -extract CFBundleShortVersionString raw -o - "$app/Contents/Info.plist")
test "$actual_version" = "$version"
file "$app/Contents/MacOS/ai-video-studio" | grep -q 'arm64'

bytes=$(stat -f '%z' "$dmg")
sha256=$(shasum -a 256 "$dmg" | awk '{print $1}')
printf 'version=%s\nbytes=%s\nsha256=%s\npath=%s\n' "$version" "$bytes" "$sha256" "$dmg"
