# Tauri local releases

`scripts/build-release.mjs` is one local wrapper for signed Tauri updater
builds. It synchronizes the requested version across JavaScript manifests,
Cargo, Cargo.lock, and `tauri.conf.json`, builds platform artifacts, and checks
that installer, updater payload, and signature exist. `pnpm release:publish`
then uploads those files and assembles `latest-darwin.json` or
`latest-windows.json` with the final artifact URL and inline signature.

Run from repository root:

```sh
pnpm run package:mac -- --version 1.7.5
pnpm run package:win -- --version 1.7.5
pnpm release:publish -- 1.7.5
```

`release:publish` chooses the current host, performs the signed build, validates
fresh artifacts, then uploads the installer and platform-specific updater feed.

Version can also be positional (`pnpm run package:mac -- 1.7.5`). Without a
version argument, all workspace versions must already match. Use
`--env-file path/to/release.env` to select another dotenv file.

Builds are host-native: macOS release runs on macOS and Windows release runs on
Windows. Cross-building is not part of this wrapper because Tauri bundling and
platform signing require native toolchains.

## Release configuration

Copy `.env.example` to `.env.release.local` and fill local values. The same
file works on macOS and Windows; set `TAURI_SIGNING_PRIVATE_KEY_PATH` to a path
valid on the current host. `.env.release.local` is ignored by Git and is used
by both the build wrapper and `release:publish`.

macOS local releases also require `DARTSNUT_MACOS_SIGNING_IDENTITY`, set to a
certificate identity installed on the build machine.

For development-only renderer and community settings, copy `.env.example` to
`.env` instead. `scripts/build-release.mjs` also accepts any dotenv file
explicitly with `--env-file path/to/release.env`.

Required values:

- `TAURI_SIGNING_PRIVATE_KEY_PATH`, an absolute path to the minisign private
  key. The wrapper reads it into `TAURI_SIGNING_PRIVATE_KEY` before `tauri
  build`; this avoids Tauri's “no private key” error.
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`, blank when key has no password.
- `TAURI_SIGNING_PUBLIC_KEY`, matching the literal updater public key in
  `src-tauri/tauri.conf.json`.

Release publishing also requires `DARTSNUT_RELEASE_API_BASE`,
`DARTSNUT_RELEASE_ACCOUNT`, and `DARTSNUT_RELEASE_PASSWORD`. The optional
`DARTSNUT_RELEASE_DESCRIPTION` becomes the release description.

The public key is not secret. Never commit private key files or populated env
files. A key can be generated with:

```sh
pnpm exec tauri signer generate --write-keys /absolute/path/to/dartsnut-agent.key
```

## macOS signing

Set `DARTSNUT_MACOS_SIGNING_IDENTITY` to an installed Apple signing
certificate. Check available identities with `security find-identity -v -p
codesigning`. The wrapper passes the configured identity to Tauri and runs
`codesign --verify --deep --strict` on the built `.app`. Notarization is
intentionally disabled for these local releases; no Apple account credentials
are needed.

## Windows signing

The updater payload is signed by the Tauri minisign key above. Windows
installer Authenticode signing is separate and only occurs when a certificate
and Tauri Windows signing configuration are installed on the Windows runner.

Artifacts land under:

```text
src-tauri/target/aarch64-apple-darwin/release/bundle/
src-tauri/target/x86_64-pc-windows-msvc/release/bundle/
```

The Tauri publisher scans the complete platform `bundle/` directory because
installers and updater payloads occupy sibling subdirectories. Tauri v2 Windows
emits a self-contained signed NSIS executable (the installer is also the
updater payload); the publisher uploads it as `.nsis.exe` and also accepts the
older `.nsis.zip` wrapper.
Uploaded updater files receive a
`dartsnut-agent-tauri-` prefix. Existing external legacy updater objects in the
shared OSS directory remain untouched. Installer release records use
`is_current: false` for now.
