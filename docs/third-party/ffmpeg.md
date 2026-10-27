# FFmpeg / ffprobe development status

The app currently copies `ffprobe` from `@ffprobe-installer/ffprobe` into an ignored local development folder. This allows media probing while developing and running tests. The app does **not** yet bundle either binary in a release.

`@ffmpeg-installer/ffmpeg` is installed only for local fixture generation and future export development. The tested macOS ARM binary reports `--enable-gpl`, `--enable-version3`, and `--enable-nonfree`. It must **not** be redistributed with an open-source application as-is. Before implementing release packaging, choose or build a redistributable FFmpeg/ffprobe pair, record the exact binary source and build flags, obtain license review, add notices, and verify the final packaged app contains only the approved pair.

Development packages: `@ffmpeg-installer/ffmpeg@1.1.0` and `@ffprobe-installer/ffprobe@2.1.2` (see `pnpm-lock.yaml`). Version labels on the wrapper are not enough to establish binary redistribution rights; inspect each actual binary's `-version` output.
