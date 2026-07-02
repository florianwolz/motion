import { defineConfig } from "vite";

// https://vitejs.dev/config/
export default defineConfig({
  // Resolve the WASM package from the sibling crate output directory.
  resolve: {
    alias: {
      "@motion/engine": "../../crates/motion-wasm/pkg",
    },
  },
  server: {
    port: 5173,
  },
  build: {
    target: "es2022",
  },
});
