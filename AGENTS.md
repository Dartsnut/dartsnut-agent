# Dartsnut Agent

Desktop app for building and deploying Dartsnut games and widgets. Tauri v2 (Rust) backend plus a React 18 renderer, with two internal packages (`desktop-contracts`, `emulator-protocol`) shared between them.

## Layout

- `src/` — React renderer. Entry `main.tsx`; the app shell and most orchestration live in `App.tsx`.
- `src-tauri/src/` — Rust backend: `agent.rs` (agent loop), `emulator.rs` (128×160 device emulator driven through shared memory), `deploy/` (archive + sideload to devices), `runtime.rs` (managed Python/uv), `projects.rs` (project/chat store), `workspace.rs` (workspace root and path-escape guard).
- `packages/desktop-contracts/` — types shared by renderer and backend contracts.
- `packages/emulator-protocol/` — emulator command and frame protocol.
- `src-tauri/resources/skills/` — source for the generated `plugins/dartsnut-agent/` bundle. Edit the Markdown here, then `pnpm run export:agent-plugin`.
- `docs/desktop/` — operator docs: deploying to a machine, live updates, release signing.

## Commands

```bash
pnpm run dev              # Tauri dev (Vite on 127.0.0.1:5173)
pnpm run test             # contracts + renderer + release-script tests
pnpm run test:renderer    # vitest only
pnpm run build            # contracts, then tauri build
cargo test --manifest-path src-tauri/Cargo.toml
```

CI (`.github/workflows`) runs contracts build, renderer build, `pnpm test`, and the Rust suite on every pull request. Both suites must stay green.

## Conventions

- Renderer decisions go in pure modules beside their component, with a `*.test.ts` beside them — `emulatorProjectUi.ts`, `workspaceFaultCopy.ts`, `splitPaneSizing.ts` are the model. Test the decision, not the DOM.
- Rust unit tests live in a `mod tests` at the bottom of the module they cover, and drive real temp directories rather than mocks.
- Anything that reads or writes workspace files goes through the workspace root guard in `workspace.rs`; do not join raw paths from the renderer.
- Never widen the Tauri capability list or the CSP to make a feature work without saying so explicitly in the PR.

## Agent skills

### Issue tracker

Issues and specs live as GitHub issues in `Dartsnut/dartsnut-agent`, driven by `gh`. See `docs/agents/issue-tracker.md`.

### Triage labels

Five canonical triage roles mapped to same-named GitHub labels. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `GLOSSARY.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.
