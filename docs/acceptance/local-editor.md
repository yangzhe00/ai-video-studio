# Local editor acceptance — 2026-10-27

## Automated checks observed

- `pnpm test --run`: 8 files, 15 tests passed.
- `pnpm build`: TypeScript and Vite build passed.
- `cargo check --offline --manifest-path src-tauri/Cargo.toml`: passed with writable temporary Cargo cache.
- `cargo test --offline --manifest-path src-tauri/Cargo.toml` with local fixture variables: 11 Rust tests passed.
- Real-fixture tests used a 320×240 PNG and a 1-second MP4 created in `/tmp`; import preserved source bytes, rejected a corrupt MP4 and a PNG renamed to MP4, marked a deleted copied asset missing, and exported a two-clip 1080×1920 MP4 plus cover PNG. Export included a Chinese caption with quotes and a newline in a Chinese-named project directory.
- `pnpm tauri dev`: Vite started on `127.0.0.1:1420`, Cargo built, and the application process launched. The desktop window did not appear in the available GUI controller's app inventory, so project creation/import/export through actual clicks remains unverified.

## Release gates still open

- The development FFmpeg binary reports `--enable-nonfree`; it is ignored by Git and must not be packaged for distribution. Replace it with a redistributable build and document its exact flags and notices.
- No signed/notarized macOS package or installation/launch proof yet.
- Current preview loads one asset into memory and caps it at 100 MB. Larger media needs a scoped streaming path.
- Freeform shot drafts, V2 project migration, dated cost estimates, and budget checks are implemented. Keychain-backed provider credential settings are implemented and tested with a fake store, but live Keychain UI acceptance remains pending. Paid image-to-video generation, speech, and lip-sync remain in the AI plan.
