import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: { minify: true, sourcemap: false },
  server: { port: 1421, proxy: { "/api": { target: process.env.VITE_API_PROXY_TARGET || "http://127.0.0.1:8787", changeOrigin: true, rewrite: path => path.replace(/^\/api/, "") } } },
});
