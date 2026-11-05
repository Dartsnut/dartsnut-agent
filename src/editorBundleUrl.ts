/**
 * The one address the Scratch editor is ever loaded from.
 *
 * The bundle is built by `scripts/build-editor-bundle.mjs` into `public/editor`
 * and referenced by a literal path so dev (`127.0.0.1:5173`) and packaged builds
 * (`tauri.localhost`) resolve it identically — Vite's `base: "./"` only rewrites
 * asset URLs it emits itself, and this path is served at the origin root in both.
 *
 * The bundle is a self-contained React 16 app. Load it in a same-origin iframe
 * and never import it into this tree.
 */
export const SCRATCH_EDITOR_BUNDLE_URL = "/editor/dartsnut.html";
