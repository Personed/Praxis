import { defineConfig } from "vitest/config";

// The desktop main process imports "electron", provided by the sidecar shim
// at runtime — alias it here so tests resolve the same implementation.
export default defineConfig({
  resolve: {
    alias: {
      electron: new URL("./src/sidecar/electron-shim.ts", import.meta.url).pathname,
    },
  },
});
