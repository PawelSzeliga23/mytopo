import { fileURLToPath, URL } from "node:url";
import { configDefaults, defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  server: {
    port: 5173,
    proxy: { "/api": "http://localhost:8000", "/media": "http://localhost:8000" },
  },
  test: { environment: "jsdom", setupFiles: ["./src/test/setup.ts"], css: false, exclude: [...configDefaults.exclude, "e2e/**"] },
});
