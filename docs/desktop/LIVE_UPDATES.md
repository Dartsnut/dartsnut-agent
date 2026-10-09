# Live Updates

Dartsnut Agent uses the Tauri 2 updater plugin with the generic provider.
The release and development wrappers read `DARTSNUT_UPDATER_ENDPOINT` from the
repository-root `.env`; exported process environment values take precedence.
The `.env` file is ignored by Git. CI supplies its values through the process
environment.

```text
https://dartsnutstore.oss-cn-hongkong.aliyuncs.com/agent-update/latest-{{target}}.json
```

Tauri resolves `{{target}}` to `darwin` or `windows`. No dedicated update
server is required. The host only needs to serve the release files over HTTPS.

The desktop app checks for updates on launch after registering its status
listener. Automatic downloads are enabled by default; when an update is found,
it downloads in the background and then asks the user to confirm installation
and relaunch. Turning automatic downloads off keeps the update available for a
manual download or a later check. The preference is stored in the Tauri
app-data directory. Skipping the popup only dismisses it for that version;
Settings continues to show the version and an Update action. Update downloads
an available version or installs one already ready, matching the popup action.

For available and downloaded updates, the popup loads the published GitHub
release body by the updater's exact `availableVersion` tag from
`Dartsnut/dartsnut-agent`. Publish a non-draft release with that tag and body
to show its Markdown notes. The updater manifest's `notes` field is not used:
it may differ from the GitHub release. If the release has no body, the popup
shows an empty-state message; if GitHub cannot be reached (including API rate
limits), it shows an unavailable message without blocking update actions.
Long release bodies scroll independently while the update actions remain visible.

## Local UI preview

`pnpm dev` injects the configured platform feed from `.env`. Direct `tauri dev`
does not add that updater endpoint.

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
- Tauri installer release rows default to `is_current: false`. Set
  `DARTSNUT_RELEASE_IS_CURRENT=true` to mark a release as the current installer
  channel.
