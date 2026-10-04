import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// In development the API runs in the moa container on 127.0.0.1:8795.
export default defineConfig({
  plugins: [react()],
  worker: { format: "es" },
  server: {
    host: "127.0.0.1",
    port: 5179,
    proxy: { "/api": { target: process.env.MOA_API ?? "http://127.0.0.1:8795", changeOrigin: true } }
  },
  build: { target: "es2022", sourcemap: true }
});
