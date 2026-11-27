# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

## Layout

**Single-context.** One `GLOSSARY.md` and one `docs/adr/` at the repo root, covering the whole app: the Tauri backend, the React renderer, and both workspace packages (`desktop-contracts`, `emulator-protocol`).

`pnpm-workspace.yaml` and the populated `packages/*` are monorepo *signals*, but the packages are small and share one vocabulary with their consumers — a workspace, a project, a chat, an emulator, a deploy, a fault. Splitting the glossary per package would fragment exactly the terms that need a single definition. Revisit this if a package ever grows a vocabulary of its own with its own owner.

## Before exploring, read these

- **`GLOSSARY.md`** at the repo root.
- **`docs/adr/`**: read ADRs that touch the area you're about to work in.

If any of these files don't exist, **proceed silently**. Don't flag their absence; don't suggest creating them upfront. The `/domain-modeling` skill (reached via `/grill-with-docs` and `/improve-codebase-architecture`) creates them lazily when terms or decisions actually get resolved.

## File structure

```text
/
├── GLOSSARY.md
├── docs/
│   ├── adr/
│   │   ├── 0001-...
│   │   └── 0002-...
│   ├── agents/          ← this directory: consumer rules, not domain docs
│   └── desktop/         ← operator docs (deploy, live updates, signing)
├── packages/
├── src/
└── src-tauri/
```

## Use the glossary's vocabulary

When your output names a domain concept (in an issue title, a refactor proposal, a hypothesis, a test name), use the term as defined in `GLOSSARY.md`. Don't drift to synonyms the glossary explicitly avoids.

If the concept you need isn't in the glossary yet, that's a signal: either you're inventing language the project doesn't use (reconsider) or there's a real gap (note it for `/domain-modeling`).

## Flag ADR conflicts

If your output contradicts an existing ADR, surface it explicitly rather than silently overriding:

> _Contradicts ADR-0002 (scratch editor is AGPL, bundled unmodified), but worth reopening because…_

## Related documentation

`docs/` also holds behaviour specs that are not ADRs and not glossary entries — `PYTHON_RUNTIME.md`, `PIXELLAB_AGENT_TOOL.md`, and the `docs/desktop/` operator guides. Those describe *how a subsystem works*, not *what a term means* or *what we decided*. Cite them when relevant; don't treat them as decision records.
