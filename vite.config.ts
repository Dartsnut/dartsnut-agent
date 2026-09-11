import path from "node:path";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Resolve to TS source so Rollup sees named exports (dist CJS uses `__exportStar`, which Vite does not trace). */
const desktopContractsEntry = path.resolve(__dirname, "packages/desktop-contracts/src/index.ts");
const emulatorProtocolEntry = path.resolve(__dirname, "packages/emulator-protocol/src/index.ts");

export default defineConfig({
  base: "./",
  envDir: __dirname,
  server: {
    // Cargo rewrites and locks Windows DLLs while compiling. Vite does not need
    // to watch Rust build artifacts (Tauri watches the Rust sources itself).
    watch: {
      ignored: ["**/src-tauri/target/**"]
    }
  },
  plugins: [
    react(),
    tailwindcss()
  ],
  resolve: {
    alias: {
      "@dartsnut/desktop-contracts": desktopContractsEntry,
      "@dartsnut/emulator-protocol": emulatorProtocolEntry
    }
  }
});
