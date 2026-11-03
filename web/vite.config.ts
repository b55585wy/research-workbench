import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";

export default defineConfig({
  define: {
    "process.env.NODE_ENV": JSON.stringify("production")
  },
  build: {
    target: "es2022",
    outDir: fileURLToPath(new URL("../frontend/vendor/workspace-shell", import.meta.url)),
    emptyOutDir: false,
    sourcemap: false,
    minify: true,
    lib: {
      entry: fileURLToPath(new URL("./src/index.tsx", import.meta.url)),
      formats: ["es"],
      fileName: () => "workspace-shell.js"
    }
  }
});
