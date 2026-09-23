# Live Updates

Dartsnut Agent uses the Tauri 2 updater plugin with the generic provider.
The release build wrapper reads `DARTSNUT_UPDATER_ENDPOINT` and appends a
concrete updater config layer before Tauri builds the app. Local releases read
that public setting from the ignored `.env.release.local`; CI sets it
explicitly. The endpoint is not a secret and must be present before a release
build starts.

```text
https://dartsnutstore.oss-cn-hongkong.aliyuncs.com/agent-update/latest-{{target}}.json
```

Tauri resolves `{{target}}` to `darwin` or `windows`. No dedicated update
server is required. The host only needs to serve the release files over HTTPS.

The desktop app checks for updates on launch but does not download them by
default. Tauri performs this check from the renderer after its update event
listener is registered. When an update is available, the app offers a manual
download and a checkbox to enable
automatic downloads. That preference is stored in the Tauri app-data directory.
With automatic downloads enabled, updater behavior matches the normal Tauri
updater flow; installation still waits for the user to confirm and relaunch.

## Local UI preview

Tauri development builds check the configured platform feed, so an older debug
build can verify the live update path. `pnpm dev` uses the real feed.

## Required Artifacts

`pnpm release:publish -- <version>` builds the signed Tauri release for the
current host, uploads it, and assembles platform-specific metadata from the
final OSS URL. Tauri payloads use a `dartsnut-agent-tauri-` prefix so they
do not overwrite existing external legacy updater objects.

macOS:

- `latest-darwin.json`
- `dartsnut-agent-tauri-<version>-darwin-aarch64.app.tar.gz`
- matching `.sig`
- `*.dmg` for manual download

Windows:

- `latest-windows.json`
- `dartsnut-agent-tauri-<version>-windows-x86_64.nsis.exe` (Tauri v2)
- `dartsnut-agent-tauri-<version>-windows-x86_64.nsis.zip` (legacy wrapper)
- matching `.sig`
- `*.exe` for manual download

Tauri publishing never discovers or uploads existing external legacy updater
objects.

## Cache Headers

- `latest-darwin.json` and `latest-windows.json`: no-cache or very short TTL.
- Versioned binaries and signatures: long immutable cache is fine.

## Packaging Notes

- macOS updates require signed packaged builds. The app tarball is used for
  updater compatibility; the dmg can remain the manual installer.
- Windows live updates use the NSIS target. Tauri v2 emits a self-contained
  signed NSIS executable (the installer is also the updater payload); older
  toolchains may emit its equivalent `.nsis.zip` wrapper. Portable builds are
  not the standard auto-update path.
- Tauri installer release rows are published with `is_current: false` until
  Tauri becomes the current installer channel.
