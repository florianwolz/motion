import { defineConfig } from "vite";

// https://vitejs.dev/config/
export default defineConfig({
  // Resolve the WASM package from the sibling crate output directory.
  resolve: {
    alias: {
      // Points to the wasm-pack output (or stub during dev/CI without WASM build).
      // Run `wasm-pack build crates/motion-wasm --target web` to replace the stub.
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
