import { defineConfig } from "vite";
import wasm from "vite-plugin-wasm";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [wasm()],
  resolve: {
    alias: {
      "@motion/engine": "../../crates/motion-wasm/pkg/motion_wasm.js",
    },
  },
  server: {
    port: 5173,
  },
  build: {
    target: "es2022",
  },
});
