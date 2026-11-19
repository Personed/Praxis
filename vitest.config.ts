import { defineConfig } from "vitest/config";

// Tests run with --root pointing at the repo root; the desktop main process
// imports "electron" which is provided by the sidecar shim at runtime.
export default defineConfig({
  resolve: {
    alias: {
      electron: new URL("./apps/desktop/src/sidecar/electron-shim.ts", import.meta.url).pathname,
    },
  },
});
