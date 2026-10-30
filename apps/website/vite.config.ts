import { defineConfig } from "vite";

export default defineConfig({
  server: { port: 1422 },
  build: { minify: true, sourcemap: false },
});
