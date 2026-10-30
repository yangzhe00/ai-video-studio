# Docker API Deployment Design

## Scope

Keep the currently deployed SQLite release and database format. Package its API in an immutable Linux Node 24 image and run it with Docker Compose. The existing `sr-nginx` container continues to serve the web build and terminate HTTPS. Its `/api/` upstream remains `172.23.0.1:8787`, so users keep the same URL and cookies. PostgreSQL migration is a separate release.

## Runtime boundary

- Build from the exact active server release, with `pnpm install --frozen-lockfile` inside the Linux image. Never copy a macOS `node_modules` tree.
- Inject `/etc/ai-video-studio/api.env` at container start; keep credentials out of the image and Compose file.
- Mount `/var/lib/ai-video-studio` read/write with the existing `ai-video` UID/GID. All other image paths are read only; `/tmp` is temporary.
- Publish API port 8787 only on the Docker bridge gateway IP used by `sr-nginx` (`172.23.0.1`). Retain a single API instance because SQLite and in-process workers are not multi-instance safe.
- Use a health check, restart policy, explicit image tag, and a rollback to the retained systemd service.

## Cutover and acceptance

First build and smoke test the image using an isolated empty data directory and no provider credentials. Back up the live SQLite database and environment file before stopping the existing service. Start Compose with the same data directory and environment. Verify container health, public HTTPS homepage, `/api/health`, authenticated API behavior, and uploaded media without submitting a paid video job. If the new service fails, stop it and restart the old systemd service; do not restore an old database over any data written after cutover.

Ask the existing test chat to perform user-visible regression and provide screenshots. Update `.codex/.agent` only after the production state and test result are known.
