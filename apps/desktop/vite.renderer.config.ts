import { resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/**
 * Standalone renderer build for the Tauri shell (Electron-free).
 * Mirrors the `renderer` block in electron.vite.config.ts.
 */
export default defineConfig({
  root: "src/renderer",
  plugins: [react(), tailwindcss()],
  base: "./",
  build: {
    outDir: "../../out/renderer-web",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        index: resolve(__dirname, "src/renderer/index.html"),
        doom: resolve(__dirname, "src/renderer/doom.html"),
      },
    },
  },
  server: {
    port: 5173,
    strictPort: true,
  },
});
