import { defineConfig } from "@playwright/test";

// API: `docker compose up -d api` z EDIT_PASSWORD=e2e-haslo w .env.
export default defineConfig({
  testDir: "./e2e",
  use: { baseURL: "http://localhost:5173" },
  webServer: { command: "npm run dev", port: 5173, reuseExistingServer: true },
});
