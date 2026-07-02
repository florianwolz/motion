import { defineConfig } from "vite";
import wasm from "vite-plugin-wasm";
import { fileURLToPath } from "node:url";

const motionEngineEntry = fileURLToPath(new URL("../../crates/motion-wasm/pkg/motion_wasm.js", import.meta.url));
const workspaceRoot = fileURLToPath(new URL("../..", import.meta.url));

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [wasm()],
  resolve: {
    alias: {
      "@motion/engine": motionEngineEntry,
    },
  },
  server: {
    port: 5173,
    fs: {
      allow: [workspaceRoot],
    },
  },
  build: {
    target: "es2022",
  },
});
