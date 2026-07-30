import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": path.resolve(__dirname, "./src") } },
  server: {
    port: 5173,
    // Dev-only convenience: the API runs on its own port during development.
    proxy: { "/api": "http://localhost:3000" },
  },
  build: { outDir: "dist" },
});
